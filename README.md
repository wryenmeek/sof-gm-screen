# Sea of Fortune GM Dashboard (Google Apps Script Web App)

A lightweight Single-Page Application (SPA) GM Dashboard built on Google Apps Script `HtmlService` to browse, pin, and view all session assets (HTML interactive screens, Markdown dossiers, high-res floor maps, and audio logs) directly from Google Drive while running live sessions.

---

## Live Web App URLs

* **Active Production URL (v2):**  
  [https://script.google.com/macros/s/AKfycbxWByqpfzgd6PcZw5vo6gnWHWBC6a-JgS3ZhM4EWbhs4ubTgLvpGkUWudBoSirNmDl4/exec](https://script.google.com/macros/s/AKfycbxWByqpfzgd6PcZw5vo6gnWHWBC6a-JgS3ZhM4EWbhs4ubTgLvpGkUWudBoSirNmDl4/exec)
* **Direct 2026-10-31 Session URL:**  
  [https://script.google.com/macros/s/AKfycbxWByqpfzgd6PcZw5vo6gnWHWBC6a-JgS3ZhM4EWbhs4ubTgLvpGkUWudBoSirNmDl4/exec?session=2026-10-31](https://script.google.com/macros/s/AKfycbxWByqpfzgd6PcZw5vo6gnWHWBC6a-JgS3ZhM4EWbhs4ubTgLvpGkUWudBoSirNmDl4/exec?session=2026-10-31)
* **Script Editor:**  
  [https://script.google.com/d/1WzexkauxHjTuUjkucL_EyxKjnqddDkdwvlPg7aqk2cZRLiEK3HjEXOad/edit](https://script.google.com/d/1WzexkauxHjTuUjkucL_EyxKjnqddDkdwvlPg7aqk2cZRLiEK3HjEXOad/edit)

---

## What Was Fixed in v2:

1. **Folder Shortcuts Unpacked**:
   * Inspects `application/vnd.google-apps.shortcut` targets via Drive API.
   * Unpacks all items inside `1. Floor Maps`, `2. Floor Specific NPCs...`, and `3. Monsters` into the sidebar under clean category badges.
2. **Reliable Image Rendering (Base64 Data URIs)**:
   * Converted images under 8MB to Base64 data URIs so they render 100% reliably in any browser sandbox without third-party cookie blocks.
3. **5e Monster Statblock Styling**:
   * Pre-processes Homebrewery statblocks (`{monster,frame,wide`, `::`, `{bonus ...}`).
   * Strips outer triple-backtick markdown fences (```` ```markdown ````).
   * Renders with custom dark gold 5e statblock cards, stat tables, and crimson action headers.
4. **Seamless Iframe Navigation**:
   * Injects cross-frame messaging into embedded HTML documents.
   * Smoothly scrolls internal `#hash` anchors within the iframe.
   * Intercepts relative links (e.g. `href="Herald_30_Chimes_Player_Printable.html"`) and signals the parent dashboard to open the companion handout directly.

---

## Local Development Workflow

```bash
# Push changes to Apps Script:
npx @google/clasp push -f

# Create a new versioned deployment:
npx @google/clasp deploy --description "Your change description"
```
