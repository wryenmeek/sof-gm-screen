# Spec: Pre-Cached IndexedDB Web Audio Engine & Tabletop DJ Mixer

**Status:** `ready-for-agent`

## Problem Statement

Running an immersive tabletop session requires continuous ambient soundscapes, dynamic score transitions during combat state shifts, and instant sound effects (cannon barrages, spell blasts). Streaming audio directly from Google Drive during live play incurs network jitter, buffering pauses, and CORS range-request throttling, while live cross-room audio playback clutters the physical GM cockpit.

## Solution

Embed an offline-first HTML5 Web Audio API mixer in `Index.html` that pre-caches Tabletop Audio MP3 loops and score tracks from Google Drive into browser `IndexedDB` storage ahead of the session. The mixer drives three distinct channels (Continuous Ambience, Dynamic Score, and One-Shot SFX) outputting over HDMI directly to the table TV sound system, with sample-accurate 4-second linear crossfading and automated -8dB gain ducking.

## User Stories

1. As a Game Master, I want audio assets to be pre-cached into browser IndexedDB on session selection, so that audio playback is 100% offline and free of Google Drive streaming buffering.
2. As a Game Master, I want Channel 1 to loop seamless 10-minute ambient audio beds at 15–20% baseline volume, so that the table maintains consistent environmental atmosphere.
3. As a Game Master, I want Channel 2 to execute a smooth 4-second crossfade between exploration, tension, and combat score tracks when I trigger a scene change.
4. As a Game Master, I want triggering a Channel 3 sound effect (e.g., cannon blast) to automatically duck Channel 2 music by -8dB for 1.5 seconds, so that sound effects punch through without audio clipping.
5. As a Game Master, I want the mixer to automatically log all audio events (track name, event type, timestamp) to `session_audio_timeline.json` in the active session Drive folder, so that post-session studio audio remastering can perfectly recreate the acoustic timeline.
6. As a Game Master, I want all mixed audio routed through the laptop HDMI cable to the TV speakers and soundbar, eliminating Bluetooth pairing latency.

## Implementation Decisions

- **Storage Engine:** Browser `IndexedDB` key-value store caching raw audio `ArrayBuffer` objects by Drive file ID.
- **Audio Pipeline:** Native `AudioContext` routing through three independent `GainNode` chains into a master compressor and destination output.
- **Ducking Logic:** `GainNode.gain.linearRampToValueAtTime()` triggered on SFX playback, attenuating score gain by -8dB and restoring over a 400ms release curve.
- **Sidecar Logger:** In-memory event array flushed to Google Drive via Apps Script `saveTimelineNotes()` upon session conclusion.

## Testing Decisions

- **Unit Testing:** Vitest mock tests for Web Audio `GainNode` ramp schedules, ducking parameter timers, and IndexedDB cache hit/miss resolution.
- **Prior Art:** Server tests in `test/server.test.ts`.

## Out of Scope

- Real-time cloud audio streaming during live sessions.
- Inaudible ultrasonic watermarks.
