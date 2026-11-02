# 06: Digital Sidecar Audio Logger (session_audio_timeline.json)

**What to build:** Automatic event logger in the Web Audio mixer that records track names, event types (LOOP, CROSSFADE, SFX), volumes, and millisecond timestamps, saving `session_audio_timeline.json` to the session folder on game close.

**Blocked by:** 05: Web Audio API 3-Channel Mixer & Gain Ducking

**Status:** completed

- [x] Web Audio mixer pushes timestamped event records `{ timestamp, track, channel, eventType, gain }` to an in-memory array.
- [x] Apps Script function `saveAudioTimeline(sessionDate, jsonString)` is added to `Code.gs`.
- [x] On window unload or manual "Save Table Notes", the timeline array is flushed to `session_audio_timeline.json` in the active session Drive folder.
- [x] If `session_audio_timeline.json` already exists, new events append cleanly without overwriting earlier milestones.
- [x] Vitest test asserts timeline JSON serialization format and schema consistency.
