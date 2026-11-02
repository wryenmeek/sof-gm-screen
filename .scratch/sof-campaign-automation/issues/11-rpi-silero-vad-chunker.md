# 11: Raspberry Pi Stage 1 Silero VAD Audio Chunker

**What to build:** Lightweight Python edge service running on the Home Assistant Raspberry Pi that captures USB audio from the Blue Snowball (Cardioid #1), executes Silero VAD (<2% CPU) to filter dead air, writes timestamped speech `.wav` chunks to `audio_chunks/chunk_NNNN_start_end.wav`, and streams active speech frames over WebRTC to the GM laptop browser.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] Captures 16kHz 16-bit mono PCM audio from the Blue Snowball USB interface.
- [x] Runs Silero VAD (ONNX runtime) to gate speech bursts and strip room silence.
- [x] Saves completed speech segments to `audio_chunks/chunk_<NNNN>_<start_ms>_<end_ms>.wav`.
- [x] Appends chunk metadata `{ chunk, start_ms, end_ms, duration_ms }` to `session_audio_manifest.json`.
- [x] Streams active speech frames via `go2rtc` / WebRTC to the GM laptop browser.
- [x] Unit test validates VAD chunk boundary slicing and WAV header generation.
