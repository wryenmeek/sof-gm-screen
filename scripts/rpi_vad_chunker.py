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
import multiprocessing
import os
import shutil
import struct
import subprocess
import tempfile
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
        self.state_path = os.path.join(session_dir, "session_audio_state.json")
        self.sample_rate = sample_rate
        self.rms_threshold = rms_threshold
        self.vad_detector = vad_detector
        self.speech_prob_threshold = speech_prob_threshold
        self.onnx_session = None
        self.onnx_state: dict[str, Any] = {}

        if self.vad_detector is None and onnx_model_path:
            if not os.path.isfile(onnx_model_path):
                raise FileNotFoundError(
                    f"Silero VAD model does not exist: {onnx_model_path}"
                )
            try:
                import onnxruntime as ort  # type: ignore

                self.onnx_session = ort.InferenceSession(onnx_model_path)
            except Exception as exc:
                raise RuntimeError(
                    f"Unable to load Silero VAD model: {onnx_model_path}"
                ) from exc

        os.makedirs(self.chunks_dir, exist_ok=True)
        if os.path.exists(self.manifest_path):
            try:
                with open(self.manifest_path, encoding="utf-8") as mf:
                    existing_manifest = json.load(mf)
            except (OSError, json.JSONDecodeError) as exc:
                raise RuntimeError(
                    f"Unable to resume audio manifest: {self.manifest_path}"
                ) from exc
            if not isinstance(existing_manifest, list):
                raise ValueError("Audio manifest must contain a JSON array.")
            self.manifest: list[dict[str, Any]] = existing_manifest
        else:
            self.manifest = []

        self.elapsed_ms = max(
            (int(entry.get("end_ms", 0)) for entry in self.manifest),
            default=0,
        )
        self.last_audio_end_ms: Optional[int] = None
        if os.path.exists(self.state_path):
            try:
                with open(self.state_path, encoding="utf-8") as state_file:
                    state = json.load(state_file)
            except (OSError, json.JSONDecodeError) as exc:
                raise RuntimeError(
                    f"Unable to resume audio timing state: {self.state_path}"
                ) from exc
            if not isinstance(state, dict):
                raise ValueError("Audio timing state must contain a JSON object.")
            saved_elapsed = state.get("elapsed_ms")
            saved_end = state.get("last_audio_end_ms")
            if type(saved_elapsed) is not int or saved_elapsed < 0:
                raise ValueError("Audio timing state has an invalid elapsed_ms value.")
            if saved_end is not None and (type(saved_end) is not int or saved_end < 0):
                raise ValueError("Audio timing state has an invalid last_audio_end_ms value.")
            self.elapsed_ms = max(self.elapsed_ms, saved_elapsed)
            self.last_audio_end_ms = saved_end

        import re

        sequence_numbers = []
        for filename in os.listdir(self.chunks_dir):
            match = re.match(r"^chunk_([0-9]+)_", filename)
            if match:
                sequence_numbers.append(int(match.group(1)))
        for entry in self.manifest:
            match = re.match(r"^chunk_([0-9]+)_", str(entry.get("chunk", "")))
            if match:
                sequence_numbers.append(int(match.group(1)))
        self.chunk_counter = max(sequence_numbers, default=0)

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
        """Runs the configured VAD or explicit RMS fallback on one PCM frame."""
        if not pcm_bytes:
            return False
        if self.vad_detector is not None:
            return bool(self.vad_detector(pcm_bytes))
        if self.onnx_session is None:
            return self.compute_rms(pcm_bytes) >= self.rms_threshold

        try:
            import numpy as np

            count = len(pcm_bytes) // 2
            samples = np.asarray(
                struct.unpack(f"<{count}h", pcm_bytes[: count * 2]),
                dtype=np.float32,
            ) / 32768.0
            input_nodes = self.onnx_session.get_inputs()
            if not input_nodes:
                raise RuntimeError("Silero model declares no inputs")
            audio_node = next(
                (node for node in input_nodes if node.name.lower() in ("input", "audio")),
                input_nodes[0],
            )
            expected_samples = audio_node.shape[-1] if audio_node.shape else None
            if not isinstance(expected_samples, int) or expected_samples <= 0:
                expected_samples = {8000: 256, 16000: 512}.get(self.sample_rate)
            if expected_samples is None:
                raise RuntimeError(
                    "Silero model dynamic audio input requires an 8kHz or 16kHz sample rate"
                )
            if len(samples) < expected_samples:
                samples = np.pad(samples, (0, expected_samples - len(samples)))
            elif len(samples) > expected_samples:
                samples = samples[:expected_samples]

            feeds: dict[str, Any] = {}
            state_nodes = []
            for node in input_nodes:
                name = node.name.lower()
                if node.name == audio_node.name:
                    feeds[node.name] = samples.reshape(1, -1)
                elif name in ("sr", "sample_rate"):
                    feeds[node.name] = np.asarray(self.sample_rate, dtype=np.int64)
                elif name == "state":
                    state_nodes.append(node)
                    state = self.onnx_state.get(node.name)
                    if state is None:
                        shape = [
                            int(dimension)
                            if isinstance(dimension, int) and dimension > 0
                            else 1
                            for dimension in (node.shape or [])
                        ]
                        state = np.zeros(shape, dtype=np.float32)
                    feeds[node.name] = state
                else:
                    raise RuntimeError(
                        "Silero model declares unsupported input: " + node.name
                    )

            outputs = self.onnx_session.run(None, feeds)
            if not outputs:
                raise RuntimeError("Silero model returned no outputs")
            probability = float(np.asarray(outputs[0]).reshape(-1)[0])
            for index, node in enumerate(state_nodes, start=1):
                if index >= len(outputs):
                    raise RuntimeError(
                        "Silero model omitted recurrent state output for " + node.name
                    )
                self.onnx_state[node.name] = outputs[index]
            return probability >= self.speech_prob_threshold
        except Exception as exc:
            raise RuntimeError(f"Silero VAD inference failed: {exc}") from exc

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
        self,
        pcm_frames: Iterable[bytes],
        frame_duration_ms: Optional[int] = None,
        stream_started_at_ms: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        """Streams PCM frames and timestamps chunks from their actual sample counts.

        Args:
            pcm_frames: 16-bit mono PCM frames from one audio stream.
            frame_duration_ms: Deprecated duration retained for API compatibility;
                timestamps are derived from actual sample counts.
            stream_started_at_ms: Optional wall-clock start time for resumed capture.

        Returns:
            The manifest entries written for speech detected in this stream.
        """
        saved_entries: list[dict[str, Any]] = []
        active_buffer: list[bytes] = []
        speech_start_ms: Optional[int] = None
        current_ms = max(
            self.elapsed_ms,
            max(
                (int(entry.get("end_ms", 0)) for entry in self.manifest),
                default=0,
            ),
        )
        stream_base_ms = current_ms
        samples_processed = 0
        if stream_started_at_ms is not None and self.last_audio_end_ms is not None:
            current_ms += max(0, int(stream_started_at_ms) - self.last_audio_end_ms)
            stream_base_ms = current_ms

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
            samples_processed += len(frame) // 2
            current_ms = stream_base_ms + round(
                samples_processed * 1000 / self.sample_rate
            )

        if active_buffer and speech_start_ms is not None:
            entry = self.save_speech_chunk(
                b"".join(active_buffer), speech_start_ms, current_ms
            )
            saved_entries.append(entry)

        self.elapsed_ms = current_ms
        if stream_started_at_ms is not None:
            self.last_audio_end_ms = int(stream_started_at_ms) + round(
                samples_processed * 1000 / self.sample_rate
            )

        state_path = self.state_path + ".tmp"
        with open(state_path, "w", encoding="utf-8") as state_file:
            json.dump(
                {
                    "elapsed_ms": self.elapsed_ms,
                    "last_audio_end_ms": self.last_audio_end_ms,
                },
                state_file,
                indent=2,
            )
        os.replace(state_path, self.state_path)
        return saved_entries


def _has_required_action_data(cue: Any) -> bool:
    """Checks that an actionable cue contains the field consumed by the GM Screen.

    Args:
        cue: Normalized Tier 1 or Tier 2 cue payload.

    Returns:
        True for complete MUSIC_CUE, RULE_QUERY, and BANTER results.
    """
    if not isinstance(cue, dict):
        return False
    intent = cue.get("intent")
    if intent == "MUSIC_CUE":
        return isinstance(cue.get("mood"), str) and bool(cue["mood"].strip())
    if intent == "RULE_QUERY":
        return isinstance(cue.get("rule"), str) and bool(cue["rule"].strip())
    return intent == "BANTER"


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
        and _has_required_action_data(tier1_result.get("cue"))
    ):
        return {
            "activeTier": "TIER_1_PI_LOCAL",
            "cue": tier1_result.get("cue"),
            "reason": "Tier 1 local Pi model",
        }

    if (
        isinstance(tier2_result, dict)
        and tier2_result.get("status") == "OK"
        and _has_required_action_data(tier2_result.get("cue"))
    ):
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
            "latency_ms": measured_ms,
            "cue": raw.get("cue"),
        }

    cue = {k: v for k, v in raw.items() if k != "latency_ms"}
    return {
        "status": "OK",
        "latency_ms": measured_ms,
        "cue": cue,
    }


def default_tier2_gemini_classify(
    wav_path: str, timeout_s: float = 10.0
) -> dict[str, Any]:
    """Calls Gemini 2.5 Flash over HTTPS with structured JSON output schema {intent, mood, rule}."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")

    if not wav_path or not os.path.isfile(wav_path):
        raise FileNotFoundError(f"Audio WAV does not exist: {wav_path}")
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

    candidates = raw_resp.get("candidates") or []
    if (
        not candidates
        or not candidates[0].get("content", {}).get("parts")
        or not candidates[0]["content"]["parts"][0].get("text")
    ):
        raise RuntimeError("Gemini returned no classified audio response")
    cue_text = candidates[0]["content"]["parts"][0]["text"]
    parsed_cue = json.loads(cue_text) if isinstance(cue_text, str) else cue_text
    if not isinstance(parsed_cue, dict) or parsed_cue.get("intent") not in (
        "MUSIC_CUE",
        "RULE_QUERY",
        "BANTER",
    ):
        raise RuntimeError("Gemini returned an invalid audio intent")
    return {
      "status": "OK",
      "latency_ms": latency_ms,
      "cue": {
          "intent": parsed_cue["intent"],
          "mood": parsed_cue.get("mood"),
          "rule": parsed_cue.get("rule"),
      },
    }


def _tier1_worker(connection: Any, classifier: Callable[[str], Any], wav_path: str) -> None:
    """Runs a local classifier in a killable child process and returns its result."""
    try:
        connection.send((True, classifier(wav_path)))
    except BaseException as exc:
        connection.send((False, f"{type(exc).__name__}: {exc}"))
    finally:
        connection.close()


def _run_tier1_with_timeout(
    classifier: Callable[[str], Any],
    wav_path: str,
    timeout_ms: int,
    deadline: Optional[float] = None,
) -> Any:
    """Runs Tier 1 in a separate process that can be terminated at its deadline.

    Args:
        classifier: Local classifier that accepts a WAV path.
        wav_path: Existing audio chunk to classify.
        timeout_ms: Maximum wall-clock duration for Tier 1.
        deadline: Absolute monotonic deadline, established before process launch.

    Returns:
        The classifier's returned value.

    Raises:
        TimeoutError: If the classifier exceeds the deadline.
        RuntimeError: If the child process reports a classifier failure.
    """
    if deadline is None:
        deadline = time.monotonic() + max(timeout_ms, 0) / 1000.0
    methods = multiprocessing.get_all_start_methods()
    if "fork" not in methods:
        raise RuntimeError("Bounded Tier 1 execution requires POSIX fork support.")
    context = multiprocessing.get_context("fork")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(
        target=_tier1_worker,
        args=(sender, classifier, wav_path),
        daemon=True,
    )
    process.start()
    sender.close()
    try:
        remaining_s = deadline - time.monotonic()
        if (
            remaining_s <= 0
            or not receiver.poll(remaining_s)
            or time.monotonic() > deadline
        ):
            if process.is_alive():
                process.kill()
            raise TimeoutError(f"Tier 1 exceeded its {timeout_ms}ms deadline")
        succeeded, value = receiver.recv()
    finally:
        receiver.close()
        if process.is_alive():
            process.kill()
            process.join(timeout=0.01)
    if not succeeded:
        raise RuntimeError(str(value))
    return value


def _read_wav_pcm(wav_path: str) -> bytes:
    """Reads a mono 16kHz, 16-bit WAV and rejects unsupported audio formats."""
    if not wav_path or not os.path.isfile(wav_path):
        raise FileNotFoundError(f"Audio WAV does not exist: {wav_path}")
    try:
        with wave.open(wav_path, "rb") as source:
            if (
                source.getnchannels() != 1
                or source.getsampwidth() != 2
                or source.getframerate() != 16000
            ):
                raise ValueError("WAV must be mono, 16-bit PCM at 16kHz.")
            return source.readframes(source.getnframes())
    except wave.Error as exc:
        raise ValueError(f"Unable to decode WAV file: {wav_path}") from exc


def default_tier1_onnx_classify(wav_path: str) -> dict[str, Any]:
    """Classifies a Speech Chunk using a configured local ONNX model.

    The model accepts float32 audio and may take an optional `sr` input set to
    16000. The first output must contain three intent scores in MUSIC_CUE,
    BANTER order. Actionable models also expose a `mood_scores` output containing
    four scores ordered Exploration, Tension, Combat, Rest, and/or a `rule_text`
    output containing one recognized Rule Card query string.
    """
    model_path = os.environ.get("SOF_INTENT_MODEL", "").strip()
    if not model_path:
        raise RuntimeError("SOF_INTENT_MODEL is not configured")
    if not os.path.isfile(model_path):
        raise FileNotFoundError(f"Intent classifier model does not exist: {model_path}")
    import numpy as np
    import onnxruntime as ort  # type: ignore

    pcm_bytes = _read_wav_pcm(wav_path)
    samples = np.asarray(
        struct.unpack(f"<{len(pcm_bytes) // 2}h", pcm_bytes), dtype=np.float32
    ) / 32768.0
    session = ort.InferenceSession(model_path)
    nodes = session.get_inputs()
    if not nodes:
        raise RuntimeError("Intent classifier model declares no inputs")
    audio_node = next(
        (node for node in nodes if node.name.lower() in ("input", "audio")),
        nodes[0],
    )
    feeds: dict[str, Any] = {}
    for node in nodes:
        name = node.name.lower()
        if node.name == audio_node.name:
            feeds[node.name] = samples.reshape(1, -1)
        elif name in ("sr", "sample_rate"):
            feeds[node.name] = np.asarray(16000, dtype=np.int64)
        else:
            shape = [
                int(dimension)
                if isinstance(dimension, int) and dimension > 0
                else 1
                for dimension in (node.shape or [])
            ]
            feeds[node.name] = np.zeros(shape, dtype=np.float32)
    outputs = session.run(None, feeds)
    output_nodes = session.get_outputs()
    if not outputs or len(outputs) != len(output_nodes):
        raise RuntimeError("Intent classifier model returned incomplete outputs")
    outputs_by_name = {
        node.name.lower(): outputs[index]
        for index, node in enumerate(output_nodes)
    }
    scores = np.asarray(
        outputs_by_name.get("intent_scores", outputs[0])
    ).reshape(-1)
    if scores.size != 3:
        raise RuntimeError("Intent classifier must return three ordered scores")
    labels = ("MUSIC_CUE", "RULE_QUERY", "BANTER")
    intent = labels[int(np.argmax(scores))]
    cue: dict[str, Any] = {"intent": intent, "mood": None, "rule": None}
    if intent == "MUSIC_CUE":
        raw_mood_scores = outputs_by_name.get("mood_scores")
        if raw_mood_scores is None:
            raise RuntimeError("MUSIC_CUE model output requires mood_scores")
        mood_scores = np.asarray(raw_mood_scores).reshape(-1)
        moods = ("Exploration", "Tension", "Combat", "Rest")
        if mood_scores.size != len(moods):
            raise RuntimeError("mood_scores must contain four ordered mood scores")
        cue["mood"] = moods[int(np.argmax(mood_scores))]
    elif intent == "RULE_QUERY":
        raw_rule_text = outputs_by_name.get("rule_text")
        if raw_rule_text is None:
            raise RuntimeError("RULE_QUERY model output requires rule_text")
        rule_values = np.asarray(raw_rule_text).reshape(-1)
        if rule_values.size != 1:
            raise RuntimeError("rule_text must contain one recognized query string")
        rule_text = rule_values[0]
        if isinstance(rule_text, bytes):
            rule_text = rule_text.decode("utf-8")
        if not isinstance(rule_text, str) or not rule_text.strip():
            raise RuntimeError("RULE_QUERY model output returned empty rule_text")
        cue["rule"] = rule_text.strip()
    return cue


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
        if not raw.strip():
            raise RuntimeError("Apps Script webhook returned an empty response.")
        return json.loads(raw)


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
    tier1_ok = False

    if pi_online:
        if tier1_fn is not None:
            t0 = time.monotonic()
            deadline = t0 + max(timeout_ms, 0) / 1000.0
            try:
                raw_t1 = _run_tier1_with_timeout(
                    tier1_fn, wav_path, timeout_ms, deadline
                )
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
            and _has_required_action_data(tier1_result.get("cue"))
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
        tier1_result=tier1_result if tier1_ok else None,
        tier2_result=tier2_result,
    )

    cue = resolution.get("cue")
    webhook_dispatched = False
    webhook_payload: Optional[dict[str, Any]] = None
    webhook_response: Any = None
    webhook_error: Optional[str] = None

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

        if webhook_fn is not None:
            try:
                webhook_response = webhook_fn(webhook_payload)
                webhook_dispatched = (
                    isinstance(webhook_response, dict)
                    and webhook_response.get("status") == "OK"
                    and webhook_response.get("cached") is not False
                    and not webhook_response.get("simulated")
                )
                if not webhook_dispatched:
                    webhook_error = "Webhook did not confirm successful delivery"
            except Exception as exc:
                webhook_error = str(exc)

    return {
        "activeTier": resolution["activeTier"],
        "cue": cue,
        "reason": resolution["reason"],
        "tier2_invoked": tier2_invoked,
        "webhook_dispatched": webhook_dispatched,
        "webhook_payload": webhook_payload,
        "webhook_response": webhook_response,
        "webhook_error": webhook_error,
    }


def _capture_wav(output_path: str, duration_s: int, device: str) -> None:
    """Captures a mono 16kHz PCM WAV from the selected ALSA device.

    Args:
        output_path: Destination WAV path.
        duration_s: Positive capture duration in seconds.
        device: ALSA PCM device name, such as ``default`` or ``plughw:1,0``.

    Raises:
        ValueError: If duration or device configuration is invalid.
        RuntimeError: If ``arecord`` or the capture hardware is unavailable.
    """
    if duration_s <= 0:
        raise ValueError("Capture duration must be a positive number of seconds.")
    device = device.strip()
    if not device or len(device) > 128 or "\x00" in device:
        raise ValueError("ALSA capture device must not be empty.")
    arecord = shutil.which("arecord")
    if not arecord:
        raise RuntimeError("arecord is unavailable; audio capture hardware is not configured.")
    try:
        subprocess.run(
            [arecord, "-q", "-D", device, "-f", "S16_LE", "-c", "1", "-r", "16000", "-d", str(duration_s), output_path],
            check=True,
            timeout=duration_s + 10,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"Raspberry Pi audio capture failed: {exc}") from exc
    if not os.path.isfile(output_path) or os.path.getsize(output_path) <= 44:
        raise RuntimeError("Audio capture produced no usable WAV samples.")


def _pcm_frames(pcm_bytes: bytes, samples_per_frame: int = 512) -> Iterable[bytes]:
    """Yields 32ms 16kHz PCM frames for Silero VAD."""
    frame_size = samples_per_frame * 2
    for offset in range(0, len(pcm_bytes), frame_size):
        frame = pcm_bytes[offset : offset + frame_size]
        if len(frame) % 2:
            frame = frame[:-1]
        if frame:
            yield frame


def _run_cli() -> None:
    """Runs an explicit test simulation or the real capture/classification pipeline."""
    parser = argparse.ArgumentParser(
        description="Raspberry Pi Silero VAD and 3-tier audio classifier"
    )
    parser.add_argument(
        "--test-classify",
        action="store_true",
        help="Run an explicitly simulated classifier test; never captures or dispatches real audio",
    )
    parser.add_argument(
        "--pi-offline",
        action="store_true",
        help="Simulate Raspberry Pi offline state (test mode only)",
    )
    parser.add_argument(
        "--tier1-status",
        default="OK",
        choices=["OK", "ERROR"],
        help="Simulated Tier 1 status (test mode only)",
    )
    parser.add_argument(
        "--tier1-latency-ms",
        type=float,
        default=350.0,
        help="Simulated Tier 1 latency (test mode only)",
    )
    parser.add_argument(
        "--tier2-status",
        default="OK",
        choices=["OK", "ERROR"],
        help="Simulated Tier 2 status (test mode only)",
    )
    parser.add_argument(
        "--intent",
        default="MUSIC_CUE",
        choices=["MUSIC_CUE", "RULE_QUERY", "BANTER"],
        help="Simulated intent (test mode only)",
    )
    parser.add_argument("--mood", default=None, help="Simulated mood cue (test mode only)")
    parser.add_argument("--rule", default=None, help="Simulated rule query (test mode only)")
    parser.add_argument("--wav-path", default=None, help="Existing mono 16kHz PCM WAV to process")
    parser.add_argument("--capture-seconds", type=int, help="Capture live audio from arecord")
    parser.add_argument(
        "--capture-device",
        default=os.environ.get("SOF_ALSA_DEVICE", "default"),
        help="ALSA PCM device (default: SOF_ALSA_DEVICE or 'default')",
    )
    parser.add_argument("--output-dir", default="./session_audio", help="Directory for manifest and Speech Chunks")
    parser.add_argument("--vad-model", default=None, help="Silero VAD ONNX model path")
    parser.add_argument("--intent-model", default=None, help="Local cue-classification ONNX model path")
    parser.add_argument("--webhook-url", default=None, help="Apps Script doPost URL")
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
            time.sleep(max(float(args.tier1_latency_ms), 0.0) / 1000.0)
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

        def mock_webhook(payload: dict[str, Any]) -> dict[str, str]:
            return {"status": "OK", "simulated": "true"}

        result = classify_and_dispatch_chunk(
            wav_path=args.wav_path or "<test-only-simulation>",
            tier1_fn=mock_tier1,
            tier2_fn=mock_tier2,
            webhook_fn=mock_webhook,
            gm_key=os.environ.get("SOF_GM_KEY", "").strip() or None,
            pi_online=not args.pi_offline,
        )
        result["simulated"] = True
        print(json.dumps(result))
        return

    if args.wav_path and args.capture_seconds:
        parser.error("Use either --wav-path or --capture-seconds, not both.")
    if not args.wav_path and not args.capture_seconds:
        parser.error("Real processing requires --wav-path or --capture-seconds; simulation requires --test-classify.")

    audio_started_at_ms = int(time.time() * 1000)
    capture_path = None
    input_wav = args.wav_path
    if args.capture_seconds:
        handle, capture_path = tempfile.mkstemp(suffix=".wav", prefix="sof-capture-")
        os.close(handle)
        input_wav = capture_path
        try:
            _capture_wav(input_wav, args.capture_seconds, args.capture_device)
        except Exception:
            if os.path.exists(input_wav):
                os.unlink(input_wav)
            raise

    try:
        pcm_bytes = _read_wav_pcm(input_wav)
        vad_model = args.vad_model or os.environ.get("SOF_SILERO_VAD_MODEL", "").strip()
        if not vad_model:
            raise RuntimeError("SOF_SILERO_VAD_MODEL or --vad-model is required for real VAD processing.")
        intent_model = args.intent_model or os.environ.get("SOF_INTENT_MODEL", "").strip()
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not intent_model and not api_key:
            raise RuntimeError("Configure SOF_INTENT_MODEL or GEMINI_API_KEY; no classifier is available.")
        if intent_model:
            os.environ["SOF_INTENT_MODEL"] = intent_model

        os.makedirs(args.output_dir, exist_ok=True)
        chunker = Stage1VadChunker(
            args.output_dir,
            sample_rate=16000,
            onnx_model_path=vad_model,
        )
        chunks = chunker.process_stream(
            _pcm_frames(pcm_bytes),
            stream_started_at_ms=audio_started_at_ms,
        )
        if not chunks:
            print(json.dumps({"status": "NO_SPEECH", "chunks": [], "simulated": False}))
            return

        gm_key = os.environ.get("SOF_GM_KEY", "").strip() or None
        webhook_url = args.webhook_url or os.environ.get("SOF_WEBHOOK_URL")
        if webhook_url and not gm_key:
            raise RuntimeError("SOF_GM_KEY environment variable is required when a webhook is configured.")
        webhook_fn = (
            (lambda payload: post_cue_webhook(webhook_url, payload))
            if webhook_url
            else None
        )
        tier1_fn = default_tier1_onnx_classify if intent_model else None
        results = []
        for chunk in chunks:
            chunk_path = os.path.join(args.output_dir, "audio_chunks", chunk["chunk"])
            result = classify_and_dispatch_chunk(
                wav_path=chunk_path,
                tier1_fn=tier1_fn,
                webhook_fn=webhook_fn,
                gm_key=gm_key,
            )
            results.append({"chunk": chunk["chunk"], **result})
        print(json.dumps({"status": "PROCESSED", "chunks": results, "simulated": False}))
    finally:
        if capture_path and os.path.exists(capture_path):
            os.unlink(capture_path)


if __name__ == "__main__":
    _run_cli()
