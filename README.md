# Sea of Fortune GM Dashboard (Google Apps Script Web App)

A lightweight Single-Page Application (SPA) GM Dashboard built on Google Apps Script `HtmlService` to browse, pin, and view all session assets (HTML interactive screens, Markdown dossiers, high-res floor maps, and audio logs) directly from Google Drive while running live sessions.

---

## Live Web App URLs

- **Active Production URL (v3):**  
  [https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec](https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec)
- **Direct 2026-10-31 Session URL:**  
  [https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec?session=2026-10-31](https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec?session=2026-10-31)
- **Script Editor:**  
  [https://script.google.com/d/1WzexkauxHjTuUjkucL_EyxKjnqddDkdwvlPg7aqk2cZRLiEK3HjEXOad/edit](https://script.google.com/d/1WzexkauxHjTuUjkucL_EyxKjnqddDkdwvlPg7aqk2cZRLiEK3HjEXOad/edit)

---

## What Was Fixed in v3

1. **Fixed Gilded Prisoner & GM Screen Sticky Nav Headers**:
   - **Root Cause:** Parent `<base target="_top">` was hijacking anchor jumps (`<a href="#lore">`), attempting to navigate the top-level Google Script window instead of scrolling the iframe viewport.
   - **Fix:** Injected `<base target="_self">` and capture-phase (`useCapture = true`) click interceptors into `<head>` so internal anchor links (`#lore`, `#setup`, `#phases`, `#threats`, `#rituals`, `#clock`, `#visions`, `#after`) immediately call `scrollIntoView({ behavior: 'smooth', block: 'start' })` inside the iframe.
   - Also patched both local and Google Drive files directly (`GM_Guide_Trapped_Nereid_Encounter.html` and `Hotel_Lapis_Session_GM_Screen.html`) with native smooth-scroll click handlers.
2. **High-Performance Image Rendering (Google Edge CDN & Preview Fallback)**:
   - Delivers images instantly via Google's edge CDN (`lh3.googleusercontent.com/d/<id>`) with zero Apps Script server memory overhead.
   - Includes automatic client-side fallback to Google Drive `/preview` iframes for unshared files.
3. **Folder Shortcuts Unpacked**:
   - Inspects `application/vnd.google-apps.shortcut` targets via Drive API.
   - Unpacks all items inside `1. Floor Maps`, `2. Floor Specific NPCs...`, and `3. Monsters` into the sidebar under clean category badges.
4. **5e Monster Statblock Styling**:
   - Pre-processes Homebrewery statblocks (`{ monster, frame, wide }`, `::`, `{bonus ...}`).
   - Strips outer triple-backtick markdown fences (` ```markdown `).
   - Renders with custom dark gold 5e statblock cards, stat tables, and crimson action headers.

---

## Local Development Workflow

```bash
# Run the full automated verification suite (TypeScript, ESLint, Stylelint, Markdownlint, Prettier, Vitest, Knip, Artifacts):
npm run check

# Run unit tests in watch mode:
npm test

# Format all project files:
npm run format

# Push changes to Google Apps Script:
npm run push

# Deploy new version to production:
npm run deploy
```

## Apps Script deployment and GM access

The normal GM Screen deployment uses the manifest's signed-in access setting. The Raspberry Pi cannot use that deployment without Google OAuth, so give it a separate Web app deployment rather than changing the normal deployment's access:

1. In Apps Script **Project Settings → Script properties**, set `SOF_GM_KEY` to a long, randomly generated secret. Do not put the value in this repository or commit it.
2. Keep the normal GM Screen deployment restricted to signed-in Google users. From **Deploy → New deployment → Web app**, create a separate Pi webhook deployment with **Execute as: Me** and **Who has access: Anyone** (anonymous). Keep its `/exec` URL private; the `doPost` handler checks `SOF_GM_KEY` before caching any cue.
3. On the Raspberry Pi, set `SOF_GM_KEY` to the same secret and `SOF_WEBHOOK_URL` to the separate anonymous deployment URL. The chunker supports these environment variables; do not point it at the signed-in GM Screen deployment.
4. Add `gmKey=<URL-encoded secret>` to the GM Screen URL alongside the session parameter (for example, `?session=2026-10-31&gmKey=...`). Treat that URL as a credential and share it only with the GM.
5. In the Apps Script editor, select `setupGovernanceTriggers_` and click **Run** once. This editor-only entrypoint reads `SOF_GM_KEY` from Script Properties and installs the Wednesday governance audit plus daily feedback-rate-limit cleanup. The public `installGovernanceTriggers(gmKey)` RPC remains GM-key guarded.
6. When updating the project, push the code and update both deployments to the new version; preserve each deployment's distinct access setting.

The secret is checked server-side for GM RPCs and Pi webhook posts. An absent or mismatched script property/key fails closed.
