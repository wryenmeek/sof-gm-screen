import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

describe("Ticket 11: Raspberry Pi Stage 1 Silero VAD Audio Chunker", () => {
  it("gates active speech frames, writes valid 16kHz mono WAV chunks, and updates session_audio_manifest.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sof-vad-test-"));
    const pyScript = `
import struct
from scripts.rpi_vad_chunker import Stage1VadChunker

chunker = Stage1VadChunker(${JSON.stringify(tmpDir)}, sample_rate=16000, rms_threshold=400.0)

# 1. Silent frame (amplitude 10) -> should not trigger speech
silent_pcm = struct.pack("<1600h", *([10] * 1600))
assert not chunker.is_speech(silent_pcm), "Silent frame falsely flagged as speech"

# 2. Active speech frame (amplitude 1200) -> should trigger speech and write WAV
speech_pcm = struct.pack("<1600h", *([1200] * 1600))
assert chunker.is_speech(speech_pcm), "Speech frame not detected"

entry = chunker.save_speech_chunk(speech_pcm, 1500, 4800)
print(entry["chunk"])
`;
    const out = execFileSync("python3", ["-c", pyScript], {
      cwd: process.cwd(),
      encoding: "utf-8"
    }).trim();

    expect(out).toBe("chunk_0001_1500_4800.wav");
    const wavPath = path.join(tmpDir, "audio_chunks", out);
    expect(fs.existsSync(wavPath)).toBe(true);
    expect(fs.statSync(wavPath).size).toBeGreaterThan(3200);

    const manifestPath = path.join(tmpDir, "session_audio_manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest).toEqual([
      {
        chunk: "chunk_0001_1500_4800.wav",
        start_ms: 1500,
        end_ms: 4800,
        duration_ms: 3300
      }
    ]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
