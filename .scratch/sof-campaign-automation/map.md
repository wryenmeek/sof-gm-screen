# [Wayfinder Map] Sea of Fortune Campaign Automation & Tactical GM Cockpit

**Labels:** `wayfinder:map`

## Destination

Transform the Sea of Fortune Game Master workspace into an end-to-end tactical cockpit: embedding client-side in-memory MiniSearch (BM25+) for sub-millisecond lookups, an offline-first IndexedDB Web Audio mixer driven by in-browser WebGPU Gemma 4 E2B intent classification, a Raspberry Pi Stage 1 Silero VAD edge audio chunker, a responsive mobile Player Companion HUD with Push-to-Talk rules queries, and zero-token Google Workspace background governance (Calendar RSVP quorum & Tasks promise extraction).

## Notes

- **Domain Glossary:** Strictly adhere to terms in `GLOSSARY.md` (_Encounter Dossier_, _Monster Statblock_, _Floor Map_, _Handout_, _GM Screen_, _Pinned Pane_, _Table Notes_, _Session Manifest_).
- **Architectural Rules:** Respect ADRs:
  - `ADR-0001`: Apps Script Web App Architecture.
  - `ADR-0003`: Iframe Anchor Navigation Isolation (`<base target="_self">` and capture-phase click interceptors).
  - `ADR-0004`: Google Edge CDN image delivery (`https://lh3.googleusercontent.com/d/<id>`) with Drive `/preview` iframe fallback.
  - `ADR-0005`: Native V8 runtime with virtual TypeScript checks and Node VM tests.
  - `ADR-0006`: Client-Side In-Memory MiniSearch Tactical Engine (superseding WASM SQLite Base64 serialization).
- **Tracker:** Local markdown tracker under `.scratch/sof-campaign-automation/issues/` (exportable to GitHub via `scripts/sync-issues-to-github.sh`).

## Decisions So Far

- [ADR-0001: Apps Script Architecture](docs/adr/0001-google-apps-script-architecture.md): Zero-cost hosting backed by Google Drive folder hierarchy.
- [ADR-0003: Anchor Navigation](docs/adr/0003-iframe-anchor-navigation-isolation.md): Injected click interceptors prevent iframe anchor jumps from hijacking top window.
- [ADR-0004: Edge CDN Delivery](docs/adr/0004-google-edge-cdn-image-delivery.md): Edge CDN URLs replace Base64 memory bloat on large floor maps.
- [ADR-0005: Native V8 Virtual Typing](docs/adr/0005-native-v8-with-virtual-typechecking.md): Native JS in Apps Script with Vitest and `@types/google-apps-script`.
- [ADR-0006: MiniSearch Engine](docs/adr/0006-client-side-minisearch-tactical-engine.md): In-memory BM25+ indexing replaces WASM SQLite Base64 syncing.
- [Blueprint Decision: IndexedDB Audio Pre-Caching](https://docs.google.com/document/d/1098ijVBIXpH1DydhLTwcYdC2COmi_NRoSYMYrGhFAr4/edit): Pre-fetching audio assets into browser storage eliminates live Drive streaming latency and CORS errors.
- [Blueprint Decision: Stage 1 Silero VAD Edge Chunker](https://docs.google.com/document/d/1098ijVBIXpH1DydhLTwcYdC2COmi_NRoSYMYrGhFAr4/edit): Raspberry Pi runs Silero VAD over Blue Snowball mic (<2% CPU), stripping 30–50% dead air and saving timestamped `.wav` chunks to `audio_chunks/` for post-session processing.
- [Blueprint Decision: In-Browser WebGPU Gemma 4 E2B](https://docs.google.com/document/d/1098ijVBIXpH1DydhLTwcYdC2COmi_NRoSYMYrGhFAr4/edit): Zero-install browser inference via WebGPU (MediaPipe / Transformers.js) classifies audio intent into music cues and rule lookups directly in the browser tab, with Gemini Flash cloud fallback.

## The Active Frontier (Ready to Implement)

1. [01: Core In-Memory MiniSearch Manifest Indexing](issues/01-minisearch-manifest-indexing.md) _(In Progress)_
2. [04: IndexedDB Audio Pre-Caching Engine](issues/04-indexeddb-audio-precaching.md) _(Unblocked)_
3. [07: Universal Mobile Responsive Viewport & Player HUD](issues/07-mobile-responsive-viewport.md) _(Unblocked)_
4. [09: Standalone 72-Hour Calendar Attendance Quorum Auditor](issues/09-calendar-attendance-quorum.md) _(Unblocked)_
5. [10: Gemini Post-Session Promise Extractor to Google Tasks](issues/10-tasks-promise-extractor.md) _(Unblocked)_
6. [11: Raspberry Pi Stage 1 Silero VAD Audio Chunker](issues/11-rpi-silero-vad-chunker.md) _(Unblocked)_

## Blocked Tickets

- [02: 5e Statblock & Dossier Multi-Field Tokenizer](issues/02-statblock-dossier-tokenizer.md) _(Blocked by 01)_
- [03: BM25+ Ranking, Field Boosting & Keyboard Shortcut](issues/03-bm25-boosting-and-ui.md) _(Blocked by 02)_
- [05: Web Audio API 3-Channel Mixer & Gain Ducking](issues/05-web-audio-mixer-ducking.md) _(Blocked by 04)_
- [06: Digital Sidecar Audio Logger](issues/06-audio-timeline-sidecar.md) _(Blocked by 05)_
- [08: Mobile Push-to-Talk Rules Sniffer & Feedback Logger](issues/08-mobile-ptt-feedback-logger.md) _(Blocked by 07)_
- [12: In-Browser WebGPU Gemma 4 E2B Audio Intent Classifier](issues/12-webgpu-gemma-intent-classifier.md) _(Blocked by 05, 11)_

## Not Yet Specified (Fog of War)

- **Post-Session Demucs Stem Separation Pipeline:** Python batch script for isolating voice stems from the pre-segmented `audio_chunks/` directory.
- **Studio Audio Remaster Alignment Script:** Merging original 320kbps Tabletop Audio MP3 tracks with clean vocal chunks based on `session_audio_timeline.json`.
- **NotebookLM Source Auto-Sync:** Awaiting public developer REST API / Google Apps Script connector from Google Labs.

## Out of Scope

- Live continuous audio streaming across Google Drive during active play.
- Localhost Python daemon dependencies on the GM laptop.
- Continuous ambient mobile listening (battery drain, TV score false positives).
- Inaudible ultrasonic watermarking (harmful to domestic pets).
- Multi-mic wireless Wi-Fi streaming (acoustic comb filtering and jitter).
- Relational SQLite compilation and Base64 syncing over Apps Script RPCs.
