# 12: In-Browser WebGPU Gemma 4 E2B Audio Intent Classifier

**What to build:** Zero-install, client-side audio intent classifier in `Index.html` using WebGPU (MediaPipe GenAI / Transformers.js) to run quantized Gemma 4 E2B directly in the browser tab, classifying incoming speech chunks into music cues (`combat`, `exploration`, `tension`, `rest`) and rule queries, with an automatic fallback to Gemini Flash over WebSocket if WebGPU is unavailable.

**Blocked by:** 05: Web Audio API 3-Channel Mixer & Gain Ducking, 11: Raspberry Pi Stage 1 Silero VAD Audio Chunker

**Status:** completed

- [x] Detects `navigator.gpu` availability on boot and loads quantized `gemma-4-E2B-it` into persistent browser IndexedDB/Origin Cache.
- [x] Consumes active speech frames from WebRTC (with browser Acoustic Echo Cancellation enabled against HDMI output).
- [x] Classifies audio into structured JSON `{ intent: 'MUSIC_CUE' | 'RULE_QUERY' | 'BANTER', mood, rule }`.
- [x] `MUSIC_CUE` shifts immediately trigger `TabletopMixer.crossfadeScore(mood)` in the same browser context with zero network latency.
- [x] `RULE_QUERY` matches display the corresponding rule card in the GM Screen and Mobile Player HUD.
- [x] Falls back gracefully to Gemini Flash API (or Manual Mode) on devices without WebGPU support.
- [x] Vitest unit test verifies intent JSON routing to the Web Audio mixer and rule card display.
