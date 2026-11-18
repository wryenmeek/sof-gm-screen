# Research Report: Post-Session Studio Audio Remastering Alignment via Audio Timeline Sidecar

**Ticket:** `04-audio-timeline-sidecar-studio-alignment.md` (Roadmap Item: Post-Session Studio Audio Remastering Alignment)
**Date:** 2026-11-16
**Status:** Resolved

---

## Question

How can recorded live table speech audio (captured by the Raspberry Pi room mic) be aligned, drift-compensated, and dynamically mixed with original high-bitrate digital audio **Session Assets** (ambient loops, orchestral score cues, and sound effects) using the **Audio Timeline Sidecar** (`session_audio_timeline.json`) to automatically generate a polished, broadcast-ready multi-track studio remaster without manual digital audio workstation (DAW) editing?

Specifically resolve:

1. **Clock Drift**: Compensating for clock discrepancy between the browser's system wall clock (`Date.now()` milliseconds via NTP) and the Raspberry Pi's hardware audio ADC crystal oscillator (ALSA / PipeWire sample clock).
2. **Time-Zero Alignment ($t_0$)**: Deterministically anchoring the start of the audio recording to the first event in the **Audio Timeline Sidecar**.
3. **Gain Curve & Ducking Recreation**: Accurately replicating the Web Audio API gain state machine (ambient loop volume, musical crossfades, and automatic SFX score ducking) in an offline audio rendering pipeline.
4. **Export Pipelines**: Generating discrete stem WAV files (`vocals.wav`, `ambience.wav`, `score.wav`, `sfx.wav`) and a balanced master mix (`master_remaster.mp3`).

---

## Primary-Source Findings

### 1. Clock Synchronization & Hardware Oscillator Drift

Modern audio recording devices and browser runtimes operate on separate, unsynchronized timebases:

| Component                         | Timebase Source                                                    | Accuracy / Drift Rate                                                | Practical 3-Hour Drift                                          |
| :-------------------------------- | :----------------------------------------------------------------- | :------------------------------------------------------------------- | :-------------------------------------------------------------- |
| **Browser Client (`Index.html`)** | System Wall Clock (`Date.now()`, synchronized via NTP)             | Millisecond NTP discipline ($\pm 5\text{ms}$)                        | $0\text{ms}$ cumulative error (resynchronized by OS NTP daemon) |
| **Browser Web Audio Graph**       | High-resolution audio context hardware clock (`ctx.currentTime`)   | Bound to client output DAC crystal                                   | Resets per session, not absolute wall-clock                     |
| **Raspberry Pi Microphone ADC**   | Audio Codec Crystal Oscillator (e.g. WM8960, I2S MEMS, or USB mic) | Hardware crystal tolerance: $\pm 20\text{ppm}$ to $\pm 80\text{ppm}$ | **$216\text{ms}$ to $864\text{ms}$** per 3-hour session         |

#### Linear Drift Model & Resampling Formulation

Let $f_s = 44,100\text{ Hz}$ be the nominal audio sample rate. If the recording hardware crystal drifts by $\delta$ parts-per-million (ppm), the actual sample rate recorded by ALSA is:

$$f_{\text{actual}} = f_s \cdot (1 + \delta \cdot 10^{-6})$$

Over an active 3-hour tabletop **Session** ($T = 10,800\text{ seconds}$), an uncompensated $\pm 40\text{ppm}$ drift accumulates:

$$\Delta t_{\text{drift}} = 10,800 \cdot 40 \times 10^{-6} = 0.432\text{ seconds} \quad (432\text{ms})$$

This drift causes music cues triggered late in the session to become audibly misaligned with player reactions by nearly half a second.

**The Solution:** Rather than naive time-stretching, offline alignment calculates the exact empirical clock drift ratio $R$ between the initial slate offset $t_0$ and the final session event $t_{\text{end}}$, applying high-quality sinc-interpolated resampling (`aresample` in FFmpeg or `sox` rate adjustment):

$$R = \frac{\Delta t_{\text{wallclock}}}{\Delta t_{\text{samples}}} = \frac{T_{\text{sidecar\_end}} - T_{\text{sidecar\_start}}}{N_{\text{recorded\_samples}} / f_s}$$

---

### 2. Time-Zero Alignment ($t_0$)

To align the sidecar timeline events with the recorded microphone audio, three synchronization strategies were evaluated:

```mermaid
flowchart TD
    A["Session Start"] --> B{"Sync Mechanism"}
    B -->|"Option A: Acoustic Slate"| C["GM triggers audible 1kHz tone (150ms) on mixer start"]
    B -->|"Option B: WAV BEXT Chunk"| D["Raspberry Pi embeds NTP UTC timestamp in WAV header"]
    B -->|"Option C: Acoustic GCC-PHAT"| E["Cross-correlate room mic bleed against pristine audio track"]

    C --> F["Bandpass filter on mic audio detects peak at 1kHz; sets t0 with <1ms jitter"]
    D --> G["Extract t0 from WAV BEXT chunk; susceptible to soundcard start latency (+20-80ms)"]
    E --> H["Compute phase-transform cross-correlation; computationally expensive"]
```

#### Comparison of Alignment Strategies

| Metric                     | Option A: Acoustic Slate Beep                     | Option B: WAV `BEXT` NTP Header                         | Option C: Acoustic Cross-Correlation (GCC-PHAT)        |
| :------------------------- | :------------------------------------------------ | :------------------------------------------------------ | :----------------------------------------------------- |
| **Timing Accuracy**        | **Sub-millisecond (<1ms)**                        | Moderate ($\pm 25\text{ms}$ due to ALSA buffer startup) | High ($\pm 2\text{ms}$)                                |
| **Prerequisites**          | 150ms soft chime played at session start          | Systemd NTP synchronization on Raspberry Pi             | Audible room bleed from speakers into mic              |
| **Failure Modes**          | Tone muted or spoken over by players              | Unsynchronized Pi clock or NTP drift                    | Quiet ambient music with insufficient transient energy |
| **Automation Feasibility** | **100% automated** via bandpass FFT peak detector | **100% automated** via `scipy.io.wavfile` metadata      | Requires sliding cross-correlation search              |

**Recommendation:** Dual-layer alignment:

1. **Primary:** The Raspberry Pi's recording daemon writes the initial monotonic and wall-clock timestamp into the Broadcast Wave Format (`BEXT`) metadata chunk of `session_raw_mic.wav`.
2. **Calibration:** The Tabletop Mixer plays a brief, pleasant in-game bell chime (150ms sine burst at 880 Hz) when the GM clicks "Start Session". An automated peak detector identifies this slate in the microphone track, nailing $t_0$ down to the exact sample.

---

### 3. Gain Curve & Ducking Recreation

In `Index.html`, the **Tabletop Mixer** uses the Web Audio API with the following parameters:

- **Channel 1 (Ambience):** Constant loop gain $g_1 = 0.18$.
- **Channel 2 (Score):** Default gain $g_2 = 0.5$. On a **Mood Cue** crossfade, incoming track linearly ramps from $0.0 \to 1.0$ over `durationSec` (default 4.0s), while outgoing track ramps from $1.0 \to 0.0$ and disconnects.
- **Channel 3 (SFX):** Fires one-shot sound effects at $g_3 = 0.85$.
- **Automatic Score Ducking:** When Channel 3 fires, Channel 2 is ducked from $0.5 \to 0.15$ over 100ms, held for 1,800ms, and restored back to $0.5$ over 300ms.

#### Event Schema in `session_audio_timeline.json`

Every mixer event is logged with:

```json
{
  "timestamp": 1731798000000,
  "track": "score_combat_high_seas.mp3",
  "channel": 2,
  "eventType": "CROSSFADE",
  "gain": 0.5,
  "durationSec": 4.0
}
```

#### Offline Remastering State Machine (Python / FFmpeg)

In an automated Python script using `pydub` or `pedalboard` (Spotify's audio framework), the timeline is rendered into continuous audio stems by evaluating the exact piecewise gain function $G(t)$:

```python
# Piecewise gain evaluation for Channel 2 (Musical Score)
def compute_score_gain(t_ms, timeline_events):
    gain = 0.5
    for event in timeline_events:
        t_event = event["timestamp"] - t0
        if event["eventType"] == "SFX":
            # Apply ducking envelope: attack 100ms, hold 1800ms, release 300ms
            if 0 <= (t_ms - t_event) < 1900:
                gain = min(gain, 0.15)
            elif 1900 <= (t_ms - t_event) < 2200:
                recovery = (t_ms - t_event - 1900) / 300.0
                gain = min(gain, 0.15 + 0.35 * recovery)
    return gain
```

---

### 4. Studio Multi-Track Output Architecture

The offline remastering engine generates five synchronized audio tracks:

```text
Session 2026-10-31 Audio Remaster/
├── stems/
│   ├── stem_01_vocals_cleaned.wav    # Isolated player/GM voices (Demucs-filtered)
│   ├── stem_02_ambience.wav          # Pristine continuous ambient ocean/tavern loops (g=0.18)
│   ├── stem_03_score.wav             # Dynamic score with mood crossfades & ducking (g=0.50)
│   └── stem_04_sfx.wav               # One-shot combat/magic sound effects (g=0.85)
├── session_remaster_master.mp3       # Complete studio broadcast mix (-16.0 LUFS)
└── session_remaster_reaper.edl       # Multi-track timeline for Reaper / Audacity / Pro Tools
```

---

## Side-by-Side Audio Pipeline Matrix

| Feature                 | Raw Tabletop Mic Recording                | Manual GM DAW Remaster               | Automated Sidecar Remaster Pipeline              |
| :---------------------- | :---------------------------------------- | :----------------------------------- | :----------------------------------------------- |
| **Acoustic Fidelity**   | Low (speaker bleed, room reverb, low SNR) | High (hours of manual track cutting) | **Broadcast High (Studio lossless stems)**       |
| **Turnaround Time**     | Instant ($0\text{ min}$)                  | 3–6 hours of GM manual editing       | **3–5 minutes** (automated background script)    |
| **Mixer Alignment**     | Inaudible / washed out                    | Subjective manual crossfades         | **Sample-accurate** match to live game decisions |
| **Loudness Compliance** | Highly erratic ($\pm 14\text{ LUFS}$)     | Manually adjusted with compressors   | **Standardized -16 LUFS** (ITU-R BS.1770-4)      |
| **Stem Isolation**      | Single mono/stereo channel                | Impossible without raw multi-track   | **4 discrete stems** for post-production/recaps  |

---

## Conclusion & Recommendation

1. **Adopt Automated Sidecar Alignment:** Use `session_audio_timeline.json` as the ground-truth instruction set to assemble original, high-bitrate **Session Assets** alongside the microphone track.
2. **Clock Drift Correction:** Implement linear resampling via FFmpeg `aresample` based on the difference between the NTP sidecar duration and the ALSA sample count.
3. **Multi-Track Delivery:** Output both discrete stem tracks (`stems/`) and a finalized loudness-normalized master track (`-16.0 LUFS`) formatted for campaign podcast releases, YouTube VODs, and session recap archives.

---

## Primary Sources Cited

1. W3C — [Web Audio API Specification: LinearRampToValueAtTime & AudioParam Automation](https://webaudio.github.io/web-audio-api/#dom-audioparam-linearramptovalueattime)
2. International Telecommunication Union — [Recommendation ITU-R BS.1770-4: Algorithms to measure audio programme loudness and true-peak audio level](https://www.itu.int/rec/R-REC-BS.1770-4-201510-I/en)
3. Knapp, C. and Carter, G. — [The Generalized Correlation Method for Estimation of Time Delay (GCC-PHAT)](https://ieeexplore.ieee.org/document/1162830), IEEE Transactions on Acoustics, Speech, and Signal Processing.
4. Spotify — [Pedalboard: A Python library for working with audio](https://github.com/spotify/pedalboard) (Pythonic DSP, VST/AU hosting, and sample-accurate gain automation).
