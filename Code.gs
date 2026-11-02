/**
 * Sea of Fortune GM Screen - Apps Script Backend
 * Serves live session materials, maps, statblocks, and notes from Google Drive.
 */

const SESSIONS_ROOT_ID = "1MnppB86ysCIlqS-c023Ss96rx5vHEnjT";
const GOOGLE_EDGE_CDN_PREFIX = "https://lh3.googleusercontent.com/d/";
const FEEDBACK_SHEET_PROP = "SOF_FEEDBACK_SHEET_ID";

/**
 * Returns Google Edge CDN direct URL for a given file ID.
 */
function getDriveCdnUrl_(fileId) {
  return GOOGLE_EDGE_CDN_PREFIX + fileId;
}

/**
 * Server-side GM access guard for Execute as: Me deployments.
 * When ScriptProperty SOF_GM_KEY is configured, calls with a missing or
 * mismatched key throw an "Unauthorized GM RPC" error; when unset, calls succeed.
 */
function assertGmAccess_(gmKey) {
  const expected =
    PropertiesService.getScriptProperties().getProperty("SOF_GM_KEY");
  if (expected && gmKey !== expected) {
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
  template.viewMode =
    e && e.parameter && e.parameter.view === "companion" ? "companion" : "gm";
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
  const folder = resolveSessionFolder_(sessionDate);
  const fileName = "session_audio_timeline.json";
  const files = folder.getFilesByName(fileName);
  const incomingEvents = JSON.parse(jsonString || "[]");
  let merged = incomingEvents;
  let file;

  if (files.hasNext()) {
    file = files.next();
    try {
      const existing = JSON.parse(file.getBlob().getDataAsString() || "[]");
      if (Array.isArray(existing)) {
        const makeKey = (e) =>
          String(e.timestamp) +
          "|" +
          String(e.eventType || "") +
          "|" +
          String(e.track || "");
        const seenKeys = new Set(existing.map(makeKey));
        const newOnly = incomingEvents.filter((e) => !seenKeys.has(makeKey(e)));
        merged = existing.concat(newOnly);
      }
    } catch (_e) {}
    file.setContent(JSON.stringify(merged, null, 2));
  } else {
    file = folder.createFile(
      fileName,
      JSON.stringify(merged, null, 2),
      "application/json"
    );
  }

  return {
    id: file.getId(),
    count: merged.length,
    updated: new Date().toLocaleTimeString()
  };
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

/**
 * Ticket 08 & 23: Logs crowdsourced player rule card feedback to Rules_Helper_Feedback in Google Sheets.
 */
function logRuleFeedback(data) {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(FEEDBACK_SHEET_PROP);
  const payload = {
    timestamp: new Date().toISOString(),
    sessionDate: (data && data.sessionDate) || "2026-10-31",
    player: (data && data.player) || "Guest",
    phrase: (data && (data.phrase || data.heardPhrase)) || "",
    cardTitle: (data && data.cardTitle) || "",
    source: (data && data.source) || "D&D 5e Glossary",
    vote: (data && data.vote) || "+1"
  };

  if (sheetId && typeof SpreadsheetApp !== "undefined") {
    const ss = SpreadsheetApp.openById(sheetId);
    let sheet = ss.getSheetByName("Rules_Helper_Feedback");
    if (!sheet) {
      sheet = ss.insertSheet("Rules_Helper_Feedback");
    }
    sheet.appendRow([
      payload.timestamp,
      payload.sessionDate,
      payload.player,
      payload.phrase,
      payload.cardTitle,
      payload.vote
    ]);
  }

  return { status: "logged", entry: payload };
}

/**
 * Ticket 24: Idempotently installs the Wednesday 12:00 PM time-driven trigger for auditCalendarQuorum.
 */
function installGovernanceTriggers() {
  const existing = ScriptApp.getProjectTriggers();
  for (let i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === "auditCalendarQuorum") {
      return { installed: false };
    }
  }
  ScriptApp.newTrigger("auditCalendarQuorum")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.WEDNESDAY)
    .atHour(12)
    .create();
  return { installed: true };
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
function auditCalendarQuorum(targetDateStr, inGameContext) {
  if (typeof CalendarApp === "undefined") {
    throw new Error("CalendarApp service is unavailable.");
  }
  const props = PropertiesService.getScriptProperties();
  const cal = CalendarApp.getDefaultCalendar();
  let event = null;

  if (targetDateStr && typeof cal.getEventById === "function") {
    event = cal.getEventById(targetDateStr);
  }

  if (!event && typeof cal.getEvents === "function") {
    const startWindow = targetDateStr ? new Date(targetDateStr) : new Date();
    const endWindow = new Date(startWindow.getTime() + 7 * 24 * 60 * 60 * 1000);
    const customQuery = props.getProperty("SOF_CALENDAR_QUERY");
    const titleRegex = customQuery
      ? new RegExp(customQuery, "i")
      : /dnd|sea of fortune/i;
    const events = cal.getEvents(startWindow, endWindow) || [];
    for (let i = 0; i < events.length; i++) {
      const candidate = events[i];
      const title =
        candidate && typeof candidate.getTitle === "function"
          ? candidate.getTitle()
          : "";
      if (titleRegex.test(title)) {
        event = candidate;
        break;
      }
    }
  }

  if (!event) {
    throw new Error(
      "Calendar event not found: " + (targetDateStr || "upcoming")
    );
  }

  const guests = event.getGuestList() || [];
  if (guests.length === 0) {
    if (typeof Logger !== "undefined" && Logger.log) {
      Logger.log("Skipping quorum cancellation: 0 guests invited on event");
    }
    return {
      status: "SKIPPED_NO_GUESTS",
      confirmed: 0,
      confirmedCount: 0,
      quorumMet: false
    };
  }

  const confirmed = guests.filter(
    (g) => g.getGuestStatus() === CalendarApp.GuestStatus.YES
  );

  const lockedRaw = props.getProperty("SOF_LOCKED_PLAYERS") || "";
  const lockedTokens = lockedRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  let lockedDeclined = false;
  if (lockedTokens.length > 0) {
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i];
      if (g.getGuestStatus() === CalendarApp.GuestStatus.NO) {
        const email =
          typeof g.getEmail === "function"
            ? String(g.getEmail() || "").toLowerCase()
            : "";
        const name =
          typeof g.getName === "function"
            ? String(g.getName() || "").toLowerCase()
            : "";
        for (let k = 0; k < lockedTokens.length; k++) {
          const tok = lockedTokens[k];
          if (
            (email && (email === tok || email.includes(tok))) ||
            (name && (name === tok || name.includes(tok)))
          ) {
            lockedDeclined = true;
            break;
          }
        }
      }
    }
  }

  const quorumMet = confirmed.length >= 3 && !lockedDeclined;

  if (!quorumMet) {
    const start = event.getStartTime();
    const end = event.getEndTime();
    const nextStart = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
    const nextEnd = new Date(end.getTime() + 14 * 24 * 60 * 60 * 1000);
    event.setTime(nextStart, nextEnd);
    event.setDescription(
      "[RESCHEDULED: Quorum < 3 confirmed players or locked player unavailable (" +
        confirmed.length +
        "/3)] Shifted to next alternate Saturday."
    );
    return {
      status: "RESCHEDULED",
      quorumMet: false,
      confirmed: confirmed.length,
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
  event.setDescription(briefing);

  return {
    status: "QUORUM_MET",
    quorumMet: true,
    confirmed: confirmed.length,
    confirmedCount: confirmed.length,
    weather: hexWeather,
    inGameDate: inGameDate,
    description: briefing
  };
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
  const apiKey = props.getProperty("GEMINI_API_KEY") || "mock_key";
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

  const rawJson = JSON.parse(response.getContentText());
  let extracted = [];
  if (
    rawJson &&
    rawJson.candidates &&
    rawJson.candidates[0] &&
    rawJson.candidates[0].content &&
    rawJson.candidates[0].content.parts &&
    rawJson.candidates[0].content.parts[0]
  ) {
    const parsed = JSON.parse(rawJson.candidates[0].content.parts[0].text);
    extracted = parsed.tasks || [];
  } else if (rawJson && Array.isArray(rawJson.tasks)) {
    extracted = rawJson.tasks;
  }

  const createdTasks = [];
  if (typeof Tasks !== "undefined" && Tasks.Tasks) {
    const existingResp = Tasks.Tasks.list(listId);
    const existingItems = (existingResp && existingResp.items) || [];
    const existingTitles = new Set(
      existingItems.map((t) =>
        String(t.title || "")
          .trim()
          .toLowerCase()
      )
    );

    for (let i = 0; i < extracted.length; i++) {
      const item = extracted[i];
      if (!item || !item.title) {
        continue;
      }
      const normTitle = String(item.title).trim().toLowerCase();
      if (existingTitles.has(normTitle)) {
        continue;
      }
      const taskObj = {
        title: item.title,
        notes:
          "[Session " +
          sessionDate +
          " | " +
          (item.category || "Promise") +
          "] " +
          (item.notes || ""),
        due: item.due || undefined
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
  }

  return {
    sessionDate: sessionDate,
    extractedCount: extracted.length,
    createdCount: createdTasks.length,
    created: createdTasks.length,
    tasks: createdTasks
  };
}

/**
 * Ticket 26: Receives outbound HTTPS POST audio cues from the Raspberry Pi classifier
 * and stores non-BANTER intents in CacheService for 60 seconds.
 */
function doPost(e) {
  const rawContents = (e && e.postData && e.postData.contents) || "{}";
  const body = JSON.parse(rawContents);
  assertGmAccess_(body.gmKey);

  if (!body.intent || body.intent === "BANTER") {
    return { status: "OK", cached: false };
  }

  const cue = {
    intent: body.intent,
    mood: body.mood !== undefined ? body.mood : null,
    rule: body.rule !== undefined ? body.rule : null,
    tier: body.tier || "TIER_1_PI_LOCAL",
    timestamp: body.timestamp || Date.now()
  };

  if (typeof CacheService !== "undefined" && CacheService.getScriptCache) {
    CacheService.getScriptCache().put(
      "sof_latest_audio_cue",
      JSON.stringify(cue),
      60
    );
  }

  return { status: "OK", cached: true };
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
