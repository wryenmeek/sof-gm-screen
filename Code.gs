/**
 * Sea of Fortune GM Screen - Apps Script Backend
 * Serves live session materials, maps, statblocks, and notes from Google Drive.
 */

const SESSIONS_ROOT_ID = "1MnppB86ysCIlqS-c023Ss96rx5vHEnjT";
const GOOGLE_EDGE_CDN_PREFIX = "https://lh3.googleusercontent.com/d/";
const FEEDBACK_SHEET_PROP = "SOF_FEEDBACK_SHEET_ID";
const RULE_FEEDBACK_RATE_LIMIT_PREFIX = "rule_feedback_";
const RULE_FEEDBACK_GLOBAL_LIMIT_PROP = "SOF_RULE_FEEDBACK_GLOBAL_ATTEMPTS";
const RULE_FEEDBACK_WINDOW_MS = 6 * 60 * 60 * 1000;
const RULE_FEEDBACK_GLOBAL_LIMIT = 200;

/**
 * Returns Google Edge CDN direct URL for a given file ID.
 */
function getDriveCdnUrl_(fileId) {
  return GOOGLE_EDGE_CDN_PREFIX + fileId;
}

/**
 * Server-side GM access guard for Execute as: Me deployments.
 * When ScriptProperty SOF_GM_KEY is absent, or the supplied key is missing or
 * mismatched, calls fail closed with an "Unauthorized GM RPC" error.
 */
function assertGmAccess_(gmKey) {
  const expected =
    PropertiesService.getScriptProperties().getProperty("SOF_GM_KEY");
  if (!expected || gmKey !== expected) {
    throw new Error("Unauthorized GM RPC");
  }
  return true;
}

function doGet(e) {
  const sessionDate =
    e && e.parameter && e.parameter.session
      ? e.parameter.session
      : "2026-10-31";
  const template = HtmlService.createTemplateFromFile("Index");
  template.sessionDate = sessionDate;
  const gmKey = e && e.parameter && e.parameter.gmKey ? e.parameter.gmKey : "";
  const expectedGmKey =
    PropertiesService.getScriptProperties().getProperty("SOF_GM_KEY");
  const hasGmAccess = Boolean(expectedGmKey && gmKey === expectedGmKey);
  template.viewMode =
    e && e.parameter && e.parameter.view === "companion"
      ? "companion"
      : hasGmAccess
        ? "gm"
        : "companion";
  template.gmKey = template.viewMode === "gm" ? gmKey : "";
  return template
    .evaluate()
    .setTitle("Sea of Fortune GM Dashboard - " + sessionDate)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/**
 * Ticket 19: Returns short-lived OAuth token for Google Drive v3 bearer audio pre-caching.
 */
function getAudioAuthToken(gmKey) {
  assertGmAccess_(gmKey);
  return ScriptApp.getOAuthToken();
}

/**
 * Returns a sorted array of all session folder names inside Sessions/.
 */
function getSessionList(gmKey) {
  assertGmAccess_(gmKey);
  const sessionsFolder = resolveSessionsRoot_();
  const folders = sessionsFolder.getFolders();
  const list = [];
  while (folders.hasNext()) {
    const name = folders.next().getName();
    if (!name.startsWith(".")) {
      list.push(name);
    }
  }
  return list.sort((a, b) => b.localeCompare(a));
}

/**
 * Resolves session folder by date and builds a recursive file manifest.
 * Unpacks shortcuts to folders (e.g. 1. Floor Maps, 3. Monsters) and traverses subfolders.
 */
function getSessionManifest(sessionDate, gmKey) {
  assertGmAccess_(gmKey);
  const folder = resolveSessionFolder_(sessionDate);
  const manifest = [];
  const token = ScriptApp.getOAuthToken();

  function scanFolder(f, prefix = "") {
    // 1. Files & Shortcuts in current folder
    const files = f.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      let mime = file.getMimeType();
      let id = file.getId();
      const name = file.getName();

      // If shortcut, resolve via Drive v3 API
      if (mime === "application/vnd.google-apps.shortcut") {
        try {
          const url =
            "https://www.googleapis.com/drive/v3/files/" +
            id +
            "?fields=shortcutDetails";
          const res = JSON.parse(
            UrlFetchApp.fetch(url, {
              headers: { Authorization: "Bearer " + token },
              muteHttpExceptions: true
            }).getContentText()
          );

          if (res.shortcutDetails) {
            const targetId = res.shortcutDetails.targetId;
            const targetMime = res.shortcutDetails.targetMimeType;

            // Shortcut to a FOLDER: Recurse into target folder
            if (targetMime === "application/vnd.google-apps.folder") {
              try {
                const targetFolder = DriveApp.getFolderById(targetId);
                scanFolder(targetFolder, prefix + "[" + name + "] ");
                continue; // Do not add the shortcut container itself
              } catch (_e) {}
            } else {
              // Shortcut to a file
              id = targetId;
              mime = targetMime;
            }
          }
        } catch (_e) {}
      }

      // Skip pure folder items in file list
      if (mime === "application/vnd.google-apps.folder") {
        continue;
      }

      manifest.push({
        id: id,
        name: prefix + name,
        simpleName: name,
        mimeType: mime,
        size: file.getSize(),
        updated: file.getLastUpdated().toISOString()
      });
    }

    // 2. Real Subfolders
    const subfolders = f.getFolders();
    while (subfolders.hasNext()) {
      const sub = subfolders.next();
      scanFolder(sub, prefix + "[" + sub.getName() + "] ");
    }
  }

  scanFolder(folder);
  return manifest.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetches file content by ID and formats it for client rendering.
 */
function getFilePayload(fileId, sessionDate, gmKey) {
  assertGmAccess_(gmKey);
  const file = DriveApp.getFileById(fileId);
  const mime = file.getMimeType();
  const name = file.getName();

  // 1. Images: High-performance Google Edge CDN URL (zero memory, instant load)
  if (mime.startsWith("image/")) {
    return {
      id: fileId,
      type: "image",
      name: name,
      content: getDriveCdnUrl_(fileId)
    };
  }

  // 2. Audio: Streaming preview player for large session recordings
  if (mime.startsWith("audio/")) {
    return {
      id: fileId,
      type: "audio",
      name: name,
      content: "https://drive.google.com/file/d/" + fileId + "/preview"
    };
  }

  // 3. Native Google Docs: Export to HTML on the fly
  if (mime === MimeType.GOOGLE_DOCS) {
    const url =
      "https://www.googleapis.com/drive/v3/files/" +
      fileId +
      "/export?mimeType=text/html";
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }
    });
    return {
      id: fileId,
      type: "html",
      name: name,
      content: response.getContentText()
    };
  }

  // 4. HTML and Markdown: Resolve relative images to Drive CDN links
  let rawText = file.getBlob().getDataAsString();
  rawText = resolveRelativeImages_(rawText, sessionDate);
  const isMarkdown = name.endsWith(".md") || mime === "text/markdown";

  return {
    id: fileId,
    type: isMarkdown ? "markdown" : "html",
    name: name,
    content: rawText
  };
}

/**
 * Replaces relative image filenames in MD/HTML with Google CDN direct URLs.
 */
function resolveRelativeImages_(text, sessionDate) {
  const folder = resolveSessionFolder_(sessionDate);
  return text.replace(
    /(?:src=["']|!\[.*?\]\()([^"')\s]+\.(?:png|jpg|jpeg|webp|gif))["')]/gi,
    (match, filename) => {
      const cleanName = filename.split("/").pop();
      const files = folder.getFilesByName(cleanName);
      if (files.hasNext()) {
        const imgFile = files.next();
        return match.replace(filename, getDriveCdnUrl_(imgFile.getId()));
      }
      return match;
    }
  );
}

/**
 * Loads existing content from table_notes.md in the session folder.
 */
function getScratchpadNotes(sessionDate, gmKey) {
  assertGmAccess_(gmKey);
  const folder = resolveSessionFolder_(sessionDate);
  const files = folder.getFilesByName("table_notes.md");
  if (files.hasNext()) {
    const file = files.next();
    return {
      id: file.getId(),
      content: file.getBlob().getDataAsString(),
      updated: file.getLastUpdated().toLocaleTimeString()
    };
  }
  return {
    id: null,
    content:
      "# Session Table Notes (" +
      sessionDate +
      ")\n\n- Initiative:\n- Rulings:\n- Loot distributed:\n",
    updated: "Not saved yet"
  };
}

/**
 * Saves or overwrites table_notes.md in the session folder.
 */
function saveScratchpadNotes(sessionDate, content, gmKey) {
  assertGmAccess_(gmKey);
  const folder = resolveSessionFolder_(sessionDate);
  const files = folder.getFilesByName("table_notes.md");
  let file;
  if (files.hasNext()) {
    file = files.next();
    file.setContent(content);
  } else {
    file = folder.createFile("table_notes.md", content, "text/markdown");
  }
  return {
    id: file.getId(),
    updated: new Date().toLocaleTimeString()
  };
}

/**
 * Ticket 06: Saves or appends digital sidecar audio timeline events to session_audio_timeline.json.
 */
function saveAudioTimeline(sessionDate, jsonString, gmKey) {
  assertGmAccess_(gmKey);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = resolveSessionFolder_(sessionDate);
    const fileName = "session_audio_timeline.json";
    const files = folder.getFilesByName(fileName);
    const incomingEvents = JSON.parse(jsonString || "[]");
    if (!Array.isArray(incomingEvents)) {
      throw new Error("Audio timeline payload must be a JSON array.");
    }

    let file = null;
    let merged = [];
    if (files.hasNext()) {
      file = files.next();
      const rawExisting = file.getBlob().getDataAsString() || "[]";
      const existing = JSON.parse(rawExisting);
      if (!Array.isArray(existing)) {
        throw new Error("Audio timeline sidecar must contain a JSON array.");
      }
      merged = existing.slice();
    }

    const makeKey = (event) =>
      String(event && event.timestamp) +
      "|" +
      String((event && event.eventType) || "") +
      "|" +
      String((event && event.track) || "");
    const seenKeys = new Set(merged.map(makeKey));
    for (let i = 0; i < incomingEvents.length; i++) {
      const event = incomingEvents[i];
      const key = makeKey(event);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        merged.push(event);
      }
    }

    const content = JSON.stringify(merged, null, 2);
    if (file) {
      file.setContent(content);
    } else {
      file = folder.createFile(fileName, content, "application/json");
    }

    return {
      id: file.getId(),
      count: merged.length,
      updated: new Date().toLocaleTimeString()
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Built-in core 5e SRD starter glossary so offline/mock runs always have baseline entries.
 */
function getCoreStarterGlossary_() {
  return [
    {
      id: "srd_misty_step",
      title: "Misty Step",
      source: "5e SRD Starter Glossary",
      summary:
        "2nd-level conjuration (bonus action, Self): Briefly surrounded by silvery mist, you teleport up to 30 feet to an unoccupied space that you can see.",
      tags: "spell bonus action teleport conjuration 2nd-level"
    },
    {
      id: "srd_grappling",
      title: "Grappling",
      source: "5e SRD Starter Glossary",
      summary:
        "Use the Attack action to make a special melee attack: Strength (Athletics) contested by target's Strength (Athletics) or Dexterity (Acrobatics). Target's speed becomes 0.",
      tags: "combat condition athletics acrobatics grapple speed"
    },
    {
      id: "srd_sneak_attack",
      title: "Sneak Attack",
      source: "5e SRD Starter Glossary",
      summary:
        "Once per turn, deal extra 1d6+ damage to one creature you hit with a finesse or ranged weapon if you have advantage on the attack roll or an ally is within 5 feet of the target.",
      tags: "rogue class feature finesse advantage damage"
    },
    {
      id: "srd_shield",
      title: "Shield",
      source: "5e SRD Starter Glossary",
      summary:
        "1st-level abjuration (reaction when hit by an attack or targeted by magic missile): Until the start of your next turn, you have a +5 bonus to AC and take no damage from magic missile.",
      tags: "spell reaction abjuration ac defense"
    },
    {
      id: "srd_concentration",
      title: "Concentration",
      source: "5e SRD Starter Glossary",
      summary:
        "Taking damage while concentrating on a spell requires a Constitution saving throw (DC 10 or half the damage taken, whichever is higher). Incapacitated or casting another concentration spell ends it.",
      tags: "spellcasting constitution save dc damage"
    }
  ];
}

/**
 * Parses a markdown or JSON glossary file into normalized { id, title, source, summary, tags } entries.
 */
function parseGlossaryFileContent_(fileName, rawContent) {
  const entries = [];
  if (!rawContent) return entries;

  if (fileName.endsWith(".json")) {
    try {
      const parsed = JSON.parse(rawContent);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.rules)
          ? parsed.rules
          : Array.isArray(parsed.entries)
            ? parsed.entries
            : [];
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item && (item.title || item.name)) {
          const title = String(item.title || item.name).trim();
          entries.push({
            id:
              item.id || fileName.replace(/\W+/g, "_").toLowerCase() + "_" + i,
            title: title,
            source: item.source || fileName,
            summary: String(item.summary || item.description || "").trim(),
            tags: Array.isArray(item.tags)
              ? item.tags.join(" ")
              : String(item.tags || title.toLowerCase())
          });
        }
      }
    } catch (_e) {}
    return entries;
  }

  // Parse Markdown headings (## / ###) and bold bullet items (- **Term**: Summary)
  const lines = String(rawContent).split(/\r?\n/);
  let currentHeading = null;
  let currentLines = [];

  function flushHeading() {
    if (currentHeading) {
      const summary = currentLines.join(" ").trim();
      if (summary) {
        entries.push({
          id:
            fileName.replace(/\W+/g, "_").toLowerCase() +
            "_" +
            currentHeading.replace(/\W+/g, "_").toLowerCase(),
          title: currentHeading,
          source: fileName,
          summary: summary,
          tags: currentHeading.toLowerCase() + " " + fileName.toLowerCase()
        });
      }
      currentHeading = null;
      currentLines = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const headingMatch = line.match(/^#{2,4}\s+(.+)$/);
    if (headingMatch) {
      flushHeading();
      currentHeading = headingMatch[1].replace(/\*\*/g, "").trim();
      continue;
    }

    const bulletMatch = line.match(
      /^[-*]\s+\*\*([^*]+)\*\*\s*(?:[:—–-]\s*)(.+)$/
    );
    if (bulletMatch) {
      flushHeading();
      const bTitle = bulletMatch[1].trim();
      const bSummary = bulletMatch[2].trim();
      entries.push({
        id:
          fileName.replace(/\W+/g, "_").toLowerCase() +
          "_" +
          bTitle.replace(/\W+/g, "_").toLowerCase(),
        title: bTitle,
        source: fileName,
        summary: bSummary,
        tags: bTitle.toLowerCase() + " " + fileName.toLowerCase()
      });
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }
  flushHeading();
  return entries;
}

/**
 * Ticket 23: Player-safe entrypoint that loads and parses campaign rules and lore glossaries
 * from Google Drive and merges the built-in 5e SRD starter glossary.
 */
function getRulesGlossary(sessionDate) {
  const targetFiles = [
    "dnd-rules-transcription-glossary.md",
    "hsi-transcription-glossary.md",
    "rules_glossary.md",
    "5e-SRD-Rules.json",
    "Game_Terms_Aid.md",
    "Campaign_Lore_Aid.md",
    "Session_Rules_Summary.md"
  ];

  const candidateFolders = [];
  try {
    const sessionFolder = resolveSessionFolder_(sessionDate || "2026-10-31");
    if (sessionFolder) {
      candidateFolders.push(sessionFolder);
      try {
        const genIter = sessionFolder.getFoldersByName("Generated Documents");
        if (genIter && genIter.hasNext()) {
          candidateFolders.push(genIter.next());
        }
      } catch (_e) {}
    }
  } catch (_e) {}

  const sharedFolderNames = ["session_inputs", "GenAI"];
  for (let s = 0; s < sharedFolderNames.length; s++) {
    try {
      const iter = DriveApp.getFoldersByName(sharedFolderNames[s]);
      if (iter && iter.hasNext()) {
        candidateFolders.push(iter.next());
      }
    } catch (_e) {}
  }

  const seenFileIds = new Set();
  const discoveredEntries = [];

  for (let fIdx = 0; fIdx < candidateFolders.length; fIdx++) {
    const folder = candidateFolders[fIdx];
    for (let tIdx = 0; tIdx < targetFiles.length; tIdx++) {
      const fileName = targetFiles[tIdx];
      try {
        const fileIter = folder.getFilesByName(fileName);
        while (fileIter && fileIter.hasNext()) {
          const file = fileIter.next();
          const fId = file.getId();
          if (seenFileIds.has(fId)) continue;
          seenFileIds.add(fId);
          const content = file.getBlob().getDataAsString();
          const parsed = parseGlossaryFileContent_(fileName, content);
          for (let p = 0; p < parsed.length; p++) {
            discoveredEntries.push(parsed[p]);
          }
        }
      } catch (_e) {}
    }
  }

  const merged = [];
  const seenTitles = new Set();

  for (let i = 0; i < discoveredEntries.length; i++) {
    const entry = discoveredEntries[i];
    const key = entry.title.toLowerCase();
    if (!seenTitles.has(key)) {
      seenTitles.add(key);
      merged.push(entry);
    }
  }

  const starter = getCoreStarterGlossary_();
  for (let j = 0; j < starter.length; j++) {
    const item = starter[j];
    const key = item.title.toLowerCase();
    if (!seenTitles.has(key)) {
      seenTitles.add(key);
      merged.push(item);
    }
  }

  return merged;
}

function neutralizeSpreadsheetFormula_(value) {
  const text = String(value == null ? "" : value);
  let firstContent = 0;
  while (firstContent < text.length) {
    const code = text.charCodeAt(firstContent);
    if (
      code === 8203 ||
      code === 65279 ||
      /\s/.test(text.charAt(firstContent))
    ) {
      firstContent++;
    } else {
      break;
    }
  }
  return firstContent < text.length &&
    "=+@-".indexOf(text.charAt(firstContent)) >= 0
    ? "'" + text
    : text;
}

function pruneRuleFeedbackRateLimitProperties_(properties, now) {
  const windowStart = now - RULE_FEEDBACK_WINDOW_MS;
  const allProperties = properties.getProperties();
  const activeUserTimestamps = [];
  let removed = 0;

  Object.keys(allProperties).forEach((key) => {
    if (!key.startsWith(RULE_FEEDBACK_RATE_LIMIT_PREFIX)) return;
    let attempts;
    try {
      attempts = JSON.parse(allProperties[key]);
    } catch (_e) {
      return;
    }
    if (
      !Array.isArray(attempts) ||
      attempts.some(
        (attempt) =>
          !attempt ||
          !Number.isFinite(attempt.timestamp) ||
          typeof attempt.sessionDate !== "string"
      )
    ) {
      return;
    }
    const activeAttempts = attempts.filter(
      (attempt) => attempt.timestamp > windowStart
    );
    activeAttempts.forEach((attempt) =>
      activeUserTimestamps.push(attempt.timestamp)
    );
    if (activeAttempts.length === 0) {
      properties.deleteProperty(key);
      removed++;
    } else if (activeAttempts.length !== attempts.length) {
      properties.setProperty(key, JSON.stringify(activeAttempts));
    }
  });

  let globalAttempts = [];
  const rawGlobalAttempts = properties.getProperty(
    RULE_FEEDBACK_GLOBAL_LIMIT_PROP
  );
  if (rawGlobalAttempts) {
    try {
      globalAttempts = JSON.parse(rawGlobalAttempts);
    } catch (_e) {
      return null;
    }
    if (
      !Array.isArray(globalAttempts) ||
      globalAttempts.some((timestamp) => !Number.isFinite(timestamp))
    ) {
      return null;
    }
    globalAttempts = globalAttempts.filter(
      (timestamp) => timestamp > windowStart
    );
  } else {
    globalAttempts = activeUserTimestamps;
  }
  globalAttempts = globalAttempts
    .sort((first, second) => first - second)
    .slice(-RULE_FEEDBACK_GLOBAL_LIMIT);

  if (globalAttempts.length) {
    properties.setProperty(
      RULE_FEEDBACK_GLOBAL_LIMIT_PROP,
      JSON.stringify(globalAttempts)
    );
  } else if (rawGlobalAttempts) {
    properties.deleteProperty(RULE_FEEDBACK_GLOBAL_LIMIT_PROP);
  }

  return { globalAttempts, removed };
}

function pruneRuleFeedbackRateLimits_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const result = pruneRuleFeedbackRateLimitProperties_(
      properties,
      Date.now()
    );
    if (!result) return { removed: 0, status: "invalid_state" };
    return { removed: result.removed, status: "pruned" };
  } finally {
    lock.releaseLock();
  }
}

function pruneRuleFeedbackRateLimitsTrigger_() {
  return pruneRuleFeedbackRateLimits_();
}

function ruleFeedbackRateLimitKey_(email, sessionDate) {
  const value =
    String(email || "unknown-user").toLowerCase() + "\u0000" + sessionDate;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return "rule_feedback_" + (hash >>> 0).toString(16);
}

/**
 * Ticket 08 & 23: Logs crowdsourced player rule card feedback to Rules_Helper_Feedback in Google Sheets.
 */
function logRuleFeedback(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { status: "invalid" };
  }

  const values = {
    sessionDate: data.sessionDate || "2026-10-31",
    player: data.player || "Guest",
    phrase: data.phrase || data.heardPhrase || "",
    cardTitle: data.cardTitle || "",
    source: data.source || "D&D 5e Glossary",
    vote: data.vote || "+1"
  };
  const limits = {
    sessionDate: 10,
    player: 80,
    phrase: 500,
    cardTitle: 200,
    source: 120
  };
  for (const field in limits) {
    if (
      typeof values[field] !== "string" ||
      values[field].length > limits[field]
    ) {
      return { status: "invalid" };
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.sessionDate)) {
    return { status: "invalid" };
  }
  if (values.vote !== "+1" && values.vote !== "-1") {
    return { status: "invalid" };
  }

  const sessionService = typeof Session !== "undefined" ? Session : null;
  const userEmail =
    sessionService && sessionService.getActiveUser
      ? sessionService.getActiveUser().getEmail()
      : "";
  const userKey =
    userEmail ||
    (sessionService && sessionService.getTemporaryActiveUserKey
      ? sessionService.getTemporaryActiveUserKey()
      : "unknown-user");
  const rateLimitKey = ruleFeedbackRateLimitKey_(userKey, "durable_window");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rateLimitProps = PropertiesService.getScriptProperties();
    const now = Date.now();
    const pruned = pruneRuleFeedbackRateLimitProperties_(rateLimitProps, now);
    if (!pruned) return { status: "rate_limited" };

    const rawAttempts = rateLimitProps.getProperty(rateLimitKey);
    let attempts = [];
    if (rawAttempts) {
      try {
        attempts = JSON.parse(rawAttempts);
      } catch (_e) {
        return { status: "rate_limited" };
      }
      if (
        !Array.isArray(attempts) ||
        attempts.some(
          (attempt) =>
            !attempt ||
            !Number.isFinite(attempt.timestamp) ||
            typeof attempt.sessionDate !== "string"
        )
      ) {
        return { status: "rate_limited" };
      }
    }

    const windowStart = now - RULE_FEEDBACK_WINDOW_MS;
    attempts = attempts.filter((attempt) => attempt.timestamp > windowStart);
    const sessionCount = attempts.filter(
      (attempt) => attempt.sessionDate === values.sessionDate
    ).length;
    if (
      sessionCount >= 20 ||
      attempts.length >= 40 ||
      pruned.globalAttempts.length >= RULE_FEEDBACK_GLOBAL_LIMIT
    ) {
      return { status: "rate_limited" };
    }
    attempts.push({ timestamp: now, sessionDate: values.sessionDate });
    pruned.globalAttempts.push(now);
    rateLimitProps.setProperty(
      RULE_FEEDBACK_GLOBAL_LIMIT_PROP,
      JSON.stringify(pruned.globalAttempts)
    );
    rateLimitProps.setProperty(rateLimitKey, JSON.stringify(attempts));

    const payload = {
      timestamp: new Date().toISOString(),
      sessionDate: values.sessionDate,
      player: values.player,
      phrase: values.phrase,
      cardTitle: values.cardTitle,
      source: values.source,
      vote: values.vote
    };
    const props = PropertiesService.getScriptProperties();
    const sheetId = props.getProperty(FEEDBACK_SHEET_PROP);
    if (sheetId && typeof SpreadsheetApp !== "undefined") {
      const ss = SpreadsheetApp.openById(sheetId);
      let sheet = ss.getSheetByName("Rules_Helper_Feedback");
      if (!sheet) {
        sheet = ss.insertSheet("Rules_Helper_Feedback");
        sheet.appendRow([
          "Timestamp ISO",
          "Session Date",
          "Player Identity",
          "Raw Query Phrase",
          "Matched Rule Title",
          "Vote"
        ]);
      }
      sheet.appendRow([
        payload.timestamp,
        neutralizeSpreadsheetFormula_(payload.sessionDate),
        neutralizeSpreadsheetFormula_(payload.player),
        neutralizeSpreadsheetFormula_(payload.phrase),
        neutralizeSpreadsheetFormula_(payload.cardTitle),
        neutralizeSpreadsheetFormula_(payload.vote)
      ]);
    }

    return { status: "logged", entry: payload };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Ticket 24: Idempotently installs the Wednesday 12:00 PM time-driven trigger for auditCalendarQuorum.
 */
function installGovernanceTriggers(gmKey) {
  assertGmAccess_(gmKey);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const existing = ScriptApp.getProjectTriggers();
    let hasAuditTrigger = false;
    let hasFeedbackPruneTrigger = false;
    for (let i = 0; i < existing.length; i++) {
      const handler = existing[i].getHandlerFunction();
      if (handler === "auditCalendarQuorumTrigger_") {
        hasAuditTrigger = true;
      } else if (handler === "pruneRuleFeedbackRateLimitsTrigger_") {
        hasFeedbackPruneTrigger = true;
      } else if (handler === "auditCalendarQuorum") {
        ScriptApp.deleteTrigger(existing[i]);
      }
    }

    let installed = false;
    if (!hasAuditTrigger) {
      ScriptApp.newTrigger("auditCalendarQuorumTrigger_")
        .timeBased()
        .onWeekDay(ScriptApp.WeekDay.WEDNESDAY)
        .atHour(12)
        .create();
      installed = true;
    }
    if (!hasFeedbackPruneTrigger) {
      ScriptApp.newTrigger("pruneRuleFeedbackRateLimitsTrigger_")
        .timeBased()
        .everyDays(1)
        .atHour(3)
        .create();
      installed = true;
    }
    return { installed: installed };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Editor-only setup entrypoint. Run setupGovernanceTriggers_ from the Apps Script editor.
 * It reads SOF_GM_KEY from Script Properties without exposing a client-callable setup path.
 */
function setupGovernanceTriggers_() {
  const gmKey =
    PropertiesService.getScriptProperties().getProperty("SOF_GM_KEY");
  if (!gmKey) {
    throw new Error("Set SOF_GM_KEY in Script Properties before setup.");
  }
  return installGovernanceTriggers(gmKey);
}

/**
 * Ticket 24: Rolls 2d8 on the Traveling at Sea Weather Hexflower table.
 */
function rollSeaWeatherHexflower_(fixedRoll) {
  const d1 = Math.floor(Math.random() * 8) + 1;
  const d2 = Math.floor(Math.random() * 8) + 1;
  const roll =
    typeof fixedRoll === "number" && fixedRoll >= 2 && fixedRoll <= 16
      ? fixedRoll
      : d1 + d2;

  let condition = "Clear Skies & Steady Breeze";
  if (roll === 2) {
    condition = "Arcane Squall / Boiling Mist";
  } else if (roll <= 4) {
    condition = "Heavy Gale & Driving Rain";
  } else if (roll <= 6) {
    condition = "Swell & Trade Winds";
  } else if (roll <= 9) {
    condition = "Clear Skies & Steady Breeze";
  } else if (roll <= 11) {
    condition = "Humid Doldrums / Dead Calm";
  } else if (roll <= 13) {
    condition = "Tropical Downpour & Low Visibility";
  } else if (roll <= 15) {
    condition = "Sulfurous Fog Bank";
  } else {
    condition = "Radiant Trade Wind / Favorable Current";
  }

  return {
    roll: roll,
    condition: condition,
    summary: "2d8=" + roll + ": " + condition
  };
}

/**
 * Ticket 09 & 24: Audits Calendar event RSVP attendance 72 hours prior to Saturday sessions.
 * Safeguards against 0-guest events, reschedules +14 days when confirmed < 3 or a locked player
 * declines, or rolls 2d8 on the Traveling at Sea Weather Hexflower when Attendance Quorum is met.
 */
function auditCalendarQuorum(targetDateStr, inGameContext, gmKey) {
  assertGmAccess_(gmKey);
  if (targetDateStr != null && typeof targetDateStr !== "string") {
    throw new Error("Manual quorum audit expects a date string or event ID.");
  }
  return runCalendarQuorumAudit_(targetDateStr, inGameContext);
}

/**
 * Private time-trigger handler. The Apps Script trigger event is never treated as an event ID.
 */
function auditCalendarQuorumTrigger_(_triggerEvent, auditTime) {
  return runCalendarQuorumAudit_(
    auditTime === undefined ? new Date() : auditTime,
    null,
    true
  );
}

function mergeQuorumDescription_(event, automationText) {
  const startMarker = "<!-- SOF_QUORUM_AUTOMATION:START -->";
  const endMarker = "<!-- SOF_QUORUM_AUTOMATION:END -->";
  const section = startMarker + "\n" + automationText + "\n" + endMarker;
  const original =
    typeof event.getDescription === "function"
      ? String(event.getDescription() || "")
      : "";
  const sectionRegex = new RegExp(startMarker + "[\\s\\S]*?" + endMarker);
  return sectionRegex.test(original)
    ? original.replace(sectionRegex, section)
    : [original.replace(/\\s+$/, ""), section].filter(Boolean).join("\n\n");
}

function updateQuorumDescription_(event, automationText) {
  const description = mergeQuorumDescription_(event, automationText);
  event.setDescription(description);
  return description;
}

function rescheduleCalendarEventWithNotifications_(
  calendar,
  event,
  nextStart,
  nextEnd,
  description,
  calendarTimeZone
) {
  if (
    typeof Calendar === "undefined" ||
    !Calendar.Events ||
    typeof Calendar.Events.list !== "function" ||
    typeof Calendar.Events.patch !== "function"
  ) {
    throw new Error("Advanced Calendar service is unavailable.");
  }
  if (typeof event.getId !== "function") {
    throw new Error("Calendar event iCalUID is unavailable.");
  }

  const calendarId =
    typeof calendar.getId === "function" ? calendar.getId() : "primary";
  const currentStart = event.getStartTime();
  const matchingEvents = Calendar.Events.list(calendarId, {
    iCalUID: event.getId(),
    timeMin: new Date(currentStart.getTime() - 1000).toISOString(),
    timeMax: new Date(currentStart.getTime() + 1000).toISOString(),
    singleEvents: true
  });
  const items = (matchingEvents && matchingEvents.items) || [];
  const apiEvent = items.find(
    (candidate) =>
      candidate &&
      candidate.id &&
      candidate.iCalUID === event.getId() &&
      candidate.start &&
      candidate.start.dateTime &&
      Math.abs(Date.parse(candidate.start.dateTime) - currentStart.getTime()) <
        1000
  );
  if (!apiEvent) {
    throw new Error(
      "Calendar API event matching the selected session was not found."
    );
  }

  Calendar.Events.patch(
    {
      start: { dateTime: nextStart.toISOString(), timeZone: calendarTimeZone },
      end: { dateTime: nextEnd.toISOString(), timeZone: calendarTimeZone },
      description: description
    },
    calendarId,
    apiEvent.id,
    { sendUpdates: "all" }
  );
}

function isCalendarSaturday_(date, calendarTimeZone) {
  return Utilities.formatDate(date, calendarTimeZone, "u") === "6";
}

function addCalendarDaysToDateString_(dateString, dayCount) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) {
    throw new Error("Invalid Calendar date: " + dateString);
  }
  const utcDate = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]) + dayCount
    )
  );
  return Utilities.formatDate(utcDate, "UTC", "yyyy-MM-dd");
}

function shiftCalendarDateByDays_(date, dayCount, calendarTimeZone) {
  const localDateTime = Utilities.formatDate(
    date,
    calendarTimeZone,
    "yyyy-MM-dd'T'HH:mm:ss"
  );
  const shiftedDate = addCalendarDaysToDateString_(
    localDateTime.substring(0, 10),
    dayCount
  );
  const shifted = Utilities.parseDate(
    shiftedDate + localDateTime.substring(10),
    calendarTimeZone,
    "yyyy-MM-dd'T'HH:mm:ss"
  );
  shifted.setMilliseconds(date.getMilliseconds());
  return shifted;
}

function runCalendarQuorumAudit_(targetDate, inGameContext, isScheduled) {
  if (typeof CalendarApp === "undefined") {
    throw new Error("CalendarApp service is unavailable.");
  }
  const props = PropertiesService.getScriptProperties();
  const cal = CalendarApp.getDefaultCalendar();
  const customQuery = props.getProperty("SOF_CALENDAR_QUERY");
  const titleRegex = customQuery
    ? new RegExp(customQuery, "i")
    : /dnd|sea of fortune/i;
  const calendarTimeZone = cal.getTimeZone();
  let event = null;
  const isDirectEventId =
    typeof targetDate === "string" &&
    targetDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(targetDate);

  if (isDirectEventId && typeof cal.getEventById === "function") {
    const candidate = cal.getEventById(targetDate);
    if (
      candidate &&
      typeof candidate.getStartTime === "function" &&
      typeof candidate.getTitle === "function"
    ) {
      const candidateStart = candidate.getStartTime();
      titleRegex.lastIndex = 0;
      if (
        isCalendarSaturday_(candidateStart, calendarTimeZone) &&
        titleRegex.test(candidate.getTitle())
      ) {
        event = candidate;
      }
    }
  }

  if (!event && !isDirectEventId && typeof cal.getEvents === "function") {
    const startWindow =
      targetDate instanceof Date
        ? new Date(targetDate.getTime())
        : typeof targetDate === "string" && targetDate
          ? Utilities.parseDate(targetDate, calendarTimeZone, "yyyy-MM-dd")
          : new Date();
    const startLocalDate = Utilities.formatDate(
      startWindow,
      calendarTimeZone,
      "yyyy-MM-dd"
    );
    if (
      isNaN(startWindow.getTime()) ||
      (typeof targetDate === "string" &&
        targetDate &&
        startLocalDate !== targetDate)
    ) {
      throw new Error("Invalid quorum audit date: " + targetDate);
    }
    const endLocalDate = addCalendarDaysToDateString_(startLocalDate, 7);
    const endWindow = Utilities.parseDate(
      endLocalDate,
      calendarTimeZone,
      "yyyy-MM-dd"
    );
    const events = cal.getEvents(startWindow, endWindow) || [];
    let selectedStart = null;
    for (let i = 0; i < events.length; i++) {
      const candidate = events[i];
      if (
        !candidate ||
        typeof candidate.getStartTime !== "function" ||
        typeof candidate.getTitle !== "function"
      ) {
        continue;
      }
      const candidateStart = candidate.getStartTime();
      const title = candidate.getTitle();
      titleRegex.lastIndex = 0;
      if (
        isCalendarSaturday_(candidateStart, calendarTimeZone) &&
        candidateStart.getTime() >= startWindow.getTime() &&
        candidateStart.getTime() < endWindow.getTime() &&
        titleRegex.test(title) &&
        (!selectedStart || candidateStart.getTime() < selectedStart.getTime())
      ) {
        event = candidate;
        selectedStart = candidateStart;
      }
    }
  }

  if (!event) {
    if (isScheduled) return { status: "NO_UPCOMING_SESSION" };
    throw new Error("Upcoming Saturday Calendar event not found.");
  }

  const guests = event.getGuestList() || [];
  if (guests.length === 0) {
    if (typeof Logger !== "undefined" && Logger.log) {
      Logger.log("Skipping quorum cancellation: 0 guests invited on event");
    }
    return { status: "SKIPPED_NO_GUESTS", confirmed: 0 };
  }

  const confirmed = guests.filter(
    (guest) => guest.getGuestStatus() === CalendarApp.GuestStatus.YES
  );
  const lockedTokens = (props.getProperty("SOF_LOCKED_PLAYERS") || "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  let lockedDeclined = false;
  for (let i = 0; i < guests.length && !lockedDeclined; i++) {
    const guest = guests[i];
    if (guest.getGuestStatus() !== CalendarApp.GuestStatus.NO) continue;
    const email =
      typeof guest.getEmail === "function"
        ? String(guest.getEmail() || "").toLowerCase()
        : "";
    const name =
      typeof guest.getName === "function"
        ? String(guest.getName() || "").toLowerCase()
        : "";
    lockedDeclined = lockedTokens.some(
      (token) =>
        (email && (email === token || email.includes(token))) ||
        (name && (name === token || name.includes(token)))
    );
  }

  if (confirmed.length < 3 || lockedDeclined) {
    const start = event.getStartTime();
    const end = event.getEndTime();
    const nextStart = shiftCalendarDateByDays_(start, 14, calendarTimeZone);
    const nextEnd = shiftCalendarDateByDays_(end, 14, calendarTimeZone);
    const note =
      "[RESCHEDULED: Quorum < 3 confirmed players or locked player unavailable (" +
      confirmed.length +
      "/3)] Shifted to next alternate Saturday.";
    const description = mergeQuorumDescription_(event, note);
    rescheduleCalendarEventWithNotifications_(
      cal,
      event,
      nextStart,
      nextEnd,
      description,
      calendarTimeZone
    );
    return {
      status: "RESCHEDULED",
      quorumMet: false,
      confirmedCount: confirmed.length,
      rescheduledTo: nextStart.toISOString()
    };
  }

  const hexWeather = rollSeaWeatherHexflower_();
  const inGameDate =
    (inGameContext && inGameContext.harptosDate) ||
    props.getProperty("SOF_INGAME_DATE") ||
    "Hot Springs Island — Sea of Fortune";
  const planarAlignment =
    (inGameContext && inGameContext.planarAlignment) || "Astral Coterminous";
  const weatherDisplay =
    inGameContext && inGameContext.weather
      ? inGameContext.weather + " [" + hexWeather.summary + "]"
      : hexWeather.summary;
  const briefing =
    "=== Sea of Fortune Tactical Brief ===\n" +
    "In-Game Date: " +
    inGameDate +
    "\n" +
    "Planar Alignment: " +
    planarAlignment +
    "\n" +
    "Traveling at Sea Weather: " +
    weatherDisplay;
  updateQuorumDescription_(event, briefing);

  return {
    status: "QUORUM_MET",
    quorumMet: true,
    confirmedCount: confirmed.length,
    weather: hexWeather,
    inGameDate: inGameDate,
    description: briefing
  };
}

/**
 * Returns whether an ISO calendar date is a real date.
 */
function isValidTaskCalendarDate_(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Converts supported Narrative Promise due values to Google Tasks RFC 3339.
 *
 * Relative day values are calculated from the session date; unknown values are
 * omitted so one model-produced phrase cannot make the Tasks batch fail.
 */
function normalizeTaskDue_(due, sessionDate) {
  if (typeof due !== "string") return undefined;
  const value = due.trim();
  if (!value) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return isValidTaskCalendarDate_(value)
      ? value + "T00:00:00.000Z"
      : undefined;
  }

  const timestampMatch =
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/i.exec(
      value
    );
  if (
    timestampMatch &&
    isValidTaskCalendarDate_(timestampMatch[1]) &&
    !isNaN(Date.parse(value))
  ) {
    return value;
  }

  const relativeMatch = /^(?:in\s+)?(\d+)\s+days?$/i.exec(value);
  const relativeDays =
    relativeMatch && Number(relativeMatch[1]) <= 36500
      ? Number(relativeMatch[1])
      : /^today$/i.test(value)
        ? 0
        : /^tomorrow$/i.test(value)
          ? 1
          : null;
  if (
    relativeDays === null ||
    typeof sessionDate !== "string" ||
    !isValidTaskCalendarDate_(sessionDate)
  ) {
    return undefined;
  }

  const sessionParts = sessionDate.split("-").map(Number);
  const dueDate = new Date(0);
  dueDate.setUTCFullYear(
    sessionParts[0],
    sessionParts[1] - 1,
    sessionParts[2] + relativeDays
  );
  dueDate.setUTCHours(0, 0, 0, 0);
  return dueDate.toISOString();
}

/**
 * Ticket 10 & 25: Extracts narrative promises, crafting timers, and open rulings from table_notes.md
 * via Gemini structured JSON output and inserts non-duplicate entries into Google Tasks.
 */
function extractNarrativePromises(sessionDate, gmKey) {
  assertGmAccess_(gmKey);
  const listId = "@default";
  const tableNotes = getScratchpadNotes(sessionDate, gmKey);
  const notesText = tableNotes.content || "";

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    apiKey;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text:
              "Extract open GM promises, custom crafting countdowns, and pending rulings from these session notes:\n\n" +
              notesText
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          tasks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                notes: { type: "STRING" },
                due: { type: "STRING" },
                category: { type: "STRING" }
              },
              required: ["title"]
            }
          }
        },
        required: ["tasks"]
      }
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();
  if (responseCode < 200 || responseCode >= 300) {
    let detail = responseText;
    try {
      const errorBody = JSON.parse(responseText);
      detail =
        errorBody && errorBody.error && errorBody.error.message
          ? errorBody.error.message
          : responseText;
    } catch (_e) {}
    throw new Error(
      "Gemini API request failed (" + responseCode + "): " + detail
    );
  }
  const rawJson = JSON.parse(responseText);
  let extracted = null;
  if (
    rawJson &&
    rawJson.candidates &&
    rawJson.candidates[0] &&
    rawJson.candidates[0].content &&
    rawJson.candidates[0].content.parts &&
    rawJson.candidates[0].content.parts[0] &&
    rawJson.candidates[0].content.parts[0].text
  ) {
    const parsed = JSON.parse(rawJson.candidates[0].content.parts[0].text);
    extracted = parsed.tasks;
  } else if (rawJson && Array.isArray(rawJson.tasks)) {
    extracted = rawJson.tasks;
  }
  if (!Array.isArray(extracted)) {
    throw new Error("Gemini API response did not contain a tasks array.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const createdTasks = [];
  try {
    if (typeof Tasks === "undefined" || !Tasks.Tasks) {
      throw new Error("Google Tasks service is unavailable.");
    }
    const existingTitles = new Set();
    /** @type {string | null} */
    let pageToken = null;
    do {
      /** @type {{ showCompleted: boolean, pageToken?: string }} */
      const options = { showCompleted: false };
      if (pageToken) options.pageToken = pageToken;
      const existingResp = Tasks.Tasks.list(listId, options);
      const existingItems = (existingResp && existingResp.items) || [];
      for (let i = 0; i < existingItems.length; i++) {
        const task = existingItems[i];
        if (
          task &&
          task.status !== "completed" &&
          task.status !== "deleted" &&
          task.title
        ) {
          existingTitles.add(String(task.title).trim().toLowerCase());
        }
      }
      pageToken = (existingResp && existingResp.nextPageToken) || null;
    } while (pageToken);

    for (let i = 0; i < extracted.length; i++) {
      const item = extracted[i];
      if (!item || !item.title) continue;
      const normTitle = String(item.title).trim().toLowerCase();
      if (!normTitle || existingTitles.has(normTitle)) continue;
      const taskObj = {
        title: item.title,
        notes:
          "[Session " +
          sessionDate +
          " | " +
          (item.category || "Promise") +
          "] " +
          (item.notes || ""),
        due: normalizeTaskDue_(item.due, sessionDate)
      };
      const created = Tasks.Tasks.insert(taskObj, listId);
      existingTitles.add(normTitle);
      if (typeof Logger !== "undefined" && Logger.log) {
        Logger.log(
          "Created Task [" +
            ((created && created.id) || "new") +
            "]: " +
            taskObj.title
        );
      }
      createdTasks.push(created);
    }
  } finally {
    lock.releaseLock();
  }

  return {
    sessionDate: sessionDate,
    extractedCount: extracted.length,
    createdCount: createdTasks.length,
    tasks: createdTasks
  };
}

/**
 * Ticket 26: Receives outbound HTTPS POST audio cues from the Raspberry Pi classifier
 * and stores non-BANTER intents in CacheService for 60 seconds.
 */
function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doPost(e) {
  let body;
  try {
    const rawContents = (e && e.postData && e.postData.contents) || "{}";
    body = JSON.parse(rawContents);
  } catch (_error) {
    return jsonResponse_({ status: "ERROR", error: "Invalid JSON payload" });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse_({ status: "ERROR", error: "Invalid payload" });
  }

  try {
    assertGmAccess_(body.gmKey);
  } catch (_error) {
    return jsonResponse_({ status: "ERROR", error: "Unauthorized" });
  }

  if (!["MUSIC_CUE", "RULE_QUERY", "BANTER"].includes(body.intent)) {
    return jsonResponse_({ status: "ERROR", error: "Invalid payload" });
  }

  try {
    if (body.intent === "BANTER") {
      return jsonResponse_({ status: "OK", cached: false });
    }

    const cue = {
      intent: body.intent,
      mood: body.mood !== undefined ? body.mood : null,
      rule: body.rule !== undefined ? body.rule : null,
      tier: body.tier || "TIER_1_PI_LOCAL",
      timestamp: body.timestamp || Date.now()
    };

    const canCache =
      typeof CacheService !== "undefined" && CacheService.getScriptCache;
    if (canCache) {
      const cache = CacheService.getScriptCache();
      cache.put("sof_latest_audio_cue", JSON.stringify(cue), 60);
      if (
        cue.intent === "RULE_QUERY" &&
        typeof cue.rule === "string" &&
        cue.rule.trim()
      ) {
        cache.put(
          "sof_latest_companion_rule_query",
          JSON.stringify({
            intent: "RULE_QUERY",
            rule: cue.rule.trim().slice(0, 200),
            timestamp: cue.timestamp
          }),
          60
        );
      }
    }

    return jsonResponse_({ status: "OK", cached: Boolean(canCache) });
  } catch (_error) {
    return jsonResponse_({
      status: "ERROR",
      error: "Unable to process webhook"
    });
  }
}

/**
 * Ticket 26: Returns the latest cached audio intent cue from CacheService for GM Screen polling.
 */
function getLatestAudioCue(gmKey) {
  assertGmAccess_(gmKey);
  if (typeof CacheService === "undefined" || !CacheService.getScriptCache) {
    return null;
  }
  const raw = CacheService.getScriptCache().get("sof_latest_audio_cue");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

/**
 * Returns only a player-safe Rule Query cue, never GM-only audio manifest data.
 */
function getLatestRuleQueryCueForCompanion() {
  if (typeof CacheService === "undefined" || !CacheService.getScriptCache) {
    return null;
  }
  const raw = CacheService.getScriptCache().get(
    "sof_latest_companion_rule_query"
  );
  if (!raw) return null;

  try {
    const cue = JSON.parse(raw);
    if (
      !cue ||
      cue.intent !== "RULE_QUERY" ||
      typeof cue.rule !== "string" ||
      !cue.rule.trim()
    ) {
      return null;
    }
    return {
      intent: "RULE_QUERY",
      rule: cue.rule.trim().slice(0, 200),
      timestamp: Number.isFinite(cue.timestamp) ? cue.timestamp : null
    };
  } catch (_e) {
    return null;
  }
}

/**
 * Resolves the parent "Sessions" folder using the verified ID.
 */
function resolveSessionsRoot_() {
  const props = PropertiesService.getScriptProperties();
  const cachedRootId =
    props.getProperty("SOF_SESSIONS_ROOT_ID") || SESSIONS_ROOT_ID;
  try {
    const folder = DriveApp.getFolderById(cachedRootId);
    props.setProperty("SOF_SESSIONS_ROOT_ID", folder.getId());
    return folder;
  } catch (_e) {
    const rootIter = DriveApp.getFoldersByName("Sea of Fortune");
    if (rootIter.hasNext()) {
      const sessionsIter = rootIter.next().getFoldersByName("Sessions");
      if (sessionsIter.hasNext()) {
        const f = sessionsIter.next();
        props.setProperty("SOF_SESSIONS_ROOT_ID", f.getId());
        return f;
      }
    }
    throw new Error("Sessions root folder could not be found.");
  }
}

/**
 * Resolves Sea of Fortune -> Sessions -> sessionDate.
 */
function resolveSessionFolder_(sessionDate) {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty("SESSION_" + sessionDate);
  if (cachedId) {
    try {
      return DriveApp.getFolderById(cachedId);
    } catch (_e) {}
  }
  const sessionsFolder = resolveSessionsRoot_();
  const targetIter = sessionsFolder.getFoldersByName(sessionDate);
  if (!targetIter.hasNext()) {
    throw new Error(
      'Session folder "' + sessionDate + '" not found in Sessions root.'
    );
  }
  const targetFolder = targetIter.next();
  props.setProperty("SESSION_" + sessionDate, targetFolder.getId());
  return targetFolder;
}
