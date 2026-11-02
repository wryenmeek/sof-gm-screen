#!/usr/bin/env python3
"""
Raspberry Pi Stage 1 Silero VAD Edge Audio Chunker (Ticket 11).
Captures 16kHz 16-bit mono PCM audio from the Blue Snowball (Cardioid #1),
gates active speech segments via VAD energy/Silero threshold, writes timestamped
speech .wav chunks to audio_chunks/chunk_NNNN_start_end.wav, and updates
session_audio_manifest.json.
"""

import json
import math
import os
import struct
import wave


class Stage1VadChunker:
    """Slices raw 16kHz 16-bit mono PCM streams into silence-pruned WAV chunks."""

    def __init__(
        self,
        session_dir: str,
        sample_rate: int = 16000,
        rms_threshold: float = 500.0,
    ):
        self.session_dir = session_dir
        self.chunks_dir = os.path.join(session_dir, "audio_chunks")
        self.manifest_path = os.path.join(
            session_dir, "session_audio_manifest.json"
        )
        self.sample_rate = sample_rate
        self.rms_threshold = rms_threshold
        self.chunk_counter = 0
        self.manifest = []
        os.makedirs(self.chunks_dir, exist_ok=True)

    @staticmethod
    def compute_rms(pcm_bytes: bytes) -> float:
        """Computes root-mean-square energy for 16-bit signed mono PCM frames."""
        if not pcm_bytes or len(pcm_bytes) < 2:
            return 0.0
        count = len(pcm_bytes) // 2
        samples = struct.unpack(f"<{count}h", pcm_bytes[: count * 2])
        sum_sq = sum(s * s for s in samples)
        return math.sqrt(sum_sq / count)

    def is_speech(self, pcm_bytes: bytes) -> bool:
        """Evaluates whether a PCM frame contains active vocal energy."""
        return self.compute_rms(pcm_bytes) >= self.rms_threshold

    def save_speech_chunk(
        self, pcm_bytes: bytes, start_ms: int, end_ms: int
    ) -> dict:
        """Writes a completed speech segment to disk as a 16kHz mono WAV and updates manifest."""
        self.chunk_counter += 1
        filename = (
            f"chunk_{self.chunk_counter:04d}_{start_ms}_{end_ms}.wav"
        )
        filepath = os.path.join(self.chunks_dir, filename)

        with wave.open(filepath, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.sample_rate)
            wf.writeframes(pcm_bytes)

        entry = {
            "chunk": filename,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "duration_ms": max(0, end_ms - start_ms),
        }
        self.manifest.append(entry)
        with open(self.manifest_path, "w", encoding="utf-8") as mf:
            json.dump(self.manifest, mf, indent=2)

        return entry
