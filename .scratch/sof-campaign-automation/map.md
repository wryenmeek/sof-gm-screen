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

## Decisions So Far (Resolved Tickets)

- [01: Core In-Memory MiniSearch Manifest Indexing](issues/01-minisearch-manifest-indexing.md): In-memory MiniSearch indexes session manifests on load with prefix and fuzzy search (`82e462c`).
- [02: 5e Statblock & Dossier Multi-Field Tokenizer](issues/02-statblock-dossier-tokenizer.md): Homebrewery statblock attributes (AC, HP, vulnerabilities, immunities) and markdown headers tokenize into `title`, `tags`, `properties`, and `content` (`9820f9a`).
- [03: BM25+ Ranking, Field Boosting & Keyboard Shortcut](issues/03-bm25-boosting-and-ui.md): Configured BM25+ field boosting (`title: 3.0`, `tags: 2.5`, `properties: 2.0`, `content: 1.0`) and `/` / `Escape` keyboard shortcuts (`f78b0f9`).
- [04: IndexedDB Audio Pre-Caching Engine](issues/04-indexeddb-audio-precaching.md): `AudioCache` stores binary audio `ArrayBuffer` payloads by Drive `fileId` and updates `#audio-cache-status`.
- [05: Web Audio API 3-Channel Mixer & Gain Ducking](issues/05-web-audio-mixer-ducking.md): `TabletopMixer` manages 3 independent gain channels with 4-second crossfades and automated -8dB score ducking for 1.5s on SFX playback.
- [06: Digital Sidecar Audio Logger](issues/06-audio-timeline-sidecar.md): `flushAudioTimeline()` and `saveAudioTimeline()` persist deduplicated event logs to `session_audio_timeline.json`.
- [07: Universal Mobile Responsive Viewport & Player HUD](issues/07-mobile-responsive-viewport.md): `@media (width <= 768px)` switches to `#player-hud` with `localStorage` character identity persistence.
- [08: Mobile Push-to-Talk Rules Sniffer & Feedback Logger](issues/08-mobile-ptt-feedback-logger.md): 4-second PTT window, 30-second auto-dismiss rule cards, and `logRuleFeedback()` appending votes to `Rules_Helper_Feedback` in Google Sheets.
- [09: Standalone 72-Hour Calendar Attendance Quorum Auditor](issues/09-calendar-attendance-quorum.md): `auditCalendarQuorum()` shifts sessions forward 14 days when confirmed guests < 3 and injects Harptos dates and weather when quorum is met.
- [10: Gemini Post-Session Promise Extractor to Google Tasks](issues/10-tasks-promise-extractor.md): `extractNarrativePromises()` parses `table_notes.md` via Gemini structured JSON and inserts non-duplicate tasks into Google Tasks.
- [11: Raspberry Pi Stage 1 Silero VAD Audio Chunker](issues/11-rpi-silero-vad-chunker.md): `scripts/rpi_vad_chunker.py` gates 16kHz mono PCM speech bursts and writes `audio_chunks/chunk_NNNN_start_end.wav` + `session_audio_manifest.json`.
- [12: In-Browser WebGPU Gemma 4 E2B Audio Intent Classifier](issues/12-webgpu-gemma-intent-classifier.md): `handleAudioIntent()` routes structured `MUSIC_CUE` and `RULE_QUERY` classifications directly to `TabletopMixer` and the Rule Card HUD.

## The Active Frontier

- All 12 specified tickets are resolved and verified.

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
