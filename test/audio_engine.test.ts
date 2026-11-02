// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import { marked } from "marked";
import MiniSearch from "minisearch";

describe("Web Audio Engine & IndexedDB Pre-Caching (Tickets 04, 05, 06, 12)", () => {
  let AudioCache: any;
  let TabletopMixer: any;
  let handleAudioIntent: any;
  let hasWebGpuSupport: any;
  let flushAudioTimeline: any;
  let saveAudioTimelineSpy: ReturnType<typeof vi.fn>;
  let idbStore: Map<string, ArrayBuffer>;
  let idbOpenSpy: ReturnType<typeof vi.fn>;
  let audioCtxCreateGainSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <select id="session-select"></select>
      <input type="text" id="filter-input" value="" />
      <div id="audio-cache-status"></div>
      <div id="file-list"></div>
      <span id="scratchpad-label"></span>
      <textarea id="scratchpad"></textarea>
      <span id="save-status"></span>
      <span id="left-title"></span>
      <button id="pin-btn"></button>
      <div id="left-content"></div>
      <div id="right-pane"></div>
      <span id="right-title"></span>
      <div id="right-content"></div>
      <div id="player-hud" style="display:none;">
        <div id="rule-card" style="display:none;">
          <h2 id="card-title"></h2>
          <div id="card-type"></div>
          <p id="card-text"></p>
        </div>
      </div>
    `;

    idbStore = new Map<string, ArrayBuffer>();
    idbOpenSpy = vi.fn().mockImplementation(() => {
      const req: any = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: vi.fn(),
          transaction: () => ({
            objectStore: () => ({
              get: (key: string) => {
                const getReq: any = { result: idbStore.get(key) };
                setTimeout(() => getReq.onsuccess && getReq.onsuccess(), 0);
                return getReq;
              },
              put: (val: ArrayBuffer, key: string) => {
                idbStore.set(key, val);
                const putReq: any = {};
                setTimeout(() => putReq.onsuccess && putReq.onsuccess(), 0);
                return putReq;
              }
            })
          })
        }
      };
      Promise.resolve().then(() => {
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    });
    (window as any).indexedDB = { open: idbOpenSpy };

    audioCtxCreateGainSpy = vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      gain: {
        value: 1.0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn()
      }
    }));
    (window as any).AudioContext = class MockAudioContext {
      currentTime = 10.0;
      destination = {};
      createGain = audioCtxCreateGainSpy;
      decodeAudioData = vi.fn();
      createBufferSource = vi.fn();
    };

    saveAudioTimelineSpy = vi.fn();
    (window as any).marked = marked;
    (window as any).MiniSearch = MiniSearch;
    (window as any).google = {
      script: {
        run: {
          withSuccessHandler: (cb: any) => ({
            getScratchpadNotes: vi.fn(),
            saveScratchpadNotes: vi.fn(),
            getSessionList: vi.fn(),
            getSessionManifest: vi.fn(),
            getFilePayload: vi.fn(),
            saveAudioTimeline: (sessionDate: string, json: string) => {
              saveAudioTimelineSpy(sessionDate, json);
              if (cb) cb({ status: "saved" });
            }
          }),
          saveAudioTimeline: saveAudioTimelineSpy
        }
      }
    };

    const html = fs.readFileSync("Index.html", "utf8");
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/i);
    if (!scriptMatch) {
      throw new Error("Could not find client script in Index.html");
    }
    const cleanScript = scriptMatch[1].replace(
      "<?= sessionDate ?>",
      "2026-10-31"
    );
    const fn = new Function(
      "window",
      "document",
      "marked",
      "MiniSearch",
      "google",
      cleanScript +
        `
      return {
        AudioCache: typeof AudioCache !== "undefined" ? AudioCache : undefined,
        TabletopMixer: typeof TabletopMixer !== "undefined" ? TabletopMixer : undefined,
        handleAudioIntent: typeof handleAudioIntent !== "undefined" ? handleAudioIntent : undefined,
        hasWebGpuSupport: typeof hasWebGpuSupport !== "undefined" ? hasWebGpuSupport : undefined,
        flushAudioTimeline: typeof flushAudioTimeline !== "undefined" ? flushAudioTimeline : undefined
      };
    `
    );
    const exported = fn(
      window,
      document,
      marked,
      MiniSearch,
      (window as any).google
    );
    AudioCache = exported.AudioCache;
    TabletopMixer = exported.TabletopMixer;
    handleAudioIntent = exported.handleAudioIntent;
    hasWebGpuSupport = exported.hasWebGpuSupport;
    flushAudioTimeline = exported.flushAudioTimeline;
  });

  describe("Ticket 04: IndexedDB Audio Pre-Caching Engine", () => {
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
  });

  describe("Ticket 05: Web Audio API 3-Channel Mixer & Gain Ducking", () => {
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
  });

  describe("Ticket 06: Digital Sidecar Audio Logger (session_audio_timeline.json)", () => {
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
  });

  describe("Ticket 12: In-Browser WebGPU Gemma 4 E2B Audio Intent Classifier", () => {
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
  });
});
