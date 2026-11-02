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

function doGet(e) {
  const sessionDate =
    e && e.parameter && e.parameter.session
      ? e.parameter.session
      : "2026-10-31";
  const template = HtmlService.createTemplateFromFile("Index");
  template.sessionDate = sessionDate;
  return template
    .evaluate()
    .setTitle("Sea of Fortune GM Dashboard - " + sessionDate)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/**
 * Returns a sorted array of all session folder names inside Sessions/.
 */
function getSessionList() {
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
function getSessionManifest(sessionDate) {
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
function getFilePayload(fileId, sessionDate) {
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
function getScratchpadNotes(sessionDate) {
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
function saveScratchpadNotes(sessionDate, content) {
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
function saveAudioTimeline(sessionDate, jsonString) {
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
        const seenTimestamps = new Set(existing.map((e) => e.timestamp));
        const newOnly = incomingEvents.filter(
          (e) => !seenTimestamps.has(e.timestamp)
        );
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
 * Ticket 08: Logs crowdsourced player rule card feedback to Rules_Helper_Feedback in Google Sheets.
 */
function logRuleFeedback(data) {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(FEEDBACK_SHEET_PROP);
  const payload = {
    timestamp: new Date().toISOString(),
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
      sheet.appendRow([
        "Timestamp",
        "Player",
        "Heard Phrase",
        "Matched Card",
        "Vote",
        "Source File"
      ]);
    }
    sheet.appendRow([
      payload.timestamp,
      payload.player,
      payload.phrase,
      payload.cardTitle,
      payload.vote,
      payload.source
    ]);
  }

  return { status: "logged", entry: payload };
}

/**
 * Ticket 09: Audits Calendar event RSVP attendance 72 hours prior to Saturday sessions.
 * Reschedules forward by 14 days if fewer than 3 players confirm YES, or injects Harptos weather context.
 */
function auditCalendarQuorum(eventId, inGameContext) {
  if (typeof CalendarApp === "undefined") {
    throw new Error("CalendarApp service is unavailable.");
  }
  const cal = CalendarApp.getDefaultCalendar();
  const event = cal.getEventById(eventId);
  if (!event) {
    throw new Error("Calendar event not found: " + eventId);
  }

  const guests = event.getGuestList();
  const confirmed = guests.filter(
    (g) => g.getGuestStatus() === CalendarApp.GuestStatus.YES
  );
  const quorumMet = confirmed.length >= 3;

  if (!quorumMet) {
    const start = event.getStartTime();
    const end = event.getEndTime();
    const nextStart = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
    const nextEnd = new Date(end.getTime() + 14 * 24 * 60 * 60 * 1000);
    event.setTime(nextStart, nextEnd);
    event.setDescription(
      "[RESCHEDULED: Quorum < 3 confirmed players (" +
        confirmed.length +
        "/3)] Shifted to next alternate Saturday."
    );
    return {
      quorumMet: false,
      confirmedCount: confirmed.length,
      rescheduledTo: nextStart.toISOString()
    };
  }

  const ctx = inGameContext || {
    harptosDate: "14 Tarsakh, 1494 DR",
    planarAlignment: "Astral Coterminous",
    weather: "Warm sulfur mist, calm shoals"
  };
  const briefing =
    "=== Sea of Fortune Tactical Brief ===\n" +
    "Harptos Date: " +
    ctx.harptosDate +
    "\n" +
    "Planar Alignment: " +
    ctx.planarAlignment +
    "\n" +
    "Weather: " +
    ctx.weather;
  event.setDescription(briefing);

  return {
    quorumMet: true,
    confirmedCount: confirmed.length,
    description: briefing
  };
}

/**
 * Ticket 10: Extracts narrative promises, crafting timers, and open rulings from table_notes.md
 * via Gemini structured JSON output and inserts non-duplicate entries into Google Tasks.
 */
function extractNarrativePromises(sessionDate, taskListId) {
  const listId = taskListId || "@default";
  const scratchpad = getScratchpadNotes(sessionDate);
  const notesText = scratchpad.content || "";

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
      responseMimeType: "application/json"
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
    const existingTitles = new Set(existingItems.map((t) => t.title));

    for (let i = 0; i < extracted.length; i++) {
      const item = extracted[i];
      if (!item.title || existingTitles.has(item.title)) {
        continue;
      }
      const inserted = Tasks.Tasks.insert(
        {
          title: item.title,
          notes:
            "[Session " +
            sessionDate +
            " | " +
            (item.category || "Promise") +
            "] " +
            (item.notes || ""),
          due: item.due || undefined
        },
        listId
      );
      existingTitles.add(item.title);
      createdTasks.push(inserted);
    }
  }

  return {
    sessionDate: sessionDate,
    extractedCount: extracted.length,
    createdCount: createdTasks.length,
    tasks: createdTasks
  };
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
