import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "rpi_vad_chunker.py");

function runChunkerCli(args: string[], env: Record<string, string> = {}): any {
  const out = execFileSync("python3", ["-B", SCRIPT_PATH, ...args], {
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: 15000,
    env: { ...process.env, ...env }
  }).trim();
  return JSON.parse(out);
}

describe("Ticket 11 & 26: Raspberry Pi Stage 1 Silero VAD Chunker & Stage 2 3-Tier Classifier", () => {
  it("passes the selected ALSA device through the CLI to arecord", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sof-vad-device-"));
    try {
      const pySnippet = [
        "import json, sys",
        "from pathlib import Path",
        "from unittest.mock import patch",
        "import scripts.rpi_vad_chunker as chunker",
        "captured = {}",
        "original_capture = chunker._capture_wav",
        "def fake_run(command, **kwargs):",
        "    captured['command'] = command",
        "    Path(command[-1]).write_bytes(b'WAV' * 20)",
        "def capture(path, seconds, device):",
        "    captured['device'] = device",
        "    original_capture(path, seconds, device)",
        "with patch.object(sys, 'argv', [chunker.__file__, '--capture-seconds', '3', '--capture-device', 'plughw:2,0']), patch.object(chunker, '_capture_wav', side_effect=capture), patch('scripts.rpi_vad_chunker.shutil.which', return_value='/usr/bin/arecord'), patch('scripts.rpi_vad_chunker.subprocess.run', side_effect=fake_run), patch.object(chunker, '_read_wav_pcm', side_effect=RuntimeError('stop after capture')):",
        "    try:",
        "        chunker._run_cli()",
        "    except RuntimeError as exc:",
        "        if str(exc) != 'stop after capture': raise",
        "print(json.dumps(captured))"
      ].join("\n");
      const out = execFileSync("python3", ["-B", "-c", pySnippet], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000
      }).trim();
      const captured = JSON.parse(out);
      expect(captured.device).toBe("plughw:2,0");
      expect(captured.command).toContain("-D");
      expect(captured.command[captured.command.indexOf("-D") + 1]).toBe(
        "plughw:2,0"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects an empty ALSA capture device", () => {
    const pySnippet = [
      "from scripts.rpi_vad_chunker import _capture_wav",
      "try:",
      "    _capture_wav('/tmp/unused.wav', 1, '  ')",
      "except ValueError as exc:",
      "    print(str(exc))",
      "else:",
      "    raise AssertionError('empty ALSA device was accepted')"
    ].join("\n");
    const out = execFileSync("python3", ["-B", "-c", pySnippet], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 15000
    }).trim();
    expect(out).toBe("ALSA capture device must not be empty.");
  });

  it("gates active speech frames via process_stream, writes valid 16kHz mono WAV chunks, and updates session_audio_manifest.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sof-vad-test-"));
    try {
      const pySnippet = [
        "import json, struct",
        "from scripts.rpi_vad_chunker import Stage1VadChunker",
        `chunker = Stage1VadChunker(${JSON.stringify(tmpDir)}, sample_rate=16000, rms_threshold=400.0)`,
        "silent = struct.pack('<1600h', *([10] * 1600))",
        "speech = struct.pack('<1600h', *([1200] * 1600))",
        "entries = chunker.process_stream([silent, speech, speech, silent, speech])",
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

  it("uses actual PCM samples for the final partial VAD frame timestamp", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sof-vad-partial-frame-")
    );
    try {
      const wavPath = path.join(tmpDir, "source.wav");
      const pySnippet = [
        "import json, os, struct, wave",
        "from scripts.rpi_vad_chunker import Stage1VadChunker, _pcm_frames",
        `wav_path = ${JSON.stringify(wavPath)}`,
        "with wave.open(wav_path, 'wb') as source:",
        "  source.setnchannels(1)",
        "  source.setsampwidth(2)",
        "  source.setframerate(16000)",
        "  source.writeframes(struct.pack('<16000h', *([1200] * 16000)))",
        "with wave.open(wav_path, 'rb') as source: pcm = source.readframes(source.getnframes())",
        `chunker = Stage1VadChunker(${JSON.stringify(tmpDir)}, vad_detector=lambda _pcm: True)`,
        "entries = chunker.process_stream(_pcm_frames(pcm), frame_duration_ms=250)",
        "chunk_path = os.path.join(chunker.chunks_dir, entries[0]['chunk'])",
        "with wave.open(chunk_path, 'rb') as chunk: sample_count = chunk.getnframes()",
        "print(json.dumps({'entries': entries, 'sample_count': sample_count}))"
      ].join("\n");
      const out = execFileSync("python3", ["-B", "-c", pySnippet], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000
      }).trim();
      const result = JSON.parse(out);

      expect(result.entries).toEqual([
        {
          chunk: "chunk_0001_0_1000.wav",
          start_ms: 0,
          end_ms: 1000,
          duration_ms: 1000
        }
      ]);
      expect(result.sample_count).toBe(16000);
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
        "f_speech = b'\\x01\\x00' * 800",
        "f_silent = b'\\x00\\x00' * 800",
        "entries = chunker.process_stream([f_speech, f_silent])",
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

  it("resumes chunk numbering and manifest history from an existing session", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sof-vad-resume-"));
    try {
      const pySnippet = [
        "import json",
        "from scripts.rpi_vad_chunker import Stage1VadChunker",
        `first = Stage1VadChunker(${JSON.stringify(tmpDir)}, vad_detector=lambda _pcm: True)`,
        "first.process_stream([b'\\x01\\x00' * 160])",
        `second = Stage1VadChunker(${JSON.stringify(tmpDir)}, vad_detector=lambda _pcm: True)`,
        "second.process_stream([b'\\x02\\x00' * 160])",
        "print(json.dumps(second.manifest))"
      ].join("; ");
      const out = execFileSync("python3", ["-B", "-c", pySnippet], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000
      }).trim();
      const entries = JSON.parse(out);
      expect(entries.map((entry: any) => entry.chunk)).toEqual([
        "chunk_0001_0_10.wav",
        "chunk_0002_10_20.wav"
      ]);
      expect(
        fs.existsSync(path.join(tmpDir, "audio_chunks", entries[0].chunk))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpDir, "audio_chunks", entries[1].chunk))
      ).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("restores Speech Chunk offsets after trailing silence and capture downtime", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sof-vad-elapsed-"));
    try {
      const pySnippet = [
        "import json",
        "from scripts.rpi_vad_chunker import Stage1VadChunker",
        `first = Stage1VadChunker(${JSON.stringify(tmpDir)}, vad_detector=lambda pcm: pcm[0] == 1)`,
        "first.process_stream([b'\\x01\\x00' * 1600, b'\\x00\\x00' * 1600, b'\\x00\\x00' * 1600], stream_started_at_ms=1000000)",
        `second = Stage1VadChunker(${JSON.stringify(tmpDir)}, vad_detector=lambda pcm: pcm[0] == 1)`,
        "next_chunk = second.process_stream([b'\\x01\\x00' * 1600, b'\\x00\\x00' * 1600], stream_started_at_ms=1005300)",
        "state = json.load(open(second.state_path, encoding='utf-8'))",
        "print(json.dumps({'chunk': next_chunk[0], 'elapsed_ms': state['elapsed_ms']}))"
      ].join("; ");
      const out = execFileSync("python3", ["-B", "-c", pySnippet], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000
      }).trim();
      const result = JSON.parse(out);

      expect(result.chunk).toMatchObject({
        start_ms: 5300,
        end_ms: 5400,
        duration_ms: 100
      });
      expect(result.elapsed_ms).toBe(5500);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("passes Silero sample-rate and recurrent-state inputs and surfaces model errors", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sof-vad-onnx-"));
    try {
      const pySnippet = [
        "import json",
        "from scripts.rpi_vad_chunker import Stage1VadChunker",
        "class Node:",
        "  def __init__(self, name, shape): self.name, self.shape = name, shape",
        "class FakeSession:",
        "  def __init__(self, should_fail=False): self.should_fail, self.feed = should_fail, None",
        "  def get_inputs(self): return [Node('input', [1, 512]), Node('state', [2, 1, 128]), Node('sr', [])]",
        "  def get_outputs(self): return [Node('output', [1, 1]), Node('stateN', [2, 1, 128])]",
        "  def run(self, _names, feed):",
        "    self.feed = feed",
        "    if self.should_fail: raise RuntimeError('invalid model input')",
        "    return [[[0.9]], feed['state']]",
        `chunker = Stage1VadChunker(${JSON.stringify(tmpDir)}, sample_rate=16000)`,
        "session = FakeSession()",
        "chunker.onnx_session = session",
        "active = chunker.is_speech(b'\\x01\\x00' * 512)",
        "captured = {'active': active, 'names': sorted(session.feed), 'sr': int(session.feed['sr']), 'state_shape': list(session.feed['state'].shape)}",
        "chunker.onnx_session = FakeSession(True)",
        "try: chunker.is_speech(b'\\x01\\x00' * 512)",
        "except RuntimeError as exc: captured['error'] = str(exc)",
        "print(json.dumps(captured))"
      ].join("\n");
      const out = execFileSync("python3", ["-B", "-c", pySnippet], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000
      }).trim();
      const result = JSON.parse(out);
      expect(result.active).toBe(true);
      expect(result.names).toEqual(["input", "sr", "state"]);
      expect(result.sr).toBe(16000);
      expect(result.state_shape).toEqual([2, 1, 128]);
      expect(result.error).toContain("invalid model input");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("pads short dynamic Silero frames and rejects unknown model inputs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sof-vad-dynamic-"));
    try {
      const pySnippet = [
        "import json",
        "from scripts.rpi_vad_chunker import Stage1VadChunker",
        "class Node:",
        "  def __init__(self, name, shape): self.name, self.shape = name, shape",
        "class FakeSession:",
        "  def __init__(self, inputs): self.inputs, self.feed = inputs, None",
        "  def get_inputs(self): return self.inputs",
        "  def run(self, _names, feed): self.feed = feed; return [[[0.9]]]",
        `chunker = Stage1VadChunker(${JSON.stringify(tmpDir)}, sample_rate=16000)`,
        "session = FakeSession([Node('audio', [1, -1]), Node('sr', [])])",
        "chunker.onnx_session = session",
        "active = chunker.is_speech(b'\\x01\\x00' * 100)",
        "audio = session.feed['audio']",
        "unknown = FakeSession([Node('audio', [1, 512]), Node('mystery', [1])])",
        "chunker.onnx_session = unknown",
        "try: chunker.is_speech(b'\\x01\\x00' * 512)",
        "except RuntimeError as exc: unknown_error = str(exc)",
        "else: raise AssertionError('unknown model input was accepted')",
        "print(json.dumps({'active': active, 'shape': list(audio.shape), 'tail': float(audio[0, -1]), 'unknown_error': unknown_error}))"
      ].join("\n");
      const out = execFileSync("python3", ["-B", "-c", pySnippet], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000
      }).trim();
      const result = JSON.parse(out);

      expect(result.active).toBe(true);
      expect(result.shape).toEqual([1, 512]);
      expect(result.tail).toBe(0);
      expect(result.unknown_error).toContain("unsupported input: mystery");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("requires explicit real audio input for non-test CLI runs", () => {
    expect(() =>
      execFileSync("python3", ["-B", SCRIPT_PATH], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000
      })
    ).toThrow();
    expect(() =>
      execFileSync(
        "python3",
        ["-B", SCRIPT_PATH, "--wav-path", "/missing/session.wav"],
        {
          cwd: process.cwd(),
          encoding: "utf-8",
          timeout: 15000
        }
      )
    ).toThrow();
  });

  it("terminates Tier 1 work at the deadline and reports webhook success only after a successful POST", () => {
    const pySnippet = [
      "import json, time",
      "from scripts.rpi_vad_chunker import classify_and_dispatch_chunk",
      "def slow_tier1(_path): time.sleep(1); return {'intent':'MUSIC_CUE'}",
      "def tier2(_path): return {'intent':'BANTER'}",
      "started = time.monotonic()",
      "timed = classify_and_dispatch_chunk('unused.wav', tier1_fn=slow_tier1, tier2_fn=tier2, timeout_ms=75)",
      "elapsed = time.monotonic() - started",
      "quick = classify_and_dispatch_chunk('unused.wav', tier1_fn=lambda _p: {'intent':'MUSIC_CUE'}, timeout_ms=1500)",
      "def failed_webhook(_payload): raise RuntimeError('offline')",
      "failed = classify_and_dispatch_chunk('unused.wav', tier1_fn=lambda _p: {'intent':'MUSIC_CUE','mood':'Combat'}, webhook_fn=failed_webhook)",
      "good = classify_and_dispatch_chunk('unused.wav', tier1_fn=lambda _p: {'intent':'MUSIC_CUE','mood':'Combat'}, webhook_fn=lambda _p: {'status':'OK'})",
      "simulated = classify_and_dispatch_chunk('unused.wav', tier1_fn=lambda _p: {'intent':'MUSIC_CUE','mood':'Combat'}, webhook_fn=lambda _p: {'status':'OK','simulated':True})",
      "print(json.dumps({'timed': timed, 'elapsed': elapsed, 'quick': quick, 'failed': failed, 'good': good, 'simulated': simulated}))"
    ].join("\n");
    const out = execFileSync("python3", ["-B", "-c", pySnippet], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 5000
    }).trim();
    const results = JSON.parse(out);
    expect(results.timed.activeTier).toBe("TIER_2_GEMINI_CLOUD");
    expect(results.elapsed).toBeLessThan(0.5);
    expect(results.quick.webhook_dispatched).toBe(false);
    expect(results.failed.webhook_dispatched).toBe(false);
    expect(results.failed.webhook_error).toContain("offline");
    expect(results.good.webhook_dispatched).toBe(true);
    expect(results.simulated.webhook_dispatched).toBe(false);
  });

  it("treats an explicit cached-false webhook response as failed delivery", () => {
    const pySnippet = [
      "import json",
      "from scripts.rpi_vad_chunker import classify_and_dispatch_chunk",
      "result = classify_and_dispatch_chunk('unused.wav', tier1_fn=lambda _p: {'intent':'MUSIC_CUE','mood':'Combat'}, webhook_fn=lambda _payload: {'status':'OK','cached':False})",
      "print(json.dumps(result))"
    ].join("\n");
    const out = execFileSync("python3", ["-B", "-c", pySnippet], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 5000
    }).trim();
    const result = JSON.parse(out);

    expect(result.webhook_dispatched).toBe(false);
    expect(result.webhook_error).toContain(
      "did not confirm successful delivery"
    );
  });

  it("rejects an empty Apps Script response instead of confirming delivery", () => {
    const pySnippet = [
      "import scripts.rpi_vad_chunker as chunker",
      "class EmptyResponse:",
      "  def __enter__(self): return self",
      "  def __exit__(self, *_args): pass",
      "  def read(self): return b''",
      "chunker.urllib.request.urlopen = lambda _req, timeout=5.0: EmptyResponse()",
      "try:",
      "  chunker.post_cue_webhook('https://example.test', {})",
      "except RuntimeError as exc:",
      "  print(str(exc))",
      "else:",
      "  raise AssertionError('empty webhook response was accepted')"
    ].join("\n");
    const out = execFileSync("python3", ["-B", "-c", pySnippet], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 5000
    }).trim();

    expect(out).toBe("Apps Script webhook returned an empty response.");
  });

  it("escalates a SIGTERM-resistant Tier 1 worker to Tier 2 within the fallback budget", () => {
    const pySnippet = [
      "import json, signal, time",
      "from scripts.rpi_vad_chunker import classify_and_dispatch_chunk",
      "started = time.monotonic()",
      "fallback_started = []",
      "def stubborn_tier1(_path):",
      "  signal.signal(signal.SIGTERM, signal.SIG_IGN)",
      "  time.sleep(1.5)",
      "  return {'intent': 'BANTER'}",
      "def tier2(_path):",
      "  fallback_started.append(time.monotonic() - started)",
      "  return {'intent': 'BANTER'}",
      "result = classify_and_dispatch_chunk('unused.wav', tier1_fn=stubborn_tier1, tier2_fn=tier2, timeout_ms=50)",
      "print(json.dumps({'result': result, 'elapsed': time.monotonic() - started, 'fallback_elapsed': fallback_started[0] if fallback_started else None}))"
    ].join("\n");
    const out = execFileSync("python3", ["-B", "-c", pySnippet], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 5000
    }).trim();
    const result = JSON.parse(out);

    expect(result.result.tier2_invoked).toBe(true);
    expect(result.fallback_elapsed).toBeLessThan(0.5);
    expect(result.elapsed).toBeLessThan(0.5);
  });

  it("starts Tier 2 promptly at the 1500ms deadline when Tier 1 ignores SIGTERM", () => {
    const pySnippet = [
      "import json, signal, time",
      "from scripts.rpi_vad_chunker import classify_and_dispatch_chunk",
      "started = time.monotonic()",
      "fallback_started = []",
      "def stubborn_tier1(_path):",
      "  signal.signal(signal.SIGTERM, signal.SIG_IGN)",
      "  time.sleep(3)",
      "  return {'intent': 'BANTER'}",
      "def tier2(_path):",
      "  fallback_started.append(time.monotonic() - started)",
      "  return {'intent': 'BANTER'}",
      "result = classify_and_dispatch_chunk('unused.wav', tier1_fn=stubborn_tier1, tier2_fn=tier2, timeout_ms=1500)",
      "print(json.dumps({'result': result, 'elapsed': time.monotonic() - started, 'fallback_elapsed': fallback_started[0] if fallback_started else None}))"
    ].join("\n");
    const out = execFileSync("python3", ["-B", "-c", pySnippet], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 5000
    }).trim();
    const result = JSON.parse(out);

    expect(result.result.tier2_invoked).toBe(true);
    expect(result.fallback_elapsed).toBeLessThan(1.75);
    expect(result.elapsed).toBeLessThan(1.75);
  });

  it("routes actionable Tier 1 cues missing mood or rule data through Tier 2 before dispatch", () => {
    const pySnippet = [
      "import json",
      "from scripts.rpi_vad_chunker import classify_and_dispatch_chunk",
      "cases = [",
      "  ({'intent': 'MUSIC_CUE', 'mood': None, 'rule': None}, {'intent': 'MUSIC_CUE', 'mood': 'Combat', 'rule': None}),",
      "  ({'intent': 'RULE_QUERY', 'mood': None, 'rule': None}, {'intent': 'RULE_QUERY', 'mood': None, 'rule': 'Grappled'}),",
      "]",
      "results = []",
      "for incomplete, complete in cases:",
      "  result = classify_and_dispatch_chunk('unused.wav', tier1_fn=lambda _p, cue=incomplete: cue, tier2_fn=lambda _p, cue=complete: cue, webhook_fn=lambda _payload: {'status': 'OK'})",
      "  results.append(result)",
      "print(json.dumps(results))"
    ].join("\n");
    const out = execFileSync("python3", ["-B", "-c", pySnippet], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 5000
    }).trim();
    const results = JSON.parse(out);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      activeTier: "TIER_2_GEMINI_CLOUD",
      tier2_invoked: true,
      webhook_dispatched: true,
      webhook_payload: { intent: "MUSIC_CUE", mood: "Combat" }
    });
    expect(results[1]).toMatchObject({
      activeTier: "TIER_2_GEMINI_CLOUD",
      tier2_invoked: true,
      webhook_dispatched: true,
      webhook_payload: { intent: "RULE_QUERY", rule: "Grappled" }
    });
  });

  it("counts Tier 1 process startup against its absolute deadline and ignores reported latency", () => {
    const pySnippet = [
      "import json",
      "import scripts.rpi_vad_chunker as chunker",
      "state = {'now': 10.0, 'poll_timeout': None, 'alive': True, 'killed': False, 'terminated': False}",
      "class Receiver:",
      "  def poll(self, timeout): state['poll_timeout'] = timeout; return True",
      "  def recv(self): return True, {'intent': 'BANTER'}",
      "  def close(self): pass",
      "class Sender:",
      "  def close(self): pass",
      "class Process:",
      "  def start(self): state['now'] += 1.0",
      "  def is_alive(self): return state['alive']",
      "  def terminate(self): state['terminated'] = True",
      "  def kill(self): state['killed'] = True; state['alive'] = False",
      "  def join(self, timeout=None): pass",
      "class Context:",
      "  def Pipe(self, duplex=False): return receiver, sender",
      "  def Process(self, **kwargs): return process",
      "receiver, sender, process = Receiver(), Sender(), Process()",
      "context = Context()",
      "chunker.multiprocessing.get_all_start_methods = lambda: ['fork']",
      "chunker.multiprocessing.get_context = lambda _method: context",
      "chunker.time.monotonic = lambda: state['now']",
      "timed_out = False",
      "try: chunker._run_tier1_with_timeout(lambda _p: {'intent': 'BANTER'}, 'unused.wav', 500)",
      "except TimeoutError: timed_out = True",
      "normalized = chunker._normalize_tier_output({'status': 'OK', 'latency_ms': 1, 'cue': {'intent': 'BANTER'}}, 2000)",
      "print(json.dumps({'timed_out': timed_out, 'poll_timeout': state['poll_timeout'], 'killed': state['killed'], 'terminated': state['terminated'], 'measured_latency': normalized['latency_ms']}))"
    ].join("\n");
    const out = execFileSync("python3", ["-B", "-c", pySnippet], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 5000
    }).trim();
    const result = JSON.parse(out);

    expect(result.timed_out).toBe(true);
    expect(result.killed).toBe(true);
    expect(result.terminated).toBe(false);
    expect(result.poll_timeout).toBeNull();
    expect(result.measured_latency).toBe(2000);
  });

  it("uses Tier 1 local Pi model when latency is <= 1500ms and dispatches MUSIC_CUE webhook", () => {
    const res = runChunkerCli(
      [
        "--test-classify",
        "--tier1-status",
        "OK",
        "--tier1-latency-ms",
        "420",
        "--intent",
        "MUSIC_CUE",
        "--mood",
        "Combat"
      ],
      { SOF_GM_KEY: "secret-gm-key" }
    );

    expect(res.activeTier).toBe("TIER_1_PI_LOCAL");
    expect(res.reason).toBe("Tier 1 local Pi model");
    expect(res.tier2_invoked).toBe(false);
    expect(res.webhook_dispatched).toBe(false);
    expect(res.webhook_payload).toMatchObject({
      intent: "MUSIC_CUE",
      mood: "Combat",
      rule: null,
      tier: "TIER_1_PI_LOCAL",
      gmKey: "secret-gm-key"
    });
  });

  it("does not accept GM secrets as CLI arguments", () => {
    expect(() =>
      execFileSync(
        "python3",
        ["-B", SCRIPT_PATH, "--test-classify", "--gm-key", "secret-gm-key"],
        {
          cwd: process.cwd(),
          encoding: "utf-8",
          timeout: 15000,
          env: { ...process.env, SOF_GM_KEY: "" }
        }
      )
    ).toThrow();
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
    expect(res.webhook_dispatched).toBe(false);
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
    expect(res.webhook_dispatched).toBe(false);
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

  it("dispatches detailed local ONNX Music and Rule cues without invoking Tier 2", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sof-tier1-details-"));
    try {
      const pySnippet = `
import json, os, sys, types, wave
import numpy as np
from scripts.rpi_vad_chunker import classify_and_dispatch_chunk, default_tier1_onnx_classify
class Node:
  def __init__(self, name, shape): self.name, self.shape = name, shape
active_case = {"name": None}
class FakeSession:
  def __init__(self, _model_path): pass
  def get_inputs(self): return [Node("audio", [1, -1])]
  def get_outputs(self): return [Node("intent_scores", [1, 3]), Node("mood_scores", [1, 4]), Node("rule_text", [1])]
  def run(self, _names, _feeds):
    if active_case["name"] == "music":
      return [np.array([[0.9, 0.05, 0.05]]), np.array([[0.1, 0.2, 0.7, 0.0]]), np.array([[""]], dtype=object)]
    return [np.array([[0.05, 0.9, 0.05]]), np.array([[0.25, 0.25, 0.25, 0.25]]), np.array([["Grappled"]], dtype=object)]
sys.modules["onnxruntime"] = types.SimpleNamespace(InferenceSession=FakeSession)
results = []
tier2_calls = []
for name in ("music", "rule"):
  model_path = os.path.join(${JSON.stringify(tmpDir)}, name + ".onnx")
  open(model_path, "wb").close()
  wav_path = os.path.join(${JSON.stringify(tmpDir)}, name + ".wav")
  with wave.open(wav_path, "wb") as wav:
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(bytes([0, 0]) * 512)
  os.environ["SOF_INTENT_MODEL"] = model_path
  active_case["name"] = name
  result = classify_and_dispatch_chunk(
    wav_path,
    tier1_fn=default_tier1_onnx_classify,
    tier2_fn=lambda _path: tier2_calls.append("called") or {"intent": "BANTER"},
    webhook_fn=lambda _payload: {"status": "OK"},
  )
  results.append(result)
print(json.dumps({"results": results, "tier2_calls": tier2_calls}))
`;
      const out = execFileSync("python3", ["-B", "-c", pySnippet], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000
      }).trim();
      const { results, tier2_calls: tier2Calls } = JSON.parse(out);

      expect(tier2Calls).toEqual([]);
      expect(results[0]).toMatchObject({
        activeTier: "TIER_1_PI_LOCAL",
        tier2_invoked: false,
        webhook_dispatched: true,
        webhook_payload: { intent: "MUSIC_CUE", mood: "Combat" }
      });
      expect(results[1]).toMatchObject({
        activeTier: "TIER_1_PI_LOCAL",
        tier2_invoked: false,
        webhook_dispatched: true,
        webhook_payload: { intent: "RULE_QUERY", rule: "Grappled" }
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses default_tier2_gemini_classify with Gemini 2.5 Flash responseSchema when tier2_fn is None and GEMINI_API_KEY is set", () => {
    const pySnippet = [
      "import json, os, tempfile, urllib.request, wave",
      "from scripts.rpi_vad_chunker import classify_and_dispatch_chunk",
      "wav_path = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name",
      "with wave.open(wav_path, 'wb') as wav: wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(b'\\x00\\x00' * 512)",
      "os.environ['GEMINI_API_KEY'] = 'test-gemini-key'",
      "captured = {}",
      "class FakeResp:",
      "  def __enter__(self): return self",
      "  def __exit__(self, *a): pass",
      "  def read(self): return json.dumps({'candidates': [{'content': {'parts': [{'text': json.dumps({'intent': 'MUSIC_CUE', 'mood': 'Combat', 'rule': None})}]}}]}).encode('utf-8')",
      "def fake_urlopen(req, timeout=10.0):",
      "  captured['url'] = req.full_url",
      "  captured['body'] = json.loads(req.data.decode('utf-8'))",
      "  return FakeResp()",
      "urllib.request.urlopen = fake_urlopen",
      "res = classify_and_dispatch_chunk(wav_path, tier1_fn=None, tier2_fn=None)",
      "os.unlink(wav_path)",
      "print(json.dumps({'res': res, 'captured': captured}))"
    ].join("\n");

    const out = execFileSync("python3", ["-B", "-c", pySnippet], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 15000
    }).trim();

    const parsed = JSON.parse(out);
    expect(parsed.res.activeTier).toBe("TIER_2_GEMINI_CLOUD");
    expect(parsed.res.cue).toEqual({
      intent: "MUSIC_CUE",
      mood: "Combat",
      rule: null
    });
    expect(parsed.captured.url).toContain(
      "gemini-2.5-flash:generateContent?key=test-gemini-key"
    );
    expect(parsed.captured.body.generationConfig.responseMimeType).toBe(
      "application/json"
    );
    expect(
      parsed.captured.body.generationConfig.responseSchema.properties.intent
    ).toBeDefined();
  });
});
