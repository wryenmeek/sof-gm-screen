# 05: Web Audio API 3-Channel Mixer & Gain Ducking

**What to build:** Native HTML5 Web Audio API mixer playing local pre-cached audio blobs across 3 distinct channels (Continuous Ambience, Dynamic Score, and One-Shot SFX) with 4-second linear crossfades and automated -8dB score ducking on SFX triggers.

**Blocked by:** 04: IndexedDB Audio Pre-Caching Engine

**Status:** completed

- [x] `AudioContext` initializes with Channel 1 (Ambience), Channel 2 (Score), and Channel 3 (SFX) routing to master output.
- [x] Channel 1 plays seamless continuous audio loops at 15–20% baseline volume directly from local ArrayBuffers.
- [x] Switching tracks on Channel 2 executes a smooth 4-second linear gain ramp (`linearRampToValueAtTime`) crossfade.
- [x] Firing an SFX on Channel 3 automatically ducks Channel 2 by -8dB for 1.5 seconds before smoothly restoring volume.
- [x] Audio outputs directly to the system default audio device (extended over HDMI to TV soundbar).
- [x] Vitest test asserts correct gain ramp scheduling and timer intervals for the ducking state machine.
