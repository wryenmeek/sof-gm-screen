# Research: Apps Script Web App Auth & Multi-User Access for BYOD Player Companion

**Ticket:** [02: Apps Script Web App Auth & Multi-User Access for BYOD Player Companion](../issues/02-apps-script-player-companion-auth.md)
**Date:** 2026-11-02

## Executive Summary

1. **Deployment Configuration for BYOD Players:** To allow players on personal smartphones to open the **Player Companion** at the table without sharing the GM's Google Drive campaign folder or triggering a scary Google OAuth consent screen on every player's phone, the Web App must be deployed with **`Execute as: Me (the GM)`** and **`Who has access: Anyone`** (or `Anyone with Google account`).
2. **The `google.script.run` Security Boundary:** In Google Apps Script `HtmlService`, **every top-level server function in `Code.gs` whose name does not end with an underscore (`_`) is exposed on the client-side `google.script.run` bridge**, regardless of which HTML template `doGet(e)` returned.
   - Relying solely on CSS `@media` queries in `Index.html` leaks GM data into the DOM and exposes it if a player rotates their phone or inspects DevTools.
   - Serving a separate `Companion.html` template via `doGet(e)` (`?view=companion`) prevents casual DOM/viewport leakage, **but a player who opens browser DevTools can still invoke `google.script.run.getSessionManifest()`, `getFilePayload()`, or `getScratchpadNotes()`** because the script executes with the GM's authority (`Execute as: Me`).
3. **Why `Session.getActiveUser().getEmail()` Fails for Consumer Gmail Under `Execute as: Me`:** Per Google's `Session` reference documentation, when a Web App runs as `Execute as: Me` outside a shared Google Workspace domain (i.e., standard consumer `@gmail.com` accounts), `Session.getActiveUser().getEmail()` returns an **empty string (`""`)** for all visitors other than the script owner. Thus, `getActiveUser().getEmail() === Session.getEffectiveUser().getEmail()` only succeeds when the GM themselves is logged in and recognized in the same browser context, or requires a separate authorization mechanism.
4. **Comparison of Isolation Architectures:**
   - **Option A — Separate `?view=companion` HTML Template (`doGet(e)` routing):** Prevents accidental UI/rotation spoilers and strips GM markup from the smartphone DOM, with zero extra deployment overhead. Does *not* stop deliberate DevTools `google.script.run` calls unless paired with a server-side guard.
   - **Option B — Single Deployment + Server-Side GM Passcode/Token Guard (or `Session` Owner Check):** Stores a `GM_ACCESS_KEY` in `PropertiesService.getScriptProperties()` (passed via URL query `?gmKey=...` or `localStorage` by the GM's iPad/desktop and verified by a private helper `assertGmAuthorized_(gmKey)` before any GM-only `Code.gs` function executes). Public player functions (`logRuleFeedback`, glossary lookups) require no key.
   - **Option C — Separate Player Companion Apps Script Web App Deployment:** Deploys a standalone lightweight script bound only to the `Rules_Helper_Feedback` Google Sheet and public D&D 5e Glossary. Provides hard capability isolation (`DriveApp` is never authorized or exposed), at the cost of maintaining two script deployments/URLs.

---

## 1. Web App Deployment Matrix (`Execute as` vs. `Who has access`)

Per the [Google Apps Script Web Apps Guide](https://developers.google.com/apps-script/guides/web#deploy_a_script_as_a_web_app) and [Permissions Guide](https://developers.google.com/apps-script/guides/services/authorization):

| Deployment Setting | `Execute as: Me (GM)` | `Execute as: User accessing the web app` |
| :--- | :--- | :--- |
| **Authority Used for `DriveApp` / `SpreadsheetApp`** | Runs under the GM's Google account credentials (`Session.getEffectiveUser()`). | Runs under the visiting player's Google account credentials. |
| **Google Drive Sharing Requirement** | **None.** The GM's `Sea of Fortune/Sessions` folder and `Rules_Helper_Feedback` Sheet remain private to the GM. | Players **must** be granted Drive read/write access to every underlying folder, file, and Sheet touched by the script. |
| **Player OAuth Consent Screen** | **None.** Players open the URL and immediately see the UI without an OAuth security warning. | Every player is forced through Google's "unverified app wants access to your Google Drive/Sheets" OAuth consent flow on first load. |
| **`Session.getActiveUser().getEmail()` Behavior** | Returns `""` (blank string) for external `@gmail.com` visitors; returns the GM's email when accessed by the GM (if signed into the same browser profile) or within the same Google Workspace domain. | Returns the visiting player's email address after they grant OAuth consent. |

**Verdict on Deployment Mode:** `Execute as: User accessing the web app` is unviable for a table BYOD companion because it requires granting players Drive permissions to the campaign folders (or fails with permission errors) and blocks table onboarding behind an "Unverified App" OAuth warning screen. The deployment **must remain `Execute as: Me` with `Who has access: Anyone`**.

---

## 2. The `google.script.run` Client-Server Security Boundary

Per the [Google Apps Script HTML Service Communication Guide (`google.script.run`)](https://developers.google.com/apps-script/guides/html/communication#private_functions):

- When `HtmlService` evaluates and serves *any* HTML file from an Apps Script project, the client runtime injects the `google.script.run` asynchronous bridge containing stubs for **every global function in the Apps Script project that does not end with an underscore (`_`)**.
- **Existing `Code.gs` Exposure:** In `Code.gs`, the following top-level functions are public (no trailing underscore):
  - `getSessionList()`
  - `getSessionManifest(sessionDate)`
  - `getFilePayload(fileId, sessionDate)`
  - `getScratchpadNotes(sessionDate)`
  - `saveScratchpadNotes(sessionDate, content)`
  - `saveAudioTimeline(sessionDate, jsonString)`
  - `logRuleFeedback(data)`
  - `auditCalendarQuorum(eventId, inGameContext)`
  - `extractNarrativePromises(sessionDate, taskListId)`
- Only helper functions ending with `_` (`getDriveCdnUrl_`, `resolveRelativeImages_`, `resolveSessionsRoot_`, `resolveSessionFolder_`) are hidden from `google.script.run`.

### Why CSS Media Queries Alone Are Insufficient

If `doGet(e)` serves the same `Index.html` bundle to both the GM's tablet and a player's smartphone and uses CSS `@media (max-width: 768px)` to hide the GM sidebar/panes:

1. `Index.html` still runs its startup `google.script.run.getSessionList()` and `getSessionManifest(sessionDate)` calls on load, downloading the full encounter manifest and GM notes into the phone's browser memory.
2. Rotating the phone into landscape or requesting the "Desktop Site" in Mobile Safari/Chrome crosses the CSS breakpoint and immediately reveals the GM's **Encounter Dossiers** and **Table Notes**.

### What `doGet(e)` Routing (`?view=companion`) Solves — And What It Doesn't

Routing in `doGet(e)` via `e.parameter.view === "companion"` (per [Request Parameters in `doGet(e)`](https://developers.google.com/apps-script/guides/web#url_parameters)):

```javascript
function doGet(e) {
  const view = e && e.parameter && e.parameter.view ? e.parameter.view : "gm";
  if (view === "companion") {
    return HtmlService.createTemplateFromFile("Companion")
      .evaluate()
      .setTitle("Sea of Fortune — Player Companion")
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }
  // existing GM Index template...
}
```

- **Protects against:** Accidental spoilers, phone rotation, "Request Desktop Site", and casual DOM inspection, because `Companion.html` only contains the **Player Companion** UI (voice/text rule lookup + `logRuleFeedback` voting) and never calls `getSessionManifest()` or renders GM panes.
- **Does NOT protect against:** A curious player opening browser DevTools and executing `google.script.run.withSuccessHandler(console.log).getScratchpadNotes("2026-10-31")`, because `getScratchpadNotes` is still a public top-level function on the shared project.

---

## 3. Comparing Architectures for Protecting GM-Only Endpoints

To prevent unauthorized invocation of GM-only functions (`getSessionList`, `getSessionManifest`, `getFilePayload`, `getScratchpadNotes`, `saveScratchpadNotes`, `saveAudioTimeline`, `auditCalendarQuorum`, `extractNarrativePromises`), we compare three architectures:

| Criterion | 1. `?view=companion` Template Only (No RPC Guard) | 2. Single Web App + `?view=companion` + Server-Side Guard (`GM_TOKEN` or `Session` check) | 3. Separate Player Companion Web App Project |
| :--- | :--- | :--- | :--- |
| **Blocks phone rotation / Desktop mode spoilers** | Yes | Yes | Yes |
| **Blocks DevTools `google.script.run` calls** | **No** | **Yes** | **Yes (Hard isolation)** |
| **Works on consumer `@gmail.com` with `Execute as: Me`** | Yes | Yes (with `ScriptProperties` token; `getActiveUser()` alone is unreliable across third-party cookie boundaries) | Yes |
| **Deployment / Repo Complexity** | Single `clasp` project & single `/exec` URL | Single `clasp` project & single `/exec` URL (`?view=companion` for players, `?key=...` or prompt for GM) | Requires two Apps Script projects, two deployments, and duplicated glossary code |

### Why `Session.getActiveUser().getEmail()` Alone Is Fragile

Per the [Google Apps Script `Session.getActiveUser()` Reference](https://developers.google.com/apps-script/reference/base/session#getActiveUser()):

- When deployed as `Execute as: Me`, `Session.getActiveUser().getEmail()` returns `""` for any user outside the developer's Google Workspace domain.
- Even when the GM opens the `/exec` URL themselves, `HtmlService` runs inside a sandboxed `*.googleusercontent.com` iframe (`script.googleusercontent.com`). On iPad Safari (Intelligent Tracking Prevention) or incognito/multi-account sessions, the iframe may not resolve the active Google session cookie, causing `Session.getActiveUser().getEmail()` to return `""` even for the GM!
- Therefore, relying solely on `Session.getActiveUser().getEmail() === Session.getEffectiveUser().getEmail()` risks locking the GM out on iPad Safari.

### Recommended Pattern: `doGet(e)` `?view=companion` Template + `ScriptProperties` GM Passcode Guard

If DevTools isolation is desired within the single Apps Script repository:

1. **Separate HTML Entrypoint (`?view=companion`):** `doGet(e)` checks `e.parameter.view === "companion"` and serves `Companion.html` (or conditionally excludes all GM markup/scripts via server-side HTML scriptlets `<? if (view !== 'companion') { ?>...<? } ?>` before `.evaluate()`). Because Apps Script `<? ... ?>` template scriptlets execute on Google's servers *before* the HTML is sent to the browser, the client never receives GM HTML or JS when `view=companion`.
2. **Private Guard Helper (`assertGmAccess_(token)`):** Store a lightweight passphrase or secret in `PropertiesService.getScriptProperties().getProperty("SOF_GM_KEY")`. If set, GM-only public functions verify `token === expectedKey` (or fall back to `Session.getActiveUser().getEmail() === Session.getEffectiveUser().getEmail()`) before returning Drive/Sheet data, while `logRuleFeedback(data)` remains open to all companion clients.

---

## Primary Sources

1. **Google Apps Script — Web Apps Guide (`doGet(e)`, `e.parameter`, Deployment Permissions):**
   - <https://developers.google.com/apps-script/guides/web>
2. **Google Apps Script — HTML Service: Communicate with Server Functions (`google.script.run` & Private Functions `_`):**
   - <https://developers.google.com/apps-script/guides/html/communication#private_functions>
3. **Google Apps Script — HTML Service: Templated HTML (Server-side `<? ... ?>` scriptlets evaluated before client delivery):**
   - <https://developers.google.com/apps-script/guides/html/templates>
4. **Google Apps Script — `Session` Class Reference (`getActiveUser()` vs. `getEffectiveUser()` email visibility rules):**
   - <https://developers.google.com/apps-script/reference/base/session#getActiveUser()>
   - <https://developers.google.com/apps-script/reference/base/session#getEffectiveUser()>
5. **Repository Source Code & ADR:**
   - [`docs/adr/0001-google-apps-script-architecture.md`](../../../docs/adr/0001-google-apps-script-architecture.md)
   - [`Code.gs`](../../../Code.gs) (`doGet` lines 17–29; public `google.script.run` endpoints vs. private `_*` helpers)
