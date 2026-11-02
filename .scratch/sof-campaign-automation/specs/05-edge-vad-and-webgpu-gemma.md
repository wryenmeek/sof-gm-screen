# Spec: Real-Time Edge VAD Chunker & In-Browser WebGPU Gemma 4 E2B Classifier

**Status:** `ready-for-agent`

## Problem Statement

Triggering dynamic music transitions and surfacing rule cards manually during live tabletop play distracts the Game Master, while running a localhost Python LLM daemon on the GM laptop introduces fragile host dependencies (Python, pip, virtualenvs, PyAudio C bindings) that break when switching laptops. Furthermore, recording a single monolithic 4-hour 220MB MP3 captures 30–50% dead air and inflates post-session processing costs.

## Solution

Split the runtime audio pipeline cleanly across two zero-friction stages:

1. **Stage 1 Edge Chunker (Raspberry Pi):** The Home Assistant Raspberry Pi captures audio from the Blue Snowball (Cardioid #1, rear null aimed at the TV soundbar) and runs Silero VAD (<2% CPU) to filter silence. It writes timestamped speech `.wav` chunks (`audio_chunks/chunk_NNNN_start_end.wav`) directly to disk for post-session processing while streaming active speech frames over WebRTC.
2. **Stage 2 In-Browser WebGPU Classifier (`Index.html`):** The GM laptop browser receives active speech frames (with WebRTC Acoustic Echo Cancellation) and runs quantized **Gemma 4 E2B** directly on the laptop GPU via WebGPU (MediaPipe / Transformers.js). Detected music cues immediately trigger Channel 2 4-second crossfades in the Web Audio mixer, while rule queries surface cards on the HUD.

## User Stories

1. As a Game Master, I want the Raspberry Pi to automatically slice table speech into timestamped `.wav` chunks and discard dead air, so that post-session transcription and Gemini lore extraction cost 50% fewer tokens.
2. As a Game Master, I want to open the GM Screen Web App on any modern laptop and have Gemma 4 E2B run directly inside the browser via WebGPU without installing Python or local servers.
3. As a Game Master, I want the model weights cached in browser IndexedDB after the first download, so that subsequent sessions boot in under 2 seconds offline.
4. As a Game Master, I want dramatic combat triggers ("roll initiative!", rising tactical urgency) to automatically crossfade Channel 2 to combat music over HDMI.
5. As a Game Master, I want casual table banter classified as `BANTER` and ignored during live play and post-session processing.
6. As a Game Master, I want the browser to automatically fall back to Gemini Flash API (or Manual Audio Mode) if opened on a device without WebGPU support.

## Implementation Decisions

- **Stage 1 VAD:** Silero VAD ONNX model on Raspberry Pi writing 16kHz mono `.wav` files and `session_audio_manifest.json`.
- **Acoustic Isolation:** Blue Snowball Cardioid setting + browser WebRTC `echoCancellation: true`.
- **Stage 2 Inference:** WebGPU runtime in `Index.html` outputting `{ intent: 'MUSIC_CUE' | 'RULE_QUERY' | 'BANTER', mood, rule }`.

## Testing Decisions

- **Unit Tests:** Vitest tests in `test/client.test.ts` and `test/audio_engine.test.ts` validating intent dispatch to `TabletopMixer` and rule card rendering.

## Out of Scope

- Localhost Python daemon installation on the GM laptop.
- Continuous open-mic transcription of dead air.
