# Sea of Fortune GM Screen (Google Apps Script Web App)

A tactical Single-Page Application (SPA) **GM Screen**, 3-channel **Tabletop Mixer**, server-isolated **Player Companion**, Google Workspace governance engine, and Raspberry Pi 3-tier **Speech Chunk** classifier built on Google Apps Script `HtmlService` (`ADR-0001` through `ADR-0010`).

---

## Live Web App URLs

- **Active Production URL (v3):**
  [https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec](https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec)
- **GM Screen Session URL (with GM Key):**
  [https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec?session=2026-10-31](https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec?session=2026-10-31) _(append `&gmKey=<URL-encoded secret>` when `SOF_GM_KEY` is set)_
- **Player Companion URL (Mobile BYOD):**
  [https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec?view=companion&session=2026-10-31](https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec?view=companion&session=2026-10-31)
- **Script Editor:**
  [https://script.google.com/d/1WzexkauxHjTuUjkucL_EyxKjnqddDkdwvlPg7aqk2cZRLiEK3HjEXOad/edit](https://script.google.com/d/1WzexkauxHjTuUjkucL_EyxKjnqddDkdwvlPg7aqk2cZRLiEK3HjEXOad/edit)

---

## Core Architecture & Subsystems

1. **GM Screen & Client-Side In-Memory Tactical Search ([ADR-0001](docs/adr/0001-google-apps-script-architecture.md), [ADR-0003](docs/adr/0003-iframe-anchor-navigation-isolation.md), [ADR-0004](docs/adr/0004-google-edge-cdn-image-delivery.md), [ADR-0006](docs/adr/0006-client-side-minisearch-tactical-engine.md)):**
   - Unpacks **Shortcut Folders** (`1. Floor Maps`, `2. Floor Specific NPCs...`, `3. Monsters`) and delivers **Floor Maps** via Google's Edge CDN (`lh3.googleusercontent.com/d/<fileId>`) with automatic `/preview` iframe fallback.
   - Indexes the active **Session Manifest**, **Monster Statblocks**, and **Encounter Dossiers** in browser RAM using `MiniSearch` with BM25+ field boosting (`title: 3.0`, `tags: 2.5`, `properties: 2.0`, `content: 1.0`), fuzzy typo tolerance (`0.2`), and `/` + `Escape` keyboard navigation.
2. **Pre-Cached IndexedDB Tabletop Mixer & Audio Timeline Sidecar ([ADR-0007](docs/adr/0007-drive-v3-bearer-fetch-indexeddb-audio-cache.md)):**
   - Pre-caches audio **Session Assets** into `IndexedDB` (`sof_audio_cache_v1`, 30-day LRU eviction) via direct Google Drive v3 `alt=media` bearer fetches.
   - Routes tracks across 3 Web Audio channels—Channel 1 (Ambience `0.18`), Channel 2 (Score `0.50` with 4-second linear **Mood Cue** crossfades), and Channel 3 (One-Shot SFX `0.85` with `-8dB` score ducking)—through a master `DynamicsCompressorNode`.
   - Persists mixer transitions to a `localStorage` write-ahead log (`sof_audio_timeline_<sessionDate>`) and co-flushes deduplicated events to `session_audio_timeline.json` on **Table Notes** saves.
3. **Server-Isolated Player Companion & Push-to-Talk Rules Sniffer ([ADR-0008](docs/adr/0008-companion-isolation-and-os-dictation-fallback.md)):**
   - Serves `?view=companion` from `doGet(e)` with server-side scriptlet isolation so GM-only `#sidebar` and `#workspace` markup never ships to player smartphones, while guarding GM RPCs with `assertGmAccess_`.
   - Loads the unified **Rules Glossary** into `rulesMiniSearch`, supporting native iOS/Android OS keyboard voice dictation (`#ptt-dictation-input`, 900ms debounce), 30-second auto-dismissing **Rule Cards**, and rate-limited crowdsourced feedback logging (`logRuleFeedback`) to `Rules_Helper_Feedback`.
4. **Zero-Token Google Workspace Governance ([ADR-0010](docs/adr/0010-workspace-governance-quorum-and-on-demand-promises.md)):**
   - **72-Hour Attendance Quorum (`auditCalendarQuorum`):** Runs Wednesdays at 12:00 PM against Saturday `"Dnd"` / `"Sea of Fortune"` Calendar events with a `0`-guest safeguard (`SKIPPED_NO_GUESTS`), `+14d` rescheduling when `< 3` confirm `YES` or a **Storyline Lock** player responds `NO`, and a `2d8` **Weather Hexflower** forecast injected inside managed `<!-- SOF_QUORUM_AUTOMATION:START/END -->` description markers.
   - **On-Demand Narrative Promise Extractor (`extractNarrativePromises`):** Triggered explicitly from the **Table Notes** header (`#extract-promises-btn`), parsing `table_notes.md` via `gemini-2.5-flash` (`responseSchema`) and deduplicating against open and completed Google Tasks across all pages.
5. **Edge Raspberry Pi Silero VAD Chunker & 3-Tier Classifier ([ADR-0009](docs/adr/0009-edge-pi-classifier-tiered-fallback.md)):**
   - Slices 16kHz mono PCM speech into `audio_chunks/chunk_<NNNN>_<start_ms>_<end_ms>.wav` and `session_audio_manifest.json` using Silero VAD (`scripts/rpi_vad_chunker.py`).
   - Classifies each **Speech Chunk** into an **Audio Cue** (`MUSIC_CUE`, `RULE_QUERY`, `BANTER`) via **Tier 1** (Pi local model `<= 1500ms` worker deadline) → **Tier 2** (Gemini 2.5 Flash HTTPS failover) → **Tier 3** (Manual **GM Screen** controls), delivering cues via Apps Script `doPost(e)` and `CacheService` (`sof_latest_audio_cue`).

---

## Configuration Reference

### Apps Script `ScriptProperties`

Configure these in **Project Settings → Script properties** inside the Google Apps Script editor:

| Property                                       | Required       | Purpose                                                                                                                                           |
| ---------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOF_GM_KEY`                                   | Recommended    | Shared secret guarding GM-only RPCs (`assertGmAccess_`) and Raspberry Pi `doPost(e)` webhook posts.                                               |
| `GEMINI_API_KEY`                               | For Promises   | Google Gemini API key used by `extractNarrativePromises` (`gemini-2.5-flash`).                                                                    |
| `SOF_FEEDBACK_SHEET_ID`                        | For Rule Votes | Google Spreadsheet ID where `logRuleFeedback` appends 6-column rows to the `Rules_Helper_Feedback` tab.                                           |
| `SOF_SESSIONS_ROOT_ID`                         | Optional       | Override for the campaign's root `Sessions` Google Drive folder ID (cached automatically on discovery).                                           |
| `SOF_CALENDAR_QUERY`                           | Optional       | Custom regex/substring for matching campaign events in `auditCalendarQuorum` (defaults to `/dnd\|sea of fortune/i`).                              |
| `SOF_LOCKED_PLAYERS`                           | Optional       | Comma-separated emails or names of **Storyline Lock** players whose `NO` RSVP triggers a `+14d` reschedule.                                       |
| `SOF_INGAME_DATE`                              | Optional       | Current in-game maritime calendar date injected alongside the `2d8` **Weather Hexflower** forecast.                                               |
| `SESSION_<YYYY-MM-DD>` / `SOF_RULE_FEEDBACK_*` | Auto-managed   | Cached session folder IDs and rolling rate-limit counters managed automatically by `Code.gs` and pruned by `pruneRuleFeedbackRateLimitsTrigger_`. |

### Raspberry Pi Environment Variables (`scripts/rpi_vad_chunker.py`)

| Environment Variable   | CLI Flag Equivalency | Purpose                                                                                            |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `SOF_SILERO_VAD_MODEL` | `--vad-model`        | Filesystem path to the Silero VAD `.onnx` model used for Stage 1 speech gating.                    |
| `SOF_INTENT_MODEL`     | `--intent-model`     | Tier 1 local classifier command template (executed with a strict 1,500ms deadline).                |
| `GEMINI_API_KEY`       | —                    | Tier 2 cloud fallback API key (`gemini-2.5-flash`) used when Tier 1 times out, fails, or is unset. |
| `SOF_WEBHOOK_URL`      | `--webhook-url`      | Apps Script anonymous web app `/exec` URL receiving non-`BANTER` **Audio Cues** via HTTPS `POST`.  |
| `SOF_GM_KEY`           | —                    | Shared secret sent with outbound webhook posts to authenticate against `doPost(e)`.                |
| `SOF_ALSA_DEVICE`      | `--capture-device`   | ALSA capture interface name for live 16kHz mono PCM capture (defaults to `default`).               |

---

## Local Development Workflow

```bash
# Run the full automated verification suite (TypeScript, ESLint, Stylelint, Markdownlint, Prettier, Vitest, Knip, Artifacts):
npm run check

# Run unit tests:
npm test

# Format all project files:
npm run format

# Verify GitHub Actions CI locally in Docker with act:
bash scripts/act/run-act.sh "push -j check"

# Push changes to Google Apps Script:
npm run push

# Deploy new version to production:
npm run deploy
```

---

## Apps Script Deployment and GM Access

Keep the existing **GM Screen** deployment restricted to signed-in Google users. Apps Script deployments retain separate access settings; the Raspberry Pi and **Player Companion** users cannot use an owner-only deployment without Google OAuth, so use a separate Web app deployment where needed:

1. In Apps Script **Project Settings → Script properties**, set `SOF_GM_KEY` to a long, randomly generated secret. Do not put the value in this repository or commit it.
2. Keep the normal **GM Screen** deployment restricted to signed-in Google users (or create a separate **Execute as: Me** + **Who has access: Anyone** deployment for **Player Companion** `?view=companion` and Raspberry Pi `doPost` webhook access). Keep the `/exec` URL and `SOF_GM_KEY` private; `doPost` and GM-only RPCs verify `SOF_GM_KEY` on the server.
3. On Raspberry Pi OS 64-bit, from the repository root, install the classifier dependencies in a virtual environment:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install -r requirements-rpi.txt
   ```

   Then set `SOF_GM_KEY` to the same secret and `SOF_WEBHOOK_URL` to the anonymous deployment `/exec` URL. The chunker reads these environment variables; do not point it at a Google-login-gated deployment.

4. Add `gmKey=<URL-encoded secret>` to the **GM Screen** URL alongside the session parameter (for example, `?session=2026-10-31&gmKey=...`). Treat that URL as a credential and share it only with the GM. Share `?view=companion&session=2026-10-31` (without `gmKey`) with players.
5. In the Apps Script editor, select `setupGovernanceTriggers_` and click **Run** once. This editor-only entrypoint reads `SOF_GM_KEY` from Script Properties and installs the Wednesday governance audit plus daily feedback-rate-limit cleanup. The public `installGovernanceTriggers(gmKey)` RPC remains GM-key guarded.
6. When updating the project, push the code and update active deployments to the new version while preserving each deployment's distinct access setting.

When `SOF_GM_KEY` is configured, protected GM RPCs and Pi webhook posts require an exact match. If it is absent, protected GM RPCs are allowed only for a signed-in single-user request whose non-empty active-user email matches the effective deployment owner; anonymous or mismatched requests fail closed. The Pi `doPost` handler always requires the configured key.
