// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupClientHarness } from "./helpers/client-harness";

describe("Web Audio Engine & IndexedDB Pre-Caching (Tickets 04, 05, 06, 12)", () => {
  let AudioCache: any;
  let TabletopMixer: any;
  let handleAudioIntent: any;
  let hasWebGpuSupport: any;
  let flushAudioTimeline: any;
  let saveAudioTimelineSpy: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let idbStore: Map<string, any>;
  let idbOpenSpy: ReturnType<typeof vi.fn>;
  let audioCtxCreateGainSpy: ReturnType<typeof vi.fn>;
  let audioCtxCreateCompressorSpy: ReturnType<typeof vi.fn>;
  let classifyAudioAssetChannel: any;
  let triggerManualMoodCue: any;
  let resolveClassifierTier: any;
  let pollLatestAudioCue: any;
  let saveScratchpad: any;
  let mockLocalStorage: any;

  beforeEach(() => {
    vi.useFakeTimers();
    const harness = setupClientHarness();
    AudioCache = harness.AudioCache;
    TabletopMixer = harness.TabletopMixer;
    handleAudioIntent = harness.handleAudioIntent;
    hasWebGpuSupport = harness.hasWebGpuSupport;
    flushAudioTimeline = harness.flushAudioTimeline;
    saveAudioTimelineSpy = harness.saveAudioTimelineSpy;
    fetchSpy = harness.fetchSpy;
    idbStore = harness.idbStore;
    idbOpenSpy = harness.idbOpenSpy;
    audioCtxCreateGainSpy = harness.audioCtxCreateGainSpy;
    audioCtxCreateCompressorSpy = harness.audioCtxCreateCompressorSpy;
    classifyAudioAssetChannel = harness.classifyAudioAssetChannel;
    triggerManualMoodCue = harness.triggerManualMoodCue;
    resolveClassifierTier = harness.resolveClassifierTier;
    pollLatestAudioCue = harness.pollLatestAudioCue;
    saveScratchpad = harness.saveScratchpad;
    mockLocalStorage = harness.mockLocalStorage;
  });

  describe("Ticket 04 & 19: Google Drive v3 Bearer Fetch & IndexedDB Audio Pre-Caching Engine", () => {
    it("persists binary audio ArrayBuffers through window.indexedDB and updates progress badge", async () => {
      expect(AudioCache).toBeDefined();
      const fileId = "1hK0jBXVU6Mz47pFSr3M23Y6ZFiCHR8BH";
      const buf = new ArrayBuffer(512);

      const hasPromise = AudioCache.has(fileId);
      await vi.runAllTimersAsync();
      expect(await hasPromise).toBe(false);

      const setPromise = AudioCache.set(fileId, buf);
      await vi.runAllTimersAsync();
      await setPromise;
      expect(idbOpenSpy).toHaveBeenCalledWith("sof_audio_cache_v1", 1);
      expect(idbStore.get(fileId)?.byteLength).toBe(512);

      const loaded = await AudioCache.get(fileId);
      expect(loaded?.byteLength).toBe(512);

      const preCachePromise = AudioCache.preCacheManifest([
        { id: "a1", name: "Age_of_Sail.mp3", mimeType: "audio/mpeg" },
        { id: "a2", name: "Combat_Score.mp3", mimeType: "audio/mpeg" }
      ]);
      await vi.runAllTimersAsync();
      await preCachePromise;
      const badge = document.getElementById("audio-cache-status")!;
      expect(badge.textContent).toContain("Audio: 2/2 ready");
    });

    it("fetches via Drive v3 alt=media with Authorization Bearer header, stores { fileId, buffer, lastAccessed }, updates lastAccessed on hit, prunes >30d stale entries, and supports clearCache()", async () => {
      expect(AudioCache.putTrack).toBeDefined();
      expect(AudioCache.fetchDriveAudioBearer).toBeDefined();
      expect(AudioCache.pruneStaleEntries).toBeDefined();
      expect(AudioCache.clearCache).toBeDefined();
      expect(AudioCache.preCacheSessionAudio).toBeDefined();

      // 1. fetchDriveAudioBearer sends Bearer header to Drive v3 alt=media and stores { fileId, buffer, lastAccessed }
      const fetchPromise = AudioCache.fetchDriveAudioBearer(
        "track_drive_99",
        "ya29.test_bearer_token"
      );
      await vi.runAllTimersAsync();
      const fetchedBuf = await fetchPromise;
      expect(fetchedBuf.byteLength).toBe(256);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://www.googleapis.com/drive/v3/files/track_drive_99?alt=media",
        {
          headers: { Authorization: "Bearer ya29.test_bearer_token" }
        }
      );
      const record = idbStore.get("track_drive_99");
      expect(record).toMatchObject({
        fileId: "track_drive_99",
        lastAccessed: expect.any(Number)
      });
      expect(record.buffer.byteLength).toBe(256);

      // 2. Subsequent get() hits IndexedDB with zero extra network calls and updates lastAccessed
      fetchSpy.mockClear();
      const initialAccessed = record.lastAccessed;
      vi.advanceTimersByTime(5000);
      const hitPromise = AudioCache.get("track_drive_99");
      await vi.runAllTimersAsync();
      const hitBuf = await hitPromise;
      expect(hitBuf.byteLength).toBe(256);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(idbStore.get("track_drive_99").lastAccessed).toBeGreaterThan(
        initialAccessed
      );

      // 3. pruneStaleEntries evicts entries older than 30 days while keeping fresh entries
      const thirtyOneDaysAgo = Date.now() - 31 * 86400 * 1000;
      const putOldPromise = AudioCache.putTrack(
        "stale_track_01",
        new ArrayBuffer(128),
        thirtyOneDaysAgo
      );
      await vi.runAllTimersAsync();
      await putOldPromise;
      expect(idbStore.has("stale_track_01")).toBe(true);

      const prunePromise = AudioCache.pruneStaleEntries();
      await vi.runAllTimersAsync();
      await prunePromise;
      expect(idbStore.has("stale_track_01")).toBe(false);
      expect(idbStore.has("track_drive_99")).toBe(true);

      // 4. clearCache() wipes store and resets #audio-cache-status
      const clearPromise = AudioCache.clearCache();
      await vi.runAllTimersAsync();
      await clearPromise;
      expect(idbStore.size).toBe(0);
      expect(document.getElementById("audio-cache-status")!.textContent).toBe(
        "Audio: 0/0 ready"
      );

      // 5. preCacheSessionAudio uses custom fetchFn when provided and updates progress
      const customFetch = vi.fn().mockResolvedValue(new ArrayBuffer(64));
      const prePromise = AudioCache.preCacheSessionAudio(
        [
          { id: "s1", name: "amb_waves.mp3", mimeType: "audio/mpeg" },
          { id: "s2", name: "score_combat.mp3", mimeType: "audio/mpeg" }
        ],
        customFetch
      );
      await vi.runAllTimersAsync();
      await prePromise;
      expect(customFetch).toHaveBeenCalledTimes(2);
      expect(document.getElementById("audio-cache-status")!.textContent).toBe(
        "Audio: 2/2 ready"
      );
    });
  });

  describe("Ticket 05 & 20: Web Audio API 3-Channel Mixer, Auto-Routing, Master Compressor & SFX Ducking", () => {
    it("instantiates native AudioContext GainNodes, ducks Channel 2 score by -8dB (0.4), and restores to 1.0 after 1.5s", () => {
      expect(TabletopMixer).toBeDefined();
      TabletopMixer.init();
      expect(audioCtxCreateGainSpy).toHaveBeenCalledTimes(3);
      expect(TabletopMixer.channel2Gain.gain.value).toBe(1.0);

      TabletopMixer.playSfx("cannon_barrage_01");
      expect(TabletopMixer.channel2Gain.gain.value).toBeCloseTo(0.4, 2);

      vi.advanceTimersByTime(1500);
      expect(TabletopMixer.channel2Gain.gain.value).toBeCloseTo(1.0, 2);
    });

    it("executes a 4-second linear crossfade on Channel 2 score transitions", () => {
      expect(TabletopMixer).toBeDefined();
      TabletopMixer.init();
      TabletopMixer.crossfadeScore("combat_theme_01");

      const lastEvent =
        TabletopMixer.timeline[TabletopMixer.timeline.length - 1];
      expect(lastEvent.eventType).toBe("CROSSFADE");
      expect(lastEvent.track).toBe("combat_theme_01");
      expect(lastEvent.channel).toBe(2);
    });

    it("classifies audio assets into Channels 1/2/3, routes all 3 channels through a master DynamicsCompressorNode, and triggers Tier 3 manual Mood Cue buttons", () => {
      expect(classifyAudioAssetChannel).toBeDefined();
      expect(triggerManualMoodCue).toBeDefined();

      // 1. Auto-routing classification by Shortcut Folder tag or filename prefix
      expect(
        classifyAudioAssetChannel({
          name: "[Ambience] Ship_Creaking_Loop.mp3"
        })
      ).toBe(1);
      expect(classifyAudioAssetChannel("amb_jungle_rain.ogg")).toBe(1);
      expect(
        classifyAudioAssetChannel({ name: "[Score] Lapis_Observatory.mp3" })
      ).toBe(2);
      expect(
        classifyAudioAssetChannel({ name: "[Music] Boss_Theme.mp3" })
      ).toBe(2);
      expect(classifyAudioAssetChannel("score_tension.mp3")).toBe(2);
      expect(
        classifyAudioAssetChannel({ name: "[SFX] Cannon_Volley.wav" })
      ).toBe(3);
      expect(classifyAudioAssetChannel("sfx_thunder.wav")).toBe(3);

      // 2. Master DynamicsCompressorNode wiring
      TabletopMixer.init();
      expect(audioCtxCreateCompressorSpy).toHaveBeenCalledTimes(1);
      expect(TabletopMixer.compressor).toBeDefined();
      expect(TabletopMixer.compressor.connect).toHaveBeenCalledWith(
        TabletopMixer.ctx.destination
      );
      expect(TabletopMixer.channel1Gain.connect).toHaveBeenCalledWith(
        TabletopMixer.compressor
      );
      expect(TabletopMixer.channel2Gain.connect).toHaveBeenCalledWith(
        TabletopMixer.compressor
      );
      expect(TabletopMixer.channel3Gain.connect).toHaveBeenCalledWith(
        TabletopMixer.compressor
      );

      // 3. Tier 3 manual Mood Cue UI buttons & triggerManualMoodCue
      const moodBtns = document.querySelectorAll(".mood-cue-btn");
      expect(moodBtns.length).toBe(4);
      triggerManualMoodCue("Exploration");
      const lastCue = TabletopMixer.timeline[TabletopMixer.timeline.length - 1];
      expect(lastCue).toMatchObject({
        eventType: "CROSSFADE",
        track: "score_exploration",
        channel: 2
      });
    });
  });

  describe("Ticket 06 & 21: Write-Ahead Audio Timeline Sidecar Logger & Table Notes Co-Flush", () => {
    it("records timestamped events and flushes JSON timeline to Apps Script saveAudioTimeline", () => {
      expect(TabletopMixer).toBeDefined();
      expect(flushAudioTimeline).toBeDefined();
      TabletopMixer.init();
      TabletopMixer.playAmbience("Open_Ocean.mp3");
      TabletopMixer.playSfx("thunder_clap.mp3");

      flushAudioTimeline();
      expect(saveAudioTimelineSpy).toHaveBeenCalledTimes(1);
      const [sessionDate, jsonStr] = saveAudioTimelineSpy.mock.calls[0];
      expect(sessionDate).toBe("2026-10-31");
      const parsed = JSON.parse(jsonStr);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.some((e: any) => e.eventType === "LOOP")).toBe(true);
      expect(parsed.some((e: any) => e.eventType === "SFX")).toBe(true);
    });

    it("immediately writes every cue to localStorage write-ahead log, hydrates on reload, and co-flushes inside saveScratchpad()", () => {
      expect(TabletopMixer.hydrateFromLocalStorage).toBeDefined();
      expect(saveScratchpad).toBeDefined();

      TabletopMixer.init();
      TabletopMixer.playAmbience("amb_harbor_bells.mp3");
      TabletopMixer.crossfadeScore("score_tension.mp3");
      TabletopMixer.playSfx("sfx_kraken_roar.wav");
      vi.advanceTimersByTime(1500); // Triggers RESTORE event

      const walRaw = mockLocalStorage.getItem("sof_audio_timeline_2026-10-31");
      expect(walRaw).not.toBeNull();
      const walEvents = JSON.parse(walRaw!);
      expect(walEvents.map((e: any) => e.eventType)).toEqual([
        "LOOP",
        "CROSSFADE",
        "SFX",
        "RESTORE"
      ]);

      // Simulate browser reload wiping in-memory timeline, then hydrating from localStorage
      TabletopMixer.timeline = [];
      TabletopMixer.hydrateFromLocalStorage("2026-10-31");
      expect(TabletopMixer.timeline).toHaveLength(4);

      // Saving Table Notes via saveScratchpad() co-flushes the audio timeline
      const scratchpadEl = document.getElementById(
        "scratchpad"
      ) as HTMLTextAreaElement;
      scratchpadEl.value = "# Live Notes\n- Kraken surfaced";
      saveScratchpad();

      expect(saveAudioTimelineSpy).toHaveBeenCalledTimes(1);
      const [flushedSession, flushedJson] = saveAudioTimelineSpy.mock.calls[0];
      expect(flushedSession).toBe("2026-10-31");
      expect(JSON.parse(flushedJson)).toHaveLength(4);
    });
  });

  describe("Ticket 12 & 26: 3-Tier Edge Classifier Failover, Cue Polling & Intent Router", () => {
    it("detects WebGPU support and routes MUSIC_CUE and RULE_QUERY intents via direct call or postMessage", () => {
      expect(handleAudioIntent).toBeDefined();
      expect(hasWebGpuSupport).toBeDefined();
      (window.navigator as any).gpu = {};
      expect(hasWebGpuSupport()).toBe(true);

      TabletopMixer.init();

      handleAudioIntent({
        intent: "MUSIC_CUE",
        mood: "combat",
        rule: null
      });
      expect(
        TabletopMixer.timeline.some(
          (e: any) => e.eventType === "CROSSFADE" && e.track === "combat"
        )
      ).toBe(true);

      handleAudioIntent({
        intent: "RULE_QUERY",
        mood: null,
        rule: "concentration"
      });
      const ruleCard = document.getElementById("rule-card")!;
      expect(ruleCard.style.display).toBe("block");
      expect(document.getElementById("card-title")!.textContent).toContain(
        "Concentration"
      );
    });

    it("resolves 3-tier classifier state machine and polls getLatestAudioCue() to update #classifier-tier-status and trigger cues", () => {
      expect(resolveClassifierTier).toBeDefined();
      expect(pollLatestAudioCue).toBeDefined();

      // 1. Tier 1 local Pi within 1500ms budget
      const t1 = resolveClassifierTier(
        { piConnection: "ONLINE" },
        {
          tier1Status: "OK",
          tier1LatencyMs: 620,
          cue: { intent: "MUSIC_CUE", mood: "combat", rule: null }
        }
      );
      expect(t1).toEqual({
        activeTier: "TIER_1_PI_LOCAL",
        cue: { intent: "MUSIC_CUE", mood: "combat", rule: null },
        reason: "Tier 1 local Pi model"
      });

      // 2. Tier 1 timeout (>1500ms) -> failover to Tier 2 Gemini 2.5 Flash
      const t2 = resolveClassifierTier(
        { piConnection: "ONLINE" },
        {
          tier1Status: "OK",
          tier1LatencyMs: 1890,
          tier2Status: "OK",
          cue: { intent: "RULE_QUERY", mood: null, rule: "grappling" }
        }
      );
      expect(t2).toEqual({
        activeTier: "TIER_2_GEMINI_CLOUD",
        cue: { intent: "RULE_QUERY", mood: null, rule: "grappling" },
        reason:
          "Tier 1 exceeded 1500ms or failed -> Auto-routed Speech Chunk to Tier 2 Gemini 2.5 Flash"
      });

      // 3. Both Tier 1 & Tier 2 fail -> Tier 3 Manual UI
      const t3Fail = resolveClassifierTier(
        { piConnection: "ONLINE" },
        { tier1Status: "ERROR", tier2Status: "ERROR" }
      );
      expect(t3Fail).toEqual({
        activeTier: "TIER_3_MANUAL_UI",
        reason:
          "Tier 1 & Tier 2 unavailable -> Degraded to Tier 3 Manual GM Screen Controls"
      });

      // 4. Pi offline -> Tier 3 Manual UI
      const t3Offline = resolveClassifierTier(
        { piConnection: "OFFLINE" },
        { tier1Status: "OK", tier1LatencyMs: 200 }
      );
      expect(t3Offline).toEqual({
        activeTier: "TIER_3_MANUAL_UI",
        reason: "Pi offline -> Manual UI controls active"
      });

      // 5. pollLatestAudioCue fetches from getLatestAudioCue and routes through handleAudioIntent
      const cueHarness = setupClientHarness({
        latestAudioCue: {
          intent: "MUSIC_CUE",
          mood: "score_tension",
          rule: null,
          tier: "TIER_2_GEMINI_CLOUD"
        }
      });
      cueHarness.TabletopMixer.init();
      cueHarness.pollLatestAudioCue();
      expect(cueHarness.getLatestAudioCueSpy).toHaveBeenCalledTimes(1);
      expect(
        document.getElementById("classifier-tier-status")!.textContent
      ).toContain("TIER_2_GEMINI_CLOUD");
      expect(
        cueHarness.TabletopMixer.timeline.some(
          (e: any) => e.eventType === "CROSSFADE" && e.track === "score_tension"
        )
      ).toBe(true);
    });
  });
});
