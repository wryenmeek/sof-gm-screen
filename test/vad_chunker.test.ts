import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "rpi_vad_chunker.py");

function runChunkerCli(args: string[]): any {
  const out = execFileSync("python3", ["-B", SCRIPT_PATH, ...args], {
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: 15000
  }).trim();
  return JSON.parse(out);
}

describe("Ticket 11 & 26: Raspberry Pi Stage 1 Silero VAD Chunker & Stage 2 3-Tier Classifier", () => {
  it("gates active speech frames via process_stream, writes valid 16kHz mono WAV chunks, and updates session_audio_manifest.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sof-vad-test-"));
    try {
      const pySnippet = [
        "import json, struct",
        "from scripts.rpi_vad_chunker import Stage1VadChunker",
        `chunker = Stage1VadChunker(${JSON.stringify(tmpDir)}, sample_rate=16000, rms_threshold=400.0)`,
        "silent = struct.pack('<1600h', *([10] * 1600))",
        "speech = struct.pack('<1600h', *([1200] * 1600))",
        "entries = chunker.process_stream([silent, speech, speech, silent, speech], frame_duration_ms=100)",
        "print(json.dumps(entries))"
      ].join("; ");

      const out = execFileSync("python3", ["-B", "-c", pySnippet], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000
      }).trim();

      const entries = JSON.parse(out);
      expect(entries).toEqual([
        {
          chunk: "chunk_0001_100_300.wav",
          start_ms: 100,
          end_ms: 300,
          duration_ms: 200
        },
        {
          chunk: "chunk_0002_400_500.wav",
          start_ms: 400,
          end_ms: 500,
          duration_ms: 100
        }
      ]);

      const wav1 = path.join(tmpDir, "audio_chunks", "chunk_0001_100_300.wav");
      const wav2 = path.join(tmpDir, "audio_chunks", "chunk_0002_400_500.wav");
      expect(fs.existsSync(wav1)).toBe(true);
      expect(fs.existsSync(wav2)).toBe(true);
      expect(fs.statSync(wav1).size).toBeGreaterThan(6400);

      const manifestPath = path.join(tmpDir, "session_audio_manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(manifest).toEqual(entries);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("supports custom vad_detector callable injection on Stage1VadChunker", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sof-vad-custom-"));
    try {
      const pySnippet = [
        "import json, struct",
        "from scripts.rpi_vad_chunker import Stage1VadChunker",
        `chunker = Stage1VadChunker(${JSON.stringify(tmpDir)}, vad_detector=lambda pcm: pcm[0] == 1)`,
        "f_speech = b'\\x01\\x00' * 160",
        "f_silent = b'\\x00\\x00' * 160",
        "entries = chunker.process_stream([f_speech, f_silent], frame_duration_ms=50)",
        "print(json.dumps(entries))"
      ].join("; ");

      const out = execFileSync("python3", ["-B", "-c", pySnippet], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000
      }).trim();

      const entries = JSON.parse(out);
      expect(entries).toHaveLength(1);
      expect(entries[0].chunk).toBe("chunk_0001_0_50.wav");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses Tier 1 local Pi model when latency is <= 1500ms and dispatches MUSIC_CUE webhook", () => {
    const res = runChunkerCli([
      "--test-classify",
      "--tier1-status",
      "OK",
      "--tier1-latency-ms",
      "420",
      "--intent",
      "MUSIC_CUE",
      "--mood",
      "Combat",
      "--gm-key",
      "secret-gm-key"
    ]);

    expect(res.activeTier).toBe("TIER_1_PI_LOCAL");
    expect(res.reason).toBe("Tier 1 local Pi model");
    expect(res.tier2_invoked).toBe(false);
    expect(res.webhook_dispatched).toBe(true);
    expect(res.webhook_payload).toMatchObject({
      intent: "MUSIC_CUE",
      mood: "Combat",
      rule: null,
      tier: "TIER_1_PI_LOCAL",
      gmKey: "secret-gm-key"
    });
  });

  it("automatically fails over to Tier 2 Gemini 2.5 Flash when Tier 1 exceeds 1500ms budget", () => {
    const res = runChunkerCli([
      "--test-classify",
      "--tier1-status",
      "OK",
      "--tier1-latency-ms",
      "1850",
      "--tier2-status",
      "OK",
      "--intent",
      "RULE_QUERY",
      "--rule",
      "Grappled"
    ]);

    expect(res.activeTier).toBe("TIER_2_GEMINI_CLOUD");
    expect(res.reason).toBe(
      "Tier 1 exceeded 1500ms or failed -> Auto-routed Speech Chunk to Tier 2 Gemini 2.5 Flash"
    );
    expect(res.tier2_invoked).toBe(true);
    expect(res.webhook_dispatched).toBe(true);
    expect(res.webhook_payload).toMatchObject({
      intent: "RULE_QUERY",
      mood: null,
      rule: "Grappled",
      tier: "TIER_2_GEMINI_CLOUD"
    });
  });

  it("automatically fails over to Tier 2 Gemini 2.5 Flash when Tier 1 raises an exception", () => {
    const res = runChunkerCli([
      "--test-classify",
      "--tier1-status",
      "ERROR",
      "--tier2-status",
      "OK",
      "--intent",
      "MUSIC_CUE",
      "--mood",
      "Tension"
    ]);

    expect(res.activeTier).toBe("TIER_2_GEMINI_CLOUD");
    expect(res.tier2_invoked).toBe(true);
    expect(res.webhook_dispatched).toBe(true);
    expect(res.webhook_payload.mood).toBe("Tension");
  });

  it("degrades to Tier 3 Manual UI when both Tier 1 and Tier 2 fail or when Pi is offline", () => {
    const doubleFail = runChunkerCli([
      "--test-classify",
      "--tier1-status",
      "ERROR",
      "--tier2-status",
      "ERROR",
      "--intent",
      "MUSIC_CUE",
      "--mood",
      "Combat"
    ]);

    expect(doubleFail.activeTier).toBe("TIER_3_MANUAL_UI");
    expect(doubleFail.cue).toBeNull();
    expect(doubleFail.reason).toBe(
      "Tier 1 & Tier 2 unavailable -> Degraded to Tier 3 Manual GM Screen Controls"
    );
    expect(doubleFail.webhook_dispatched).toBe(false);

    const offline = runChunkerCli([
      "--test-classify",
      "--pi-offline",
      "--intent",
      "MUSIC_CUE",
      "--mood",
      "Exploration"
    ]);

    expect(offline.activeTier).toBe("TIER_3_MANUAL_UI");
    expect(offline.cue).toBeNull();
    expect(offline.reason).toBe("Pi offline -> Manual UI controls active");
    expect(offline.webhook_dispatched).toBe(false);
  });

  it("suppresses webhook POST when classified intent is BANTER", () => {
    const res = runChunkerCli([
      "--test-classify",
      "--tier1-status",
      "OK",
      "--tier1-latency-ms",
      "310",
      "--intent",
      "BANTER"
    ]);

    expect(res.activeTier).toBe("TIER_1_PI_LOCAL");
    expect(res.cue).toEqual({
      intent: "BANTER",
      mood: null,
      rule: null
    });
    expect(res.webhook_dispatched).toBe(false);
    expect(res.webhook_payload).toBeNull();
  });
});
