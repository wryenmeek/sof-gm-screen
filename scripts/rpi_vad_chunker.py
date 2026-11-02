#!/usr/bin/env python3
"""
Raspberry Pi Stage 1 Silero VAD Edge Audio Chunker & Stage 2 3-Tier Classifier (Tickets 11 & 26).
Captures 16kHz 16-bit mono PCM audio from the Blue Snowball (Cardioid #1),
gates active speech segments via Silero VAD ONNX runtime (with deterministic RMS
energy fallback), writes timestamped speech .wav chunks to
audio_chunks/chunk_NNNN_start_end.wav, updates session_audio_manifest.json,
classifies Speech Chunks via a 3-tier automatic fallback state machine (ADR-0009),
and dispatches non-BANTER cues to Apps Script doPost(e).
"""

import argparse
import base64
import json
import math
import os
import struct
import time
import urllib.request
import wave
from typing import Any, Callable, Iterable, Optional

TIER_1_LATENCY_BUDGET_MS = 1500
ACTIONABLE_INTENTS = ("MUSIC_CUE", "RULE_QUERY")


class Stage1VadChunker:
    """Slices raw 16kHz 16-bit mono PCM streams into silence-pruned WAV chunks."""

    def __init__(
        self,
        session_dir: str,
        sample_rate: int = 16000,
        rms_threshold: float = 500.0,
        vad_detector: Optional[Callable[[bytes], bool]] = None,
        onnx_model_path: Optional[str] = None,
        speech_prob_threshold: float = 0.5,
    ):
        self.session_dir = session_dir
        self.chunks_dir = os.path.join(session_dir, "audio_chunks")
        self.manifest_path = os.path.join(
            session_dir, "session_audio_manifest.json"
        )
        self.sample_rate = sample_rate
        self.rms_threshold = rms_threshold
        self.vad_detector = vad_detector
        self.speech_prob_threshold = speech_prob_threshold
        self.onnx_session = None

        if self.vad_detector is None and onnx_model_path and os.path.exists(onnx_model_path):
            try:
                import onnxruntime as ort  # type: ignore

                self.onnx_session = ort.InferenceSession(onnx_model_path)
            except Exception:
                self.onnx_session = None

        self.chunk_counter = 0
        self.manifest: list[dict[str, Any]] = []
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
        if not pcm_bytes:
            return False
        if self.vad_detector is not None:
            return bool(self.vad_detector(pcm_bytes))
        if self.onnx_session is not None:
            try:
                count = len(pcm_bytes) // 2
                samples = [
                    s / 32768.0
                    for s in struct.unpack(f"<{count}h", pcm_bytes[: count * 2])
                ]
                inputs = {
                    self.onnx_session.get_inputs()[0].name: [samples],
                }
                outputs = self.onnx_session.run(None, inputs)
                prob = float(outputs[0][0][0]) if outputs else 0.0
                return prob >= self.speech_prob_threshold
            except Exception:
                pass
        return self.compute_rms(pcm_bytes) >= self.rms_threshold

    def save_speech_chunk(
        self, pcm_bytes: bytes, start_ms: int, end_ms: int
    ) -> dict[str, Any]:
        """Writes a completed speech segment to disk as a 16kHz mono WAV and updates manifest."""
        self.chunk_counter += 1
        filename = f"chunk_{self.chunk_counter:04d}_{start_ms}_{end_ms}.wav"
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

    def process_stream(
        self, pcm_frames: Iterable[bytes], frame_duration_ms: int = 100
    ) -> list[dict[str, Any]]:
        """Streams PCM frames, buffers consecutive active speech frames, and writes WAV chunks."""
        saved_entries: list[dict[str, Any]] = []
        active_buffer: list[bytes] = []
        speech_start_ms: Optional[int] = None
        current_ms = 0

        for frame in pcm_frames:
            if self.is_speech(frame):
                if speech_start_ms is None:
                    speech_start_ms = current_ms
                active_buffer.append(frame)
            else:
                if active_buffer and speech_start_ms is not None:
                    entry = self.save_speech_chunk(
                        b"".join(active_buffer), speech_start_ms, current_ms
                    )
                    saved_entries.append(entry)
                    active_buffer = []
                    speech_start_ms = None
            current_ms += frame_duration_ms

        if active_buffer and speech_start_ms is not None:
            entry = self.save_speech_chunk(
                b"".join(active_buffer), speech_start_ms, current_ms
            )
            saved_entries.append(entry)

        return saved_entries


def resolve_classifier_tier(
    pi_online: bool,
    tier1_result: Optional[dict[str, Any]] = None,
    tier2_result: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Resolves the active classifier tier according to ADR-0009 3-tier fallback rules."""
    if not pi_online:
        return {
            "activeTier": "TIER_3_MANUAL_UI",
            "cue": None,
            "reason": "Pi offline -> Manual UI controls active",
        }

    if (
        isinstance(tier1_result, dict)
        and tier1_result.get("status") == "OK"
        and tier1_result.get("latency_ms", float("inf")) <= TIER_1_LATENCY_BUDGET_MS
    ):
        return {
            "activeTier": "TIER_1_PI_LOCAL",
            "cue": tier1_result.get("cue"),
            "reason": "Tier 1 local Pi model",
        }

    if isinstance(tier2_result, dict) and tier2_result.get("status") == "OK":
        return {
            "activeTier": "TIER_2_GEMINI_CLOUD",
            "cue": tier2_result.get("cue"),
            "reason": "Tier 1 exceeded 1500ms or failed -> Auto-routed Speech Chunk to Tier 2 Gemini 2.5 Flash",
        }

    return {
        "activeTier": "TIER_3_MANUAL_UI",
        "cue": None,
        "reason": "Tier 1 & Tier 2 unavailable -> Degraded to Tier 3 Manual GM Screen Controls",
    }


def _normalize_tier_output(
    raw: Any, measured_ms: float
) -> dict[str, Any]:
    """Normalizes a classifier callable return value into {status, latency_ms, cue}."""
    if not isinstance(raw, dict):
        return {"status": "ERROR", "latency_ms": measured_ms, "cue": None}

    if "status" in raw or "cue" in raw:
        return {
            "status": raw.get("status", "OK"),
            "latency_ms": float(raw.get("latency_ms", measured_ms)),
            "cue": raw.get("cue"),
        }

    latency_ms = float(raw.get("latency_ms", measured_ms))
    cue = {k: v for k, v in raw.items() if k != "latency_ms"}
    return {
        "status": "OK",
        "latency_ms": latency_ms,
        "cue": cue,
    }


def default_tier2_gemini_classify(
    wav_path: str, timeout_s: float = 10.0
) -> dict[str, Any]:
    """Calls Gemini 2.5 Flash over HTTPS with structured JSON output schema {intent, mood, rule}."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")

    audio_b64 = ""
    if wav_path and os.path.exists(wav_path):
        with open(wav_path, "rb") as wf:
            audio_b64 = base64.b64encode(wf.read()).decode("ascii")

    parts: list[dict[str, Any]] = [
        {
            "text": (
                "Classify this tabletop RPG speech audio chunk into JSON with "
                "intent (MUSIC_CUE, RULE_QUERY, or BANTER), mood (nullable string), "
                "and rule (nullable string)."
            )
        }
    ]
    if audio_b64:
        parts.append(
            {
                "inlineData": {
                    "mimeType": "audio/wav",
                    "data": audio_b64,
                }
            }
        )

    request_body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "intent": {
                        "type": "STRING",
                        "enum": ["MUSIC_CUE", "RULE_QUERY", "BANTER"],
                    },
                    "mood": {"type": "STRING", "nullable": True},
                    "rule": {"type": "STRING", "nullable": True},
                },
                "required": ["intent"],
            },
        },
    }

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash:generateContent?key={api_key}"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(request_body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw_resp = json.loads(resp.read().decode("utf-8"))
    latency_ms = (time.monotonic() - t0) * 1000.0

    cue_text = (
        raw_resp.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "{}")
    )
    parsed_cue = json.loads(cue_text) if isinstance(cue_text, str) else cue_text
    return {
        "status": "OK",
        "latency_ms": latency_ms,
        "cue": {
            "intent": parsed_cue.get("intent", "BANTER"),
            "mood": parsed_cue.get("mood"),
            "rule": parsed_cue.get("rule"),
        },
    }


def post_cue_webhook(
    webhook_url: str, payload: dict[str, Any], timeout_s: float = 5.0
) -> dict[str, Any]:
    """POSTs a JSON audio cue over outbound HTTPS to Apps Script doPost(e)."""
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {"status": "OK"}


def classify_and_dispatch_chunk(
    wav_path: str,
    tier1_fn: Optional[Callable[[str], Any]] = None,
    tier2_fn: Optional[Callable[[str], Any]] = None,
    webhook_fn: Optional[Callable[[dict[str, Any]], Any]] = None,
    gm_key: Optional[str] = None,
    pi_online: bool = True,
    timeout_ms: int = TIER_1_LATENCY_BUDGET_MS,
) -> dict[str, Any]:
    """
    Executes Stage 2 3-tier intent classification on a Speech Chunk WAV and
    dispatches actionable cues (MUSIC_CUE, RULE_QUERY) to the Apps Script webhook.
    """
    tier1_result: Optional[dict[str, Any]] = None
    tier2_result: Optional[dict[str, Any]] = None
    tier2_invoked = False

    if pi_online:
        if tier1_fn is not None:
            t0 = time.monotonic()
            try:
                raw_t1 = tier1_fn(wav_path)
                measured_ms = (time.monotonic() - t0) * 1000.0
                tier1_result = _normalize_tier_output(raw_t1, measured_ms)
            except Exception as exc:
                measured_ms = (time.monotonic() - t0) * 1000.0
                tier1_result = {
                    "status": "ERROR",
                    "latency_ms": measured_ms,
                    "cue": None,
                    "error": str(exc),
                }

        tier1_ok = (
            isinstance(tier1_result, dict)
            and tier1_result.get("status") == "OK"
            and tier1_result.get("latency_ms", float("inf")) <= timeout_ms
        )

        effective_tier2_fn = tier2_fn
        if effective_tier2_fn is None and os.environ.get("GEMINI_API_KEY"):
            effective_tier2_fn = default_tier2_gemini_classify

        if not tier1_ok and effective_tier2_fn is not None:
            tier2_invoked = True
            t0 = time.monotonic()
            try:
                raw_t2 = effective_tier2_fn(wav_path)
                measured_ms = (time.monotonic() - t0) * 1000.0
                tier2_result = _normalize_tier_output(raw_t2, measured_ms)
            except Exception as exc:
                measured_ms = (time.monotonic() - t0) * 1000.0
                tier2_result = {
                    "status": "ERROR",
                    "latency_ms": measured_ms,
                    "cue": None,
                    "error": str(exc),
                }

    resolution = resolve_classifier_tier(
        pi_online=pi_online,
        tier1_result=tier1_result,
        tier2_result=tier2_result,
    )

    cue = resolution.get("cue")
    webhook_dispatched = False
    webhook_payload: Optional[dict[str, Any]] = None
    webhook_response: Any = None

    if isinstance(cue, dict) and cue.get("intent") in ACTIONABLE_INTENTS:
        webhook_payload = {
            "intent": cue.get("intent"),
            "mood": cue.get("mood"),
            "rule": cue.get("rule"),
            "tier": resolution["activeTier"],
            "timestamp": cue.get("timestamp", int(time.time() * 1000)),
        }
        if gm_key is not None:
            webhook_payload["gmKey"] = gm_key

        webhook_dispatched = True
        if webhook_fn is not None:
            webhook_response = webhook_fn(webhook_payload)

    return {
        "activeTier": resolution["activeTier"],
        "cue": cue,
        "reason": resolution["reason"],
        "tier2_invoked": tier2_invoked,
        "webhook_dispatched": webhook_dispatched,
        "webhook_payload": webhook_payload,
        "webhook_response": webhook_response,
    }


def _run_cli() -> None:
    parser = argparse.ArgumentParser(
        description="Raspberry Pi Stage 1 VAD Chunker & Stage 2 3-Tier Classifier"
    )
    parser.add_argument(
        "--test-classify",
        action="store_true",
        help="Run Stage 2 3-tier classification self-test and output JSON",
    )
    parser.add_argument(
        "--pi-offline",
        action="store_true",
        help="Simulate Raspberry Pi offline state",
    )
    parser.add_argument(
        "--tier1-status",
        default="OK",
        choices=["OK", "ERROR"],
        help="Simulated Tier 1 classifier status",
    )
    parser.add_argument(
        "--tier1-latency-ms",
        type=float,
        default=350.0,
        help="Simulated Tier 1 latency in milliseconds",
    )
    parser.add_argument(
        "--tier2-status",
        default="OK",
        choices=["OK", "ERROR"],
        help="Simulated Tier 2 classifier status",
    )
    parser.add_argument(
        "--intent",
        default="MUSIC_CUE",
        choices=["MUSIC_CUE", "RULE_QUERY", "BANTER"],
        help="Simulated classified intent",
    )
    parser.add_argument("--mood", default=None, help="Simulated mood cue")
    parser.add_argument("--rule", default=None, help="Simulated rule query")
    parser.add_argument("--gm-key", default=None, help="GM key for webhook payload")
    parser.add_argument(
        "--wav-path",
        default="chunk_0001_0_1000.wav",
        help="WAV path passed to classifiers",
    )

    args = parser.parse_args()

    if args.test_classify:
        simulated_cue = {
            "intent": args.intent,
            "mood": args.mood,
            "rule": args.rule,
        }

        def mock_tier1(_wav: str) -> dict[str, Any]:
            if args.tier1_status == "ERROR":
                raise RuntimeError("Tier 1 local classifier error")
            return {
                "status": "OK",
                "latency_ms": args.tier1_latency_ms,
                "cue": simulated_cue,
            }

        def mock_tier2(_wav: str) -> dict[str, Any]:
            if args.tier2_status == "ERROR":
                raise RuntimeError("Tier 2 Gemini cloud classifier error")
            return {
                "status": "OK",
                "latency_ms": 620.0,
                "cue": simulated_cue,
            }

        captured_webhooks: list[dict[str, Any]] = []

        def mock_webhook(payload: dict[str, Any]) -> dict[str, str]:
            captured_webhooks.append(payload)
            return {"status": "OK"}

        result = classify_and_dispatch_chunk(
            wav_path=args.wav_path,
            tier1_fn=mock_tier1,
            tier2_fn=mock_tier2,
            webhook_fn=mock_webhook,
            gm_key=args.gm_key,
            pi_online=not args.pi_offline,
        )
        print(json.dumps(result))


if __name__ == "__main__":
    _run_cli()

