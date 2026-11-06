# Coding Standards

Read during `/code-review` (Standards axis) and when extending cross-boundary seams. Skip anything `npm run check` already enforces mechanically (`tsc`, `eslint`, `stylelint`, `markdownlint-cli2`, `prettier`, `validate_session_artifacts.py`, `vitest`, `knip`).

## Domain & Architecture Pointers

- **Ubiquitous language:** [`GLOSSARY.md`](GLOSSARY.md). Name new functions, UI labels, test descriptions, and issue titles using the canonical terms (`Session`, `Session Asset`, `Shortcut Folder`, `GM Screen`, `Pinned Pane`, `Table Notes`, `Session Manifest`, `Encounter Dossier`, `Monster Statblock`, `Floor Map`, `Handout`, `Tabletop Mixer`, `Mood Cue`, `Audio Timeline Sidecar`, `Player Companion`, `Push-to-Talk Rules Sniffer`, `Rule Card`, `Speech Chunk`, `Attendance Quorum`, `Narrative Promise`).
- **Architectural constraints (`docs/adr/`):**
  - [`0001-google-apps-script-architecture.md`](docs/adr/0001-google-apps-script-architecture.md) — Apps Script `HtmlService` + Google Drive backend.
  - [`0002-base64-asset-inlining.md`](docs/adr/0002-base64-asset-inlining.md) — _(Superseded by ADR-0004)_.
  - [`0003-iframe-anchor-navigation-isolation.md`](docs/adr/0003-iframe-anchor-navigation-isolation.md) — `<base target="_self" />` and capture-phase hash link interception inside srcdoc iframes.
  - [`0004-google-edge-cdn-image-delivery.md`](docs/adr/0004-google-edge-cdn-image-delivery.md) — `https://lh3.googleusercontent.com/d/<fileId>` image delivery with `/preview` iframe fallback.
  - [`0005-native-v8-with-virtual-typechecking.md`](docs/adr/0005-native-v8-with-virtual-typechecking.md) — Author `Code.gs` in native V8 JS; validate via virtual `tsc` and Node VM tests.
  - [`0006-client-side-minisearch-tactical-engine.md`](docs/adr/0006-client-side-minisearch-tactical-engine.md) — In-memory `MiniSearch` indexing with BM25+ field boosting.
  - [`0007-drive-v3-bearer-fetch-indexeddb-audio-cache.md`](docs/adr/0007-drive-v3-bearer-fetch-indexeddb-audio-cache.md) — `getAudioAuthToken()` + Drive v3 `alt=media` fetch into `IndexedDB` (`sof_audio_cache_v1`) and write-ahead `localStorage` Audio Timeline Sidecar.
  - [`0008-companion-isolation-and-os-dictation-fallback.md`](docs/adr/0008-companion-isolation-and-os-dictation-fallback.md) — Server-side `?view=companion` isolation, `assertGmAccess_` RPC token guard, and native OS dictation input.
  - [`0009-edge-pi-classifier-tiered-fallback.md`](docs/adr/0009-edge-pi-classifier-tiered-fallback.md) — Edge Raspberry Pi Silero VAD chunking and 3-tier classifier failover (`Tier 1 Pi Local <= 1500ms` → `Tier 2 Gemini 2.5 Flash` → `Tier 3 Manual UI`) via `doPost(e)` + `CacheService`.

## Cross-Boundary Rules

1. **Server-Side Isolation for Security Boundaries (`Code.gs` + `Index.html`):**
   Gate GM-only markup (`#sidebar`, `#workspace`) behind Apps Script server-side template scriptlets (`<? if (typeof viewMode === "undefined" || viewMode !== "companion") { ?>`) and guard GM-only `Code.gs` entrypoints with `assertGmAccess_(gmKey)`. Use client-side DOM removal (`el.remove()`) as a defense-in-depth layer, never CSS `display: none` alone.

2. **Apps Script Public Entrypoints vs Private Helpers (`Code.gs`, `Index.html`):**
   Name public `google.script.run` and user-invokable trigger entrypoints in `camelCase` without a
   trailing underscore (`getSessionManifest`, `auditCalendarQuorum`).
   Name internal helpers and time-driven trigger callbacks that must remain unavailable to browser
   RPCs with a trailing underscore, including `resolveSessionFolder_`, `assertGmAccess_`,
   `getClientGmKey_`, `auditCalendarQuorumTrigger_`, and `pruneRuleFeedbackRateLimitsTrigger_`.
   Keep privileged scheduled callbacks private; expose a separate guarded RPC entrypoint if browser
   access is also needed.

3. **Shared Fallback Schema Parity (`Code.gs` ↔ `Index.html`):**
   Keep server-side fallback payloads and client-side offline fallbacks on a single object shape (for example, Rule Card glossary entries use `{ id, title, source, summary, tags }` in both `getCoreStarterGlossary_()` and `DEFAULT_GLOSSARY`).

4. **Single Test Harness Seam (`test/helpers/client-harness.ts`, `test/mocks/google-apps-script.ts`):**
   Route all client DOM, Web Audio, `IndexedDB`, and `google.script.run` test setup through [`setupClientHarness`](test/helpers/client-harness.ts) and all server VM mocks through [`setupGoogleAppsScriptMocks`](test/mocks/google-apps-script.ts). When adding a new top-level client function in `Index.html` that tests exercise directly, export it in `setupClientHarness`'s return block.
