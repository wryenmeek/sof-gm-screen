# Sea of Fortune GM Dashboard (Google Apps Script Web App)

A lightweight Single-Page Application (SPA) GM Dashboard built on Google Apps Script `HtmlService` to browse, pin, and view all session assets (HTML interactive screens, Markdown dossiers, high-res floor maps, and audio logs) directly from Google Drive while running live sessions.

---

## Live Web App URLs

* **Active Production URL (v3):**  
  [https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec](https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec)
* **Direct 2026-10-31 Session URL:**  
  [https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec?session=2026-10-31](https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec?session=2026-10-31)
* **Script Editor:**  
  [https://script.google.com/d/1WzexkauxHjTuUjkucL_EyxKjnqddDkdwvlPg7aqk2cZRLiEK3HjEXOad/edit](https://script.google.com/d/1WzexkauxHjTuUjkucL_EyxKjnqddDkdwvlPg7aqk2cZRLiEK3HjEXOad/edit)

---

## What Was Fixed in v3:

1. **Fixed Gilded Prisoner & GM Screen Sticky Nav Headers**:
   * **Root Cause:** Parent `<base target="_top">` was hijacking anchor jumps (`<a href="#lore">`), attempting to navigate the top-level Google Script window instead of scrolling the iframe viewport.
   * **Fix:** Injected `<base target="_self">` and capture-phase (`useCapture = true`) click interceptors into `<head>` so internal anchor links (`#lore`, `#setup`, `#phases`, `#threats`, `#rituals`, `#clock`, `#visions`, `#after`) immediately call `scrollIntoView({ behavior: 'smooth', block: 'start' })` inside the iframe.
   * Also patched both local and Google Drive files directly (`GM_Guide_Trapped_Nereid_Encounter.html` and `Hotel_Lapis_Session_GM_Screen.html`) with native smooth-scroll click handlers.
2. **Reliable Image Rendering (Base64 Data URIs)**:
   * Converted images under 8MB to Base64 data URIs so they render 100% reliably in any browser sandbox without third-party cookie blocks.
3. **Folder Shortcuts Unpacked**:
   * Inspects `application/vnd.google-apps.shortcut` targets via Drive API.
   * Unpacks all items inside `1. Floor Maps`, `2. Floor Specific NPCs...`, and `3. Monsters` into the sidebar under clean category badges.
4. **5e Monster Statblock Styling**:
   * Pre-processes Homebrewery statblocks (`{monster,frame,wide`, `::`, `{bonus ...}`).
   * Strips outer triple-backtick markdown fences (```` ```markdown ````).
   * Renders with custom dark gold 5e statblock cards, stat tables, and crimson action headers.

---

## Local Development Workflow

```bash
# Push changes to Apps Script:
npx @google/clasp push -f

# Create a new versioned deployment:
npx @google/clasp deploy --description "Your change description"
```
