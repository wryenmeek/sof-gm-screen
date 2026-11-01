# Sea of Fortune GM Dashboard (Google Apps Script Web App)

A lightweight Single-Page Application (SPA) GM Dashboard built on Google Apps Script `HtmlService` to browse, pin, and view all session assets (HTML interactive screens, Markdown dossiers, high-res floor maps, and audio logs) directly from Google Drive while running live sessions.

---

## Live Web App URLs

* **Production URL (v1):**  
  [https://script.google.com/macros/s/AKfycby7lTxcREYdEa14bv9pXZaIkyw2Z6Pan3R41S3YEF5OeA3Uatq6cbJjGkOvhk_xSKlp9g/exec](https://script.google.com/macros/s/AKfycby7lTxcREYdEa14bv9pXZaIkyw2Z6Pan3R41S3YEF5OeA3Uatq6cbJjGkOvhk_xSKlp9g/exec)
* **Direct 2026-10-31 Session URL:**  
  [https://script.google.com/macros/s/AKfycby7lTxcREYdEa14bv9pXZaIkyw2Z6Pan3R41S3YEF5OeA3Uatq6cbJjGkOvhk_xSKlp9g/exec?session=2026-10-31](https://script.google.com/macros/s/AKfycby7lTxcREYdEa14bv9pXZaIkyw2Z6Pan3R41S3YEF5OeA3Uatq6cbJjGkOvhk_xSKlp9g/exec?session=2026-10-31)
* **Script Editor:**  
  [https://script.google.com/d/1WzexkauxHjTuUjkucL_EyxKjnqddDkdwvlPg7aqk2cZRLiEK3HjEXOad/edit](https://script.google.com/d/1WzexkauxHjTuUjkucL_EyxKjnqddDkdwvlPg7aqk2cZRLiEK3HjEXOad/edit)

---

## Features & Optimizations

1. **Subfolder & Shortcut Traversal**:
   * Recursively enumerates files inside child folders (e.g. `1. Floor Maps`, `2. Floor Specific NPCs...`, `3. Monsters`) and resolves Drive shortcuts (`application/vnd.google-apps.shortcut`) automatically.
2. **Direct Google CDN Image Proxying**:
   * Rather than encoding large images as Base64 in memory (which crashes Apps Script's 2MB RPC limit), maps and images load directly via `https://lh3.googleusercontent.com/d/{fileId}` for instant, zero-memory rendering.
3. **Split-Screen Pinning**:
   * Click **"Pin to Right ➔"** on any battle map, hazard 1-pager, or statblock to lock it into the right pane while continuing to browse notes on the left.
4. **Live Table Notes Scratchpad**:
   * Built-in drawer reads and writes directly to `table_notes.md` in the active session's Drive folder.
   * Press `Ctrl+S` or `Cmd+S` to save instantly with automated manifest refresh.
5. **Interactive Audio Streaming**:
   * Automatically embeds streaming audio players for large session recordings (e.g. `recording_20261031_121246.mp3`) without blowing up script memory.
6. **Dynamic Session Selector**:
   * Dropdown lists all session dates in `Sea of Fortune/Sessions/` sorted newest-first. Switching sessions reloads files and table notes without resetting pinned reference maps.

---

## Local Development Workflow

All files are versioned in `sof-gm-screen/`:

```bash
# Push changes to Apps Script:
npx @google/clasp push -f

# Create a new versioned deployment:
npx @google/clasp deploy --description "Your change description"

# Open the active web app in browser:
npx @google/clasp open --webapp
```
