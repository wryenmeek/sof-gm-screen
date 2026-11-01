/**
 * Sea of Fortune GM Screen - Apps Script Backend
 * Serves live session materials, maps, statblocks, and notes from Google Drive.
 */

const SESSIONS_ROOT_ID = '1MnppB86ysCIlqS-c023Ss96rx5vHEnjT';

function doGet(e) {
  const sessionDate = (e && e.parameter && e.parameter.session) ? e.parameter.session : '2026-10-31';
  const template = HtmlService.createTemplateFromFile('Index');
  template.sessionDate = sessionDate;
  return template.evaluate()
    .setTitle('Sea of Fortune GM Dashboard - ' + sessionDate)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
    // Exclude checkpoint/hidden folders
    if (!name.startsWith('.')) {
      list.push(name);
    }
  }
  // Sort descending so newest session dates (YYYY-MM-DD) appear first
  return list.sort((a, b) => b.localeCompare(a));
}

/**
 * Resolves session folder by date and builds a recursive file manifest.
 * Traverses subfolders and shortcuts (e.g., 1. Floor Maps, 3. Monsters).
 */
function getSessionManifest(sessionDate) {
  const folder = resolveSessionFolder_(sessionDate);
  const manifest = [];
  
  function scanFolder(f, prefix = "") {
    // 1. Files in current folder
    const files = f.getFiles();
    while (files.hasNext()) {
      let file = files.next();
      let mime = file.getMimeType();
      let id = file.getId();
      let name = file.getName();
      
      // Resolve shortcuts if applicable
      if (mime === "application/vnd.google-apps.shortcut") {
        try {
          id = file.getTargetId();
          file = DriveApp.getFileById(id);
          mime = file.getMimeType();
        } catch(e) {
          // If shortcut target unresolvable, continue
        }
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

    // 2. Recurse into subfolders & folder shortcuts
    const subfolders = f.getFolders();
    while (subfolders.hasNext()) {
      const sub = subfolders.next();
      let targetFolder = sub;
      // Handle folder shortcuts if present
      if (sub.getMimeType && sub.getMimeType() === "application/vnd.google-apps.shortcut") {
        try {
          targetFolder = DriveApp.getFolderById(sub.getTargetId());
        } catch(e) {}
      }
      scanFolder(targetFolder, prefix + sub.getName() + " / ");
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

  // 1. Images: High-performance direct CDN link (Prevents Apps Script memory limits)
  if (mime.startsWith('image/')) {
    return {
      id: fileId,
      type: 'image',
      name: name,
      content: 'https://lh3.googleusercontent.com/d/' + fileId
    };
  }

  // 2. Audio: Streaming preview player for large session recordings
  if (mime.startsWith('audio/')) {
    return {
      id: fileId,
      type: 'audio',
      name: name,
      content: 'https://drive.google.com/file/d/' + fileId + '/preview'
    };
  }

  // 3. Native Google Docs: Export to HTML on the fly
  if (mime === MimeType.GOOGLE_DOCS) {
    const url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=text/html';
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    });
    return {
      id: fileId,
      type: 'html',
      name: name,
      content: response.getContentText()
    };
  }

  // 4. HTML and Markdown: Resolve relative images to Drive CDN links
  let rawText = file.getBlob().getDataAsString();
  rawText = resolveRelativeImages_(rawText, sessionDate);
  const isMarkdown = name.endsWith('.md') || mime === 'text/markdown';

  return {
    id: fileId,
    type: isMarkdown ? 'markdown' : 'html',
    name: name,
    content: rawText
  };
}

/**
 * Replaces relative image filenames in MD/HTML with Google CDN direct URLs.
 */
function resolveRelativeImages_(text, sessionDate) {
  const folder = resolveSessionFolder_(sessionDate);
  return text.replace(/(?:src=["']|!\[.*?\]\()([^"'\)\s]+\.(?:png|jpg|jpeg|webp|gif))["'\)]/gi, (match, filename) => {
    const cleanName = filename.split('/').pop();
    const files = folder.getFilesByName(cleanName);
    if (files.hasNext()) {
      const imgFile = files.next();
      const cdnUrl = 'https://lh3.googleusercontent.com/d/' + imgFile.getId();
      return match.replace(filename, cdnUrl);
    }
    return match;
  });
}

/**
 * Loads existing content from table_notes.md in the session folder, or returns a default template.
 */
function getScratchpadNotes(sessionDate) {
  const folder = resolveSessionFolder_(sessionDate);
  const files = folder.getFilesByName('table_notes.md');
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
    content: '# Session Table Notes (' + sessionDate + ')\n\n- Initiative:\n- Rulings:\n- Loot distributed:\n',
    updated: 'Not saved yet'
  };
}

/**
 * Saves or overwrites table_notes.md in the session folder.
 */
function saveScratchpadNotes(sessionDate, content) {
  const folder = resolveSessionFolder_(sessionDate);
  const files = folder.getFilesByName('table_notes.md');
  let file;
  if (files.hasNext()) {
    file = files.next();
    file.setContent(content);
  } else {
    file = folder.createFile('table_notes.md', content, 'text/markdown');
  }
  return {
    id: file.getId(),
    updated: new Date().toLocaleTimeString()
  };
}

/**
 * Resolves the parent "Sessions" folder using the verified ID.
 */
function resolveSessionsRoot_() {
  const props = PropertiesService.getScriptProperties();
  const cachedRootId = props.getProperty('SOF_SESSIONS_ROOT_ID') || SESSIONS_ROOT_ID;
  try {
    const folder = DriveApp.getFolderById(cachedRootId);
    props.setProperty('SOF_SESSIONS_ROOT_ID', folder.getId());
    return folder;
  } catch (e) {
    // Fallback: search by name if ID fails
    const rootIter = DriveApp.getFoldersByName('Sea of Fortune');
    if (rootIter.hasNext()) {
      const sessionsIter = rootIter.next().getFoldersByName('Sessions');
      if (sessionsIter.hasNext()) {
        const f = sessionsIter.next();
        props.setProperty('SOF_SESSIONS_ROOT_ID', f.getId());
        return f;
      }
    }
    throw new Error('Sessions root folder could not be found.');
  }
}

/**
 * Resolves Sea of Fortune -> Sessions -> sessionDate.
 */
function resolveSessionFolder_(sessionDate) {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('SESSION_' + sessionDate);
  if (cachedId) {
    try {
      return DriveApp.getFolderById(cachedId);
    } catch (e) {}
  }
  const sessionsFolder = resolveSessionsRoot_();
  const targetIter = sessionsFolder.getFoldersByName(sessionDate);
  if (!targetIter.hasNext()) {
    throw new Error('Session folder "' + sessionDate + '" not found in Sessions root.');
  }
  const targetFolder = targetIter.next();
  props.setProperty('SESSION_' + sessionDate, targetFolder.getId());
  return targetFolder;
}
