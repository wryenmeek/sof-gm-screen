// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setupClientHarness,
  MockLiveTabletopClient
} from "./helpers/client-harness";
import {
  LiveTabletopClient,
  projectCombatPublic,
  calculateStatusBand,
  type AudioCueDocument,
  type CombatGmDocument,
  type CombatantState
} from "../src/live_tabletop_client";

describe("Client-Side Logic (Index.html)", () => {
  let parseCustomMarkdown: (content: string) => string;
  let prepareHtmlSrcdoc: (htmlContent: string) => string;
  let createDrivePreviewIframe: (
    srcUrl: string,
    height?: string
  ) => HTMLIFrameElement;
  let renderManifest: (files: Array<any>) => void;
  let filterFiles: (query: string) => void;
  let tokenizeStatblockAndDossier: (
    fileMeta: any,
    rawContent: string
  ) => {
    id: string;
    name: string;
    simpleName: string;
    mimeType: string;
    title: string;
    tags: string;
    properties: string;
    content: string;
  };
  let indexFilePayload: (payload: any) => void;
  let updateSearchIndexWithContent: (fileOrPayload: any, raw?: string) => void;

  beforeEach(() => {
    const harness = setupClientHarness({
      filePayloads: {
        f1: {
          id: "f1",
          name: "[3. Monsters] Muttering_Serpent_Statblock.md",
          type: "markdown",
          content: "## Muttering Serpent\n**Armor Class** :: 14"
        }
      }
    });
    parseCustomMarkdown = harness.parseCustomMarkdown;
    prepareHtmlSrcdoc = harness.prepareHtmlSrcdoc;
    createDrivePreviewIframe = harness.createDrivePreviewIframe;
    renderManifest = harness.renderManifest;
    filterFiles = harness.filterFiles;
    tokenizeStatblockAndDossier = harness.tokenizeStatblockAndDossier;
    indexFilePayload = harness.indexFilePayload;
    updateSearchIndexWithContent = harness.updateSearchIndexWithContent;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("MiniSearch Manifest Indexing (Ticket 02 / #16)", () => {
    const sampleManifest = [
      {
        id: "f1",
        name: "[3. Monsters] Muttering_Serpent_Statblock.md",
        simpleName: "Muttering_Serpent_Statblock.md",
        mimeType: "text/markdown"
      },
      {
        id: "f2",
        name: "[1. Floor Maps] Lapis_Observatory_Level_4.png",
        simpleName: "Lapis_Observatory_Level_4.png",
        mimeType: "image/png"
      },
      {
        id: "f3",
        name: "[3. Monsters] Orange_Sludge_Statblock.md",
        simpleName: "Orange_Sludge_Statblock.md",
        mimeType: "image/png"
      }
    ];

    it("indexes manifest items into MiniSearch and filters with prefix matching and multi-term queries", () => {
      renderManifest(sampleManifest);
      const list = document.getElementById("file-list")!;
      expect(list.children.length).toBe(3);

      // Prefix & multi-token search across non-adjacent tokens (which simple .includes() fails on)
      filterFiles("monsters serp");
      expect(list.children.length).toBe(1);
      expect(list.textContent).toContain("Muttering_Serpent_Statblock.md");

      // Clearing query restores full alphabetical manifest
      filterFiles("");
      expect(list.children.length).toBe(3);
    });
  });

  describe("5e Statblock & Dossier Multi-Field Tokenizer (Ticket 03 / #17)", () => {
    const sampleManifest = [
      {
        id: "m1",
        name: "[3. Monsters] Singing_Golem_Statblock.md",
        simpleName: "Singing_Golem_Statblock.md",
        mimeType: "text/markdown"
      },
      {
        id: "m2",
        name: "[3. Monsters] Orange_Sludge_Statblock.md",
        simpleName: "Orange_Sludge_Statblock.md",
        mimeType: "text/markdown"
      }
    ];

    const golemMarkdown = `\`\`\`markdown
{{monster,frame}}
{monster,frame,wide
## Singing Golem
*Large construct, unaligned*
**Armor Class** :: 18 (natural armor)
**Hit Points** :: 142 (15d10 + 60)
**Speed** :: 30 ft.
**Damage Vulnerabilities** :: thunder, radiant
**Damage Immunities** :: poison, psychic
**Condition Immunities** :: charmed, exhaustion, frightened
**Senses** :: blindsight 60 ft. (blind beyond this radius), passive Perception 10
{{descriptive}}
A resonant construct of bronze and coral.
}}
### Actions
**Harmonic Slam.** Melee Weapon Attack: +9 to hit.
**Legendary Resistance (3/Day).** If the golem fails a saving throw, it can choose to succeed instead.
}
\`\`\``;

    it("strips outer markdown code fences and Homebrewery structural markers so they do not pollute content tokens", () => {
      expect(tokenizeStatblockAndDossier).toBeDefined();
      const doc = tokenizeStatblockAndDossier(sampleManifest[0], golemMarkdown);
      expect(doc.content).not.toContain("```markdown");
      expect(doc.content).not.toContain("```");
      expect(doc.content).not.toContain("{{monster,frame}}");
      expect(doc.content).not.toContain("{{descriptive}}");
      expect(doc.content).not.toContain("{monster,frame");

      // Also test plain ``` outer fences
      const plainFenceDoc = tokenizeStatblockAndDossier(
        sampleManifest[0],
        "```\n## Coral Drake\n**Speed** :: 40 ft., swim 60 ft.\n```"
      );
      expect(plainFenceDoc.content).not.toContain("```");
      expect(plainFenceDoc.title).toContain("Coral Drake");
    });

    it("extracts title, tags, 5e mechanical properties, and content from Homebrewery statblocks", () => {
      expect(tokenizeStatblockAndDossier).toBeDefined();
      const doc = tokenizeStatblockAndDossier(sampleManifest[0], golemMarkdown);
      expect(doc.title).toContain("Singing Golem");
      expect(doc.tags).toContain("3. Monsters");
      expect(doc.properties).toContain("Armor Class 18");
      expect(doc.properties).toContain(
        "Damage Vulnerabilities thunder, radiant"
      );
      expect(doc.properties).toContain("Senses blindsight 60 ft.");
      expect(doc.properties).toContain("Harmonic Slam");
      expect(doc.properties).toContain("Legendary Resistance");
      expect(doc.content).toContain("Legendary Resistance");
    });

    it("extracts standard Homebrewery Armor Class and Speed labels without separators", () => {
      const doc = tokenizeStatblockAndDossier(
        sampleManifest[0],
        "## Coral Drake\n**Armor Class** 17\n**Speed** 30 ft."
      );

      expect(doc.properties).toContain("Armor Class 17");
      expect(doc.properties).toContain("Speed 30 ft.");
    });

    it("keeps custom bold key/value properties in the MiniSearch document", () => {
      const doc = tokenizeStatblockAndDossier(
        sampleManifest[0],
        "## Marsh Drake\n**Environment**: swamp"
      );

      expect(doc.properties).toContain("Environment swamp");
    });

    it("updates the MiniSearch index in place when a file payload is loaded so mechanics queries match the statblock", () => {
      renderManifest(sampleManifest);
      expect(indexFilePayload).toBeDefined();
      expect(updateSearchIndexWithContent).toBeDefined();

      updateSearchIndexWithContent({
        id: "m1",
        name: "[3. Monsters] Singing_Golem_Statblock.md",
        type: "markdown",
        content: golemMarkdown
      });

      const list = document.getElementById("file-list")!;
      filterFiles("radiant vulnerability");
      expect(list.children.length).toBe(1);
      expect(list.textContent).toContain("Singing_Golem_Statblock.md");

      filterFiles("blindsight");
      expect(list.children.length).toBe(1);
      expect(list.textContent).toContain("Singing_Golem_Statblock.md");

      filterFiles("legendary resistance");
      expect(list.children.length).toBe(1);
      expect(list.textContent).toContain("Singing_Golem_Statblock.md");
    });
  });

  describe("BM25+ Ranking, Field Boosting, Fuzzy Typo Tolerance & Keyboard Navigation (Ticket 04 / #18)", () => {
    it("ranks boosted title matches above body content matches for the same search term and recovers from single-character typos", () => {
      const files = [
        {
          id: "doc_lore",
          name: "Room_04_Ambient_Notes.md",
          simpleName: "Room_04_Ambient_Notes.md",
          mimeType: "text/markdown"
        },
        {
          id: "doc_sludge",
          name: "[3. Monsters] Orange_Sludge_Statblock.md",
          simpleName: "Orange_Sludge_Statblock.md",
          mimeType: "text/markdown"
        }
      ];
      renderManifest(files);

      // Room_04 mentions "orange sludge" several times in body content, while doc_sludge has it in the title
      indexFilePayload({
        id: "doc_lore",
        name: "Room_04_Ambient_Notes.md",
        type: "markdown",
        content:
          "# Room 04\nThere is some orange sludge dripping from the pipe. The orange sludge smells acidic."
      });
      indexFilePayload({
        id: "doc_sludge",
        name: "[3. Monsters] Orange_Sludge_Statblock.md",
        type: "markdown",
        content: "## Orange Sludge\n*Large ooze*\n**Armor Class** :: 8"
      });

      filterFiles("orange sludge");
      const list = document.getElementById("file-list")!;
      expect(list.children.length).toBe(2);
      // Title boost (3.0) + tags boost (2.5) must rank Orange_Sludge_Statblock.md first!
      expect(list.children[0].textContent).toContain(
        "Orange_Sludge_Statblock.md"
      );

      // Single-character typo tolerance (fuzzy: 0.2): "orangge sludg" -> matches Orange_Sludge_Statblock.md
      filterFiles("orangge sludg");
      expect(list.children.length).toBeGreaterThanOrEqual(1);
      expect(list.children[0].textContent).toContain(
        "Orange_Sludge_Statblock.md"
      );
    });

    it("focuses #filter-input when '/' is pressed outside text inputs, ignores '/' inside INPUT/TEXTAREA/contentEditable, and clears/blurs on 'Escape'", () => {
      const files = [
        {
          id: "f1",
          name: "[3. Monsters] Muttering_Serpent_Statblock.md",
          simpleName: "Muttering_Serpent_Statblock.md",
          mimeType: "text/markdown"
        },
        {
          id: "f2",
          name: "Golem.md",
          simpleName: "Golem.md",
          mimeType: "text/markdown"
        }
      ];
      renderManifest(files);
      const input = document.getElementById("filter-input") as HTMLInputElement;
      const tableNotesEl = document.getElementById(
        "scratchpad"
      ) as HTMLTextAreaElement;

      // Pressing '/' while focused in textarea must NOT steal focus
      tableNotesEl.focus();
      expect(document.activeElement).toBe(tableNotesEl);
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "/", bubbles: true })
      );
      expect(document.activeElement).toBe(tableNotesEl);
      tableNotesEl.blur();

      // Dispatch '/' keydown outside inputs -> focuses #filter-input
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "/", bubbles: true })
      );
      expect(document.activeElement).toBe(input);

      // Type a filter query and filter
      input.value = "Golem";
      filterFiles("Golem");
      expect(document.getElementById("file-list")!.children.length).toBe(1);

      // Dispatch 'Escape' keydown -> clears query, blurs input, restores full manifest
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      expect(input.value).toBe("");
      expect(document.activeElement).not.toBe(input);
      expect(document.getElementById("file-list")!.children.length).toBe(2);
    });

    it("loads selected search result into the primary view pane and highlights its card in gold (.active)", () => {
      const files = [
        {
          id: "f1",
          name: "[3. Monsters] Muttering_Serpent_Statblock.md",
          simpleName: "Muttering_Serpent_Statblock.md",
          mimeType: "text/markdown"
        },
        {
          id: "f2",
          name: "Golem.md",
          simpleName: "Golem.md",
          mimeType: "text/markdown"
        }
      ];
      renderManifest(files);
      filterFiles("Serpent");
      const list = document.getElementById("file-list")!;
      expect(list.children.length).toBe(1);

      const item = list.children[0] as HTMLElement;
      item.click();
      expect(item.classList.contains("active")).toBe(true);
      expect(document.getElementById("left-title")!.textContent).toContain(
        "Muttering_Serpent_Statblock.md"
      );
      expect(document.getElementById("left-content")!.innerHTML).toContain(
        "Muttering Serpent"
      );
    });
  });

  describe("parseCustomMarkdown", () => {
    it("strips outer ```markdown code fences if present", () => {
      const input = "```markdown\n# Session Lore\n\nThe island awaits.\n```";
      const result = parseCustomMarkdown(input);
      expect(result).toContain("<h1");
      expect(result).toContain("Session Lore");
      expect(result).not.toContain("```markdown");
    });

    it("parses 5e Homebrewery statblock syntax", () => {
      const input =
        "{monster,frame\n## Goblin\n*Small humanoid*\n**Armor Class** :: 15\n}";
      const result = parseCustomMarkdown(input);
      expect(result).toContain('<div class="dnd-statblock">');
      expect(result).toContain("<strong>Armor Class:</strong> 15");
      expect(result).toContain("</div>");
    });

    it("converts bonus tag syntax into parenthesized notation", () => {
      const input = "- **Dagger:** {bonus **Hit** +4} to hit, 1d4+2 piercing";
      const result = parseCustomMarkdown(input);
      expect(result).toContain("(<strong>Hit</strong> +4)");
    });
  });

  describe("prepareHtmlSrcdoc", () => {
    it("injects base target and navigation interceptors into HTML with <head>", () => {
      const html =
        "<!DOCTYPE html><html><head><title>Doc</title></head><body><h1>Content</h1></body></html>";
      const prepared = prepareHtmlSrcdoc(html);
      expect(prepared).toContain('<base target="_self">');
      expect(prepared).toContain("initNavInterceptors");
      expect(prepared).toContain("OPEN_FILE_BY_NAME");
    });

    it("prepends injection if no <head> tag exists", () => {
      const html = "<div>Snippet</div>";
      const prepared = prepareHtmlSrcdoc(html);
      expect(prepared.startsWith('\n        <base target="_self">')).toBe(true);
      expect(prepared).toContain("<div>Snippet</div>");
    });
  });

  describe("createDrivePreviewIframe", () => {
    it("creates an iframe element with responsive width, height, and border styling", () => {
      const iframe = createDrivePreviewIframe(
        "https://drive.google.com/file/d/test123/preview",
        "400px"
      );
      expect(iframe.tagName.toLowerCase()).toBe("iframe");
      expect(iframe.src).toBe(
        "https://drive.google.com/file/d/test123/preview"
      );
      expect(iframe.style.width).toBe("100%");
      expect(iframe.style.height).toBe("400px");
      expect(iframe.style.borderRadius).toBe("6px");
    });
  });

  describe("On-Demand Narrative Promise Extractor Trigger (Ticket 11 / #25)", () => {
    it("renders #extract-promises-btn in Table Notes header, saves notes first, calls extractNarrativePromises(currentSessionDate), and updates #notes-status", async () => {
      const harness = setupClientHarness({
        gmKey: "gm-secret-42",
        extractedPromisesResult: {
          created: 3,
          tasks: [
            { id: "t1", title: "Promise A" },
            { id: "t2", title: "Promise B" },
            { id: "t3", title: "Promise C" }
          ]
        }
      });

      const clearCacheBtn = document.getElementById("clear-audio-cache-btn");
      expect(clearCacheBtn).not.toBeNull();

      const btn = document.getElementById(
        "extract-promises-btn"
      ) as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toContain("✨ Extract Promises to Tasks");
      expect(harness.triggerPromiseExtraction).toBeDefined();

      const tableNotesEl = document.getElementById(
        "scratchpad"
      ) as HTMLTextAreaElement;
      tableNotesEl.value = "# Session Notes\n- Promise: Pog cloak";

      await harness.triggerPromiseExtraction();
      expect(harness.saveTableNotesSpy).toHaveBeenCalledWith(
        "2026-10-31",
        "# Session Notes\n- Promise: Pog cloak",
        "gm-secret-42"
      );
      expect(harness.extractNarrativePromisesSpy).toHaveBeenCalledWith(
        "2026-10-31",
        "gm-secret-42"
      );
      const statusEl =
        document.getElementById("notes-status") ||
        document.getElementById("save-status");
      expect(statusEl).not.toBeNull();
      expect(statusEl!.textContent).toContain("3");
    });
  });

  describe("Sub-50ms Real-Time Audio Cue & Mood Transition Listener (Ticket 02 / #35)", () => {
    class MockLiveTabletopClient {
      public cueListeners: Array<(cue: AudioCueDocument | null) => void> = [];
      public errorListeners: Array<(err: Error) => void> = [];
      public unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
      public sessionDates: string[] = [];

      subscribeToAudioCue(
        sessionDate: string,
        callback: (cue: AudioCueDocument | null) => void,
        onError?: (err: Error) => void
      ) {
        this.sessionDates.push(sessionDate);
        this.cueListeners.push(callback);
        if (onError) this.errorListeners.push(onError);

        const unsubSpy = vi.fn(() => {
          const idx = this.cueListeners.indexOf(callback);
          if (idx !== -1) this.cueListeners.splice(idx, 1);
        });
        this.unsubscribes.push(unsubSpy);
        return unsubSpy;
      }

      emitCue(cue: AudioCueDocument | null) {
        for (const listener of [...this.cueListeners]) {
          listener(cue);
        }
      }

      emitError(err: Error) {
        for (const onError of [...this.errorListeners]) {
          onError(err);
        }
      }
    }

    const combatScoreId = "combat-score-drive-id";
    const sampleScoreManifest = [
      {
        id: combatScoreId,
        name: "[Score] combat_theme.mp3",
        simpleName: "combat_theme.mp3",
        mimeType: "audio/mpeg"
      }
    ];

    it("subscribes to sessions/{date}/live/audio_cue and triggers instant mood crossfades in <50ms without polling", () => {
      const mockClient = new MockLiveTabletopClient();
      const harness = setupClientHarness({
        liveTabletopClient: mockClient as any
      });

      harness.renderManifest(sampleScoreManifest);
      harness.AudioCache.memoryStore.set(combatScoreId, new ArrayBuffer(16));
      harness.TabletopMixer.init();

      // Subscribe to live audio cues
      harness.initLiveAudioCueSubscription("2026-10-31");
      expect(mockClient.sessionDates).toContain("2026-10-31");
      expect(mockClient.cueListeners).toHaveLength(1);
      // Polling remains active until the first valid snapshot arrives
      expect(harness.isFirestoreLive()).toBe(false);
      harness.pollLatestAudioCue();
      expect(harness.getLatestAudioCueSpy).toHaveBeenCalledTimes(1);
      harness.getLatestAudioCueSpy.mockClear();

      // Simulate incoming live audio cue snapshot
      const start = performance.now();
      mockClient.emitCue({
        intent: "MUSIC_CUE",
        mood: "combat",
        source: "pi_vad_tier1",
        triggeredAt: 1730500000100
      });
      const elapsedMs = performance.now() - start;

      // Acceptance criterion: instant crossfade executed in <50ms without polling
      expect(elapsedMs).toBeLessThan(50);
      expect(harness.isFirestoreLive()).toBe(true);
      harness.pollLatestAudioCue();
      expect(harness.getLatestAudioCueSpy).not.toHaveBeenCalled();
      expect(
        harness.TabletopMixer.activeScorePlayback.source.start
      ).toHaveBeenCalledWith(0);

      const crossfades = harness.TabletopMixer.timeline.filter(
        (e: any) => e.eventType === "CROSSFADE" && e.track === "combat"
      );
      expect(crossfades).toHaveLength(1);

      // Verify classifier tier label updated in UI
      const tierEl = document.getElementById("classifier-tier-status");
      expect(tierEl?.textContent).toBe("Tier: pi_vad_tier1");
    });

    it("triggers speech ducking instantly when cue payload specifies ducking", () => {
      const mockClient = new MockLiveTabletopClient();
      const harness = setupClientHarness({
        liveTabletopClient: mockClient as any
      });

      harness.renderManifest(sampleScoreManifest);
      harness.AudioCache.memoryStore.set(combatScoreId, new ArrayBuffer(16));
      harness.TabletopMixer.init();
      harness.initLiveAudioCueSubscription("2026-10-31");

      const duckSpy = vi.spyOn(harness.TabletopMixer, "duckTrackForSpeech");

      mockClient.emitCue({
        intent: "MUSIC_CUE",
        mood: "combat",
        source: "gemini_tier2",
        triggeredAt: 1730500000200,
        payload: {
          ducking: true,
          duckingGain: 0.15,
          duckingDurationMs: 1200
        }
      });

      expect(duckSpy).toHaveBeenCalledWith(1200, 0.15);
      const duckEvents = harness.TabletopMixer.timeline.filter(
        (e: any) => e.eventType === "DUCK"
      );
      expect(duckEvents).toHaveLength(1);
      expect(duckEvents[0].gain).toBe(0.15);
    });

    it("deduplicates audio cues by timestamp and handles Firestore Timestamp objects", () => {
      const mockClient = new MockLiveTabletopClient();
      const harness = setupClientHarness({
        liveTabletopClient: mockClient as any
      });

      harness.renderManifest(sampleScoreManifest);
      harness.AudioCache.memoryStore.set(combatScoreId, new ArrayBuffer(16));
      harness.TabletopMixer.init();
      harness.initLiveAudioCueSubscription("2026-10-31");

      const firestoreTimestamp = {
        toMillis: () => 1730500000300
      };

      // First emission
      mockClient.emitCue({
        intent: "MUSIC_CUE",
        mood: "combat",
        source: "gm_manual_tier3",
        triggeredAt: firestoreTimestamp
      });

      expect(
        harness.TabletopMixer.timeline.filter(
          (e: any) => e.eventType === "CROSSFADE" && e.track === "combat"
        )
      ).toHaveLength(1);

      // Duplicate emission with identical toMillis timestamp is ignored
      mockClient.emitCue({
        intent: "MUSIC_CUE",
        mood: "combat",
        source: "gm_manual_tier3",
        triggeredAt: firestoreTimestamp
      });

      expect(
        harness.TabletopMixer.timeline.filter(
          (e: any) => e.eventType === "CROSSFADE" && e.track === "combat"
        )
      ).toHaveLength(1);
    });

    it("resumes HTTP polling fallback on Firestore error and suppresses again on reconnect", () => {
      const mockClient = new MockLiveTabletopClient();
      const harness = setupClientHarness({
        liveTabletopClient: mockClient as any
      });

      harness.initLiveAudioCueSubscription("2026-10-31");
      // Initially false before first snapshot
      expect(harness.isFirestoreLive()).toBe(false);
      harness.pollLatestAudioCue();
      expect(harness.getLatestAudioCueSpy).toHaveBeenCalledTimes(1);
      harness.getLatestAudioCueSpy.mockClear();

      // First snapshot arrives: live state is established and polling is suppressed
      mockClient.emitCue(null);
      expect(harness.isFirestoreLive()).toBe(true);
      harness.pollLatestAudioCue();
      expect(harness.getLatestAudioCueSpy).not.toHaveBeenCalled();

      // Stream error: failover to HTTP polling
      mockClient.emitError(new Error("Network connection dropped"));
      expect(harness.isFirestoreLive()).toBe(false);

      harness.pollLatestAudioCue();
      expect(harness.getLatestAudioCueSpy).toHaveBeenCalledTimes(1);

      // Reconnect: snapshot arrives and restores live state
      mockClient.emitCue({
        intent: "RULE_QUERY",
        mood: null as any,
        rule: "grappled",
        source: "pi_vad_tier1",
        triggeredAt: 1730500000400
      });

      expect(harness.isFirestoreLive()).toBe(true);

      // Subsequent polling calls are suppressed again
      harness.pollLatestAudioCue();
      expect(harness.getLatestAudioCueSpy).toHaveBeenCalledTimes(1);
    });

    it("unsubscribes prior listener on session switch to prevent memory leaks and zombie reads", () => {
      const mockClient = new MockLiveTabletopClient();
      const harness = setupClientHarness({
        liveTabletopClient: mockClient as any
      });

      harness.initLiveAudioCueSubscription("2026-10-31");
      expect(mockClient.sessionDates).toEqual(["2026-10-31"]);
      const initialUnsub = mockClient.unsubscribes[0];
      expect(initialUnsub).not.toHaveBeenCalled();

      // Switch session to 2026-11-20
      harness.loadSession("2026-11-20");

      expect(initialUnsub).toHaveBeenCalledTimes(1);
      expect(mockClient.sessionDates).toEqual(["2026-10-31", "2026-11-20"]);
      expect(mockClient.cueListeners).toHaveLength(1);

      // Teardown on unmount
      harness.teardownLiveAudioCueSubscription();
      const secondUnsub = mockClient.unsubscribes[1];
      expect(secondUnsub).toHaveBeenCalledTimes(1);
      expect(harness.isFirestoreLive()).toBe(false);
    });

    it("subscribes and disposes cleanly using the real LiveTabletopClient modular instance", () => {
      const realClient = new LiveTabletopClient({
        appName: `real-client-test-${Date.now()}`
      });
      const harness = setupClientHarness({
        liveTabletopClient: realClient
      });

      const unsub = harness.initLiveAudioCueSubscription("2026-10-31");
      expect(unsub).toBeDefined();
      expect(harness.isFirestoreLive()).toBe(false);

      // Polling is active while waiting for live snapshot
      harness.pollLatestAudioCue();
      expect(harness.getLatestAudioCueSpy).toHaveBeenCalledTimes(1);

      // Clean unmount
      harness.teardownLiveAudioCueSubscription();
      expect(harness.isFirestoreLive()).toBe(false);
      realClient.destroy();
    });
  });

  describe("Ticket 04 / #37: Real-Time Combat Synchronization & DevTools Leak Prevention", () => {
    const sampleCombatants: CombatantState[] = [
      {
        id: "c_assassin",
        name: "Deep Assassin",
        hp: 80,
        maxHp: 80,
        ac: 16,
        initiative: 22,
        status: "active",
        claimedBy: null,
        isPlayerVisible: false
      },
      {
        id: "c_pog",
        name: "Pog",
        hp: 45,
        maxHp: 45,
        ac: 17,
        initiative: 18,
        status: "active",
        claimedBy: "player_pog",
        isPlayerVisible: true
      },
      {
        id: "c_sahuagin",
        name: "Sahuagin Raider",
        hp: 20,
        maxHp: 45,
        ac: 14,
        initiative: 12,
        status: "active",
        claimedBy: null,
        isPlayerVisible: true
      },
      {
        id: "c_lurker",
        name: "Coral Lurker",
        hp: 35,
        maxHp: 35,
        ac: 15,
        initiative: 8,
        status: "active",
        claimedBy: null,
        isPlayerVisible: false
      }
    ];

    it("projectCombatPublic filters out hidden ambush monsters and maps status bands without secret stats", () => {
      const gmState: CombatGmDocument = {
        round: 1,
        activeIndex: 1, // Pog
        combatants: sampleCombatants,
        isRunning: true
      };

      const publicProjection = projectCombatPublic(gmState);

      expect(publicProjection.round).toBe(1);
      expect(publicProjection.isRunning).toBe(true);
      expect(publicProjection.combatants).toBeDefined();
      expect(publicProjection.combatants!.length).toBe(2);

      // DevTools Inspection Leak Prevention: Verify hidden ambush monsters are strictly absent
      const hiddenMonsterNames = publicProjection.combatants!.map(
        (c) => c.name
      );
      expect(hiddenMonsterNames).not.toContain("Deep Assassin");
      expect(hiddenMonsterNames).not.toContain("Coral Lurker");
      expect(hiddenMonsterNames).toEqual(["Pog", "Sahuagin Raider"]);

      // Verify status bands and complete absence of secret monster stats
      const publicPog = publicProjection.combatants![0];
      const publicSahuagin = publicProjection.combatants![1];

      expect(publicPog.statusBand).toBe("UNINJURED");
      expect(publicSahuagin.statusBand).toBe("BLOODIED");

      // Verify secret numbers (ac, raw hp, maxHp) are not leaked on public combatants
      expect((publicSahuagin as any).ac).toBeUndefined();
      expect((publicSahuagin as any).hp).toBeUndefined();
      expect((publicSahuagin as any).maxHp).toBeUndefined();
      expect((publicSahuagin as any).notes).toBeUndefined();
    });

    it("masks activeIndex to -1 when current turn belongs to a hidden ambush monster", () => {
      const gmStateAmbushActive: CombatGmDocument = {
        round: 1,
        activeIndex: 0, // Deep Assassin (isPlayerVisible: false)
        combatants: sampleCombatants,
        isRunning: true
      };

      const publicProjection = projectCombatPublic(gmStateAmbushActive);

      // Active index masked so curious players inspecting DevTools cannot infer a hidden turn
      expect(publicProjection.activeIndex).toBe(-1);

      // When turn switches to a visible combatant, activeIndex correctly maps to the visible list index
      const gmStateVisibleActive: CombatGmDocument = {
        round: 1,
        activeIndex: 2, // Sahuagin Raider (index 1 in visible list)
        combatants: sampleCombatants,
        isRunning: true
      };

      const visibleProjection = projectCombatPublic(gmStateVisibleActive);
      expect(visibleProjection.activeIndex).toBe(1);
    });

    it("calculates 5e Status Bands aligned strictly with GLOSSARY.md thresholds", () => {
      expect(calculateStatusBand(45, 45)).toBe("UNINJURED"); // 100%
      expect(calculateStatusBand(50, 45)).toBe("UNINJURED"); // Over max
      expect(calculateStatusBand(35, 45)).toBe("INJURED"); // 77.8% (50-99%)
      expect(calculateStatusBand(23, 45)).toBe("INJURED"); // 51.1%
      expect(calculateStatusBand(20, 45)).toBe("BLOODIED"); // 44.4% (25-49%)
      expect(calculateStatusBand(12, 45)).toBe("BLOODIED"); // 26.7%
      expect(calculateStatusBand(10, 45)).toBe("CRITICAL"); // 22.2% (1-24%)
      expect(calculateStatusBand(1, 45)).toBe("CRITICAL"); // 2.2%
      expect(calculateStatusBand(0, 45)).toBe("DOWN"); // 0 HP
      expect(calculateStatusBand(-10, 45)).toBe("DOWN"); // Negative HP
    });

    it("prevents DevTools DOM inspection by stripping GM Combat Tracker in Companion Mode (ADR-0008)", () => {
      const companionHarness = setupClientHarness({
        viewMode: "companion"
      });

      expect(companionHarness.initCompanionState).toBeDefined();
      (window as any).onload();

      // In Companion mode, GM combat tracker and stat table are removed from the DOM
      expect(document.getElementById("gm-combat-tracker")).toBeNull();
      expect(document.getElementById("gm-combat-table")).toBeNull();

      // Player combat tracker exists in Companion HUD
      expect(document.getElementById("player-combat-tracker")).not.toBeNull();
    });

    it("renders GM combat tracker with ambush indicators and advances turns in desktop mode", () => {
      const gmHarness = setupClientHarness({
        viewMode: "gm"
      });

      expect(gmHarness.renderGmCombat).toBeDefined();
      expect(gmHarness.advanceCombatTurn).toBeDefined();

      const gmState: CombatGmDocument = {
        round: 1,
        activeIndex: 0,
        combatants: sampleCombatants,
        isRunning: true
      };

      gmHarness.renderGmCombat(gmState);

      const tableEl = document.getElementById("gm-combat-table");
      const listEl = document.getElementById("gm-combat-list");
      const roundEl = document.getElementById("gm-combat-round");

      expect(tableEl).not.toBeNull();
      expect(listEl).not.toBeNull();
      expect(roundEl?.textContent).toBe("Round 1");
      expect(listEl!.children.length).toBe(4);

      // Verify ambush badges rendered in GM view
      expect(listEl!.innerHTML).toContain("👁️ Hidden");
      expect(listEl!.innerHTML).toContain("👁️ Public");

      // Advance turn
      gmHarness.advanceCombatTurn(1);
      const activeState = gmHarness.getActiveCombatGmState();
      expect(activeState.activeIndex).toBe(1);

      // Advance across all combatants to wrap round
      gmHarness.advanceCombatTurn(1); // 2
      gmHarness.advanceCombatTurn(1); // 3
      gmHarness.advanceCombatTurn(1); // Wraps to 0, Round 2
      const wrappedState = gmHarness.getActiveCombatGmState();
      expect(wrappedState.activeIndex).toBe(0);
      expect(wrappedState.round).toBe(2);
      expect(roundEl?.textContent).toBe("Round 2");
    });

    it("renders player combat projection with status bands and no ambush monsters", () => {
      const harness = setupClientHarness({
        viewMode: "companion"
      });

      expect(harness.renderPlayerCombat).toBeDefined();

      const projected = projectCombatPublic({
        round: 2,
        activeIndex: 1,
        combatants: sampleCombatants,
        isRunning: true
      });

      harness.renderPlayerCombat(projected);

      const trackerEl = document.getElementById("player-combat-tracker");
      const listEl = document.getElementById("player-combat-list");
      const roundEl = document.getElementById("player-combat-round");

      expect(trackerEl?.style.display).toBe("block");
      expect(roundEl?.textContent).toBe("Round 2");
      expect(listEl!.children.length).toBe(2);

      // Verify DOM does not contain hidden monsters
      expect(listEl!.textContent).not.toContain("Deep Assassin");
      expect(listEl!.textContent).not.toContain("Coral Lurker");

      // Verify status bands rendered
      expect(listEl!.innerHTML).toContain("UNINJURED");
      expect(listEl!.innerHTML).toContain("BLOODIED");
      expect(listEl!.innerHTML).toContain("active-combatant");
    });

    it("Ticket 06 / #39: GM Screen subscribes to live/reactions and renders transient floating reaction bubbles above initiative tracker", async () => {
      vi.useFakeTimers();
      try {
        const gmHarness = setupClientHarness({
          viewMode: "gm"
        });
        (window as any).onload();

        const reactionsContainer = document.getElementById(
          "gm-reactions-container"
        );
        expect(reactionsContainer).not.toBeNull();

        // Emit reaction on liveTabletopClient
        await gmHarness.liveTabletopClient.sendReaction("2026-10-31", {
          id: "rx_test_1",
          uid: "player_pog",
          characterName: "Pog",
          emoji: "⚔️",
          timestamp: Date.now()
        });

        // Advance timer for reaction listener callback
        await vi.advanceTimersByTimeAsync(50);

        // Verify bubble rendered inside #gm-reactions-container
        const bubbles = reactionsContainer!.querySelectorAll(
          ".floating-reaction-bubble"
        );
        expect(bubbles.length).toBe(1);
        expect(bubbles[0].textContent).toContain("⚔️");
        expect(bubbles[0].textContent).toContain("Pog");
        expect(bubbles[0].getAttribute("data-reaction-id")).toBe("rx_test_1");

        // Verify transient cleanup after timeout (2400ms)
        await vi.advanceTimersByTimeAsync(2500);
        expect(
          reactionsContainer!.querySelectorAll(".floating-reaction-bubble")
            .length
        ).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("Ticket 06 / #39: FIFO bounds logic in sendReaction ensures reactions array never exceeds 20 items", async () => {
      const harness = setupClientHarness({
        viewMode: "companion"
      });
      const client = harness.liveTabletopClient;

      // Seed 20 reactions
      for (let i = 1; i <= 20; i++) {
        await client.sendReaction("2026-10-31", {
          id: `rx_${i}`,
          uid: "player_1",
          characterName: "Pog",
          emoji: "⚔️",
          timestamp: 1000 + i
        });
      }

      expect(client.reactionsStore.length).toBe(20);
      expect(client.reactionsStore[0].id).toBe("rx_1");
      expect(client.reactionsStore[19].id).toBe("rx_20");

      // Send 21st reaction
      await client.sendReaction("2026-10-31", {
        id: "rx_21_overflow",
        uid: "player_1",
        characterName: "Pog",
        emoji: "💀",
        timestamp: 2000
      });

      // Still capped at 20 items, oldest reaction rx_1 evicted, newest is rx_21_overflow
      expect(client.reactionsStore.length).toBe(20);
      expect(client.reactionsStore[0].id).toBe("rx_2");
      expect(client.reactionsStore[19].id).toBe("rx_21_overflow");
      expect(client.reactionsStore[19].emoji).toBe("💀");
    });

    it("Ticket 03 / #48: #rule-card renders canonical Arbiter rulings with confidence and formatted citations", () => {
      const harness = setupClientHarness({
        viewMode: "companion"
      });

      harness.showRuleCard({
        ruleTitle: "Concentration in Water",
        ruleId: "concentration_water",
        summary: "Taking damage while swimming requires standard Con save.",
        ruling:
          "Environmental pressure or suffocation does not inherently break concentration unless damage is dealt, triggering the DC 10 / half damage save.",
        citations: ["PHB p. 203", "SRD p. 101"],
        confidence: "exact"
      });

      const card = document.getElementById("rule-card")!;
      expect(card.classList.contains("visible")).toBe(true);
      expect(document.getElementById("card-title")!.textContent).toBe(
        "Concentration in Water"
      );
      expect(document.getElementById("card-summary")!.textContent).toBe(
        "Taking damage while swimming requires standard Con save."
      );
      expect(document.getElementById("card-ruling")!.textContent).toContain(
        "DC 10 / half damage save"
      );

      const confidenceEl = document.getElementById("card-confidence")!;
      expect(confidenceEl.textContent).toBe("exact");
      expect(confidenceEl.getAttribute("data-confidence")).toBe("exact");

      const citationsEl = document.getElementById("card-citations")!;
      expect(citationsEl.children.length).toBe(2);
      expect(citationsEl.children[0].textContent).toBe("PHB p. 203");
      expect(citationsEl.children[1].textContent).toBe("SRD p. 101");
    });

    it("Ticket 03 / #48: submits player feedback with rule ID to Firestore rules_feedback collection", async () => {
      const harness = setupClientHarness({
        viewMode: "companion",
        mockUser: { uid: "companion_user_42" }
      });

      harness.showRuleCard({
        ruleTitle: "Opportunity Attacks with Reach",
        ruleId: "reach_opportunity_attack",
        summary: "Leaving reach triggers reaction attack.",
        confidence: "exact"
      });

      const btnUp = document.getElementById("btn-up") as HTMLButtonElement;
      btnUp.click();

      await new Promise((r) => setTimeout(r, 10));

      const client = harness.liveTabletopClient as any;
      expect(client.feedbackHistory.length).toBe(1);
      expect(client.feedbackHistory[0]).toMatchObject({
        ruleId: "reach_opportunity_attack",
        isHelpful: true,
        authorUid: "companion_user_42",
        timestamp: expect.any(Number)
      });
      expect(
        document.getElementById("rule-card")!.classList.contains("visible")
      ).toBe(false);
    });

    it("Ticket 04 / #49: expands #rule-card modal with broadcast ruling details upon receiving incoming RULE_QUERY intent", () => {
      const mockClient = new MockLiveTabletopClient();
      const harness = setupClientHarness({
        liveTabletopClient: mockClient as any,
        viewMode: "companion"
      });
      harness.initLiveAudioCueSubscription("2026-10-31");

      // Emit incoming RULE_QUERY cue with structured ruling payload
      mockClient.emitCue({
        intent: "RULE_QUERY",
        mood: "exploration",
        rule: "Underwater Concentration",
        source: "companion_ptt",
        payload: {
          ruleTitle: "Underwater Concentration",
          ruleId: "underwater_concentration",
          summary: "Taking damage while swimming requires standard Con save.",
          ruling: "DC 10 or half damage save required when submerged.",
          confidence: 1.0,
          ruleConfidence: "exact",
          citations: ["PHB p. 203", "DMG p. 116"]
        }
      });

      const card = document.getElementById("rule-card")!;
      expect(card.classList.contains("visible")).toBe(true);
      expect(document.getElementById("card-title")!.textContent).toBe(
        "Underwater Concentration"
      );
      expect(document.getElementById("card-summary")!.textContent).toBe(
        "Taking damage while swimming requires standard Con save."
      );
      expect(document.getElementById("card-ruling")!.textContent).toBe(
        "DC 10 or half damage save required when submerged."
      );
      const confEl = document.getElementById("card-confidence")!;
      expect(confEl.textContent).toBe("exact");
      expect(confEl.getAttribute("data-confidence")).toBe("exact");
      const citationsEl = document.getElementById("card-citations")!;
      expect(citationsEl.children.length).toBe(2);
      expect(citationsEl.children[0].textContent).toBe("PHB p. 203");
      expect(citationsEl.children[1].textContent).toBe("DMG p. 116");
    });

    it("Ticket 04 / #49: broadcasts resolved rules ruling to live/audio_cue when arbiter query resolves", async () => {
      const mockClient = new MockLiveTabletopClient();
      const mockArbiter = {
        queryRulesArbiter: vi.fn().mockResolvedValue({
          success: true,
          data: {
            ruleTitle: "Cover and Reach",
            ruleId: "cover_reach",
            summary: "Cover bonus applies against reach melee attacks.",
            ruling: "Creature with half cover gets +2 to AC.",
            confidence: "interpretation",
            citations: ["PHB p. 196"]
          }
        })
      };
      const harness = setupClientHarness({
        liveTabletopClient: mockClient as any,
        rulesArbiterClient: mockArbiter as any,
        sessionDate: "2026-10-31"
      });

      // Query with broadcast enabled (default)
      await harness.executeDictationQuery(
        "Can I attack with reach through cover?",
        true
      );
      await new Promise((r) => setTimeout(r, 10));

      expect(mockClient.broadcastRuleQueryCalls.length).toBe(1);
      expect(mockClient.broadcastRuleQueryCalls[0].sessionDate).toBe(
        "2026-10-31"
      );
      expect(mockClient.broadcastRuleQueryCalls[0].ruling.ruleTitle).toBe(
        "Cover and Reach"
      );

      // Query with broadcast disabled
      mockClient.broadcastRuleQueryCalls = [];
      await harness.executeDictationQuery(
        "Can I attack with reach through cover?",
        false
      );
      await new Promise((r) => setTimeout(r, 10));

      expect(mockClient.broadcastRuleQueryCalls.length).toBe(0);
    });

    it("Ticket 04 / #49: LiveTabletopClient.broadcastRuleQuery formats and publishes RULE_QUERY cue document", async () => {
      const mockPublish = vi.fn().mockResolvedValue(undefined);
      const client = new LiveTabletopClient({
        appName: `test-arbiter-${Date.now()}`
      });
      client.publishAudioCue = mockPublish;

      await client.broadcastRuleQuery(
        "2026-11-20",
        {
          ruleTitle: "Grappling Escape",
          ruleId: "grapple_escape",
          summary: "Contested Athletics vs Athletics or Acrobatics.",
          ruling: "Target uses an action to break free with contest check.",
          confidence: "exact",
          citations: ["PHB p. 195"]
        },
        "companion_ptt"
      );

      expect(mockPublish).toHaveBeenCalledTimes(1);
      expect(mockPublish).toHaveBeenCalledWith("2026-11-20", {
        intent: "RULE_QUERY",
        mood: "exploration",
        rule: "Grappling Escape",
        source: "companion_ptt",
        payload: {
          ruleTitle: "Grappling Escape",
          ruleId: "grapple_escape",
          summary: "Contested Athletics vs Athletics or Acrobatics.",
          ruling: "Target uses an action to break free with contest check.",
          citations: ["PHB p. 195"],
          ruleConfidence: "exact",
          confidence: 1.0
        }
      });

      client.destroy();
    });

    it("hydrates #gm-roster-list with default party characters when LiveTabletopClient is unavailable", () => {
      const gmHarness = setupClientHarness({
        viewMode: "gm",
        disableLiveTabletopClient: true
      });

      gmHarness.initGmRoster();

      const rosterList = document.getElementById("gm-roster-list")!;
      expect(rosterList.textContent).not.toContain("Loading roster...");
      ["Pog", "Vaelor", "Orca", "Fade", "Guest"].forEach((name) => {
        expect(rosterList.textContent).toContain(name);
      });
      expect(rosterList.textContent).toContain("Unclaimed");
    });
  });

  describe("Capability-Gated Browser Bundle & Runtime Firebase Config Guard (Ticket #54)", () => {
    it("isFirebaseConfigured returns false when SOF_FIREBASE_CONFIG is absent, empty, or placeholder", () => {
      const harness = setupClientHarness();
      const isFirebaseConfigured = harness.isFirebaseConfigured;
      expect(isFirebaseConfigured).toBeDefined();

      delete (window as any).SOF_FIREBASE_CONFIG;
      expect(isFirebaseConfigured()).toBe(false);

      (window as any).SOF_FIREBASE_CONFIG = null;
      expect(isFirebaseConfigured()).toBe(false);

      (window as any).SOF_FIREBASE_CONFIG = {};
      expect(isFirebaseConfigured()).toBe(false);

      (window as any).SOF_FIREBASE_CONFIG = {
        apiKey: "",
        projectId: "sof-test"
      };
      expect(isFirebaseConfigured()).toBe(false);

      (window as any).SOF_FIREBASE_CONFIG = {
        apiKey: "   ",
        projectId: "sof-test"
      };
      expect(isFirebaseConfigured()).toBe(false);

      (window as any).SOF_FIREBASE_CONFIG = {
        apiKey: "demo-api-key",
        projectId: "sof-test"
      };
      expect(isFirebaseConfigured()).toBe(false);

      (window as any).SOF_FIREBASE_CONFIG = {
        apiKey: "AIzaSyValidKey123",
        projectId: ""
      };
      expect(isFirebaseConfigured()).toBe(false);

      (window as any).SOF_FIREBASE_CONFIG = {
        apiKey: "AIzaSyValidKey123",
        projectId: "   "
      };
      expect(isFirebaseConfigured()).toBe(false);
    });

    it("isFirebaseConfigured returns true when SOF_FIREBASE_CONFIG has valid apiKey and projectId", () => {
      const harness = setupClientHarness();
      (window as any).SOF_FIREBASE_CONFIG = {
        apiKey: "AIzaSyValidKey123",
        projectId: "sof-gm-screen",
        authDomain: "sof-gm-screen.firebaseapp.com",
        appId: "1:1234567890:web:abcdef"
      };

      expect(harness.isFirebaseConfigured()).toBe(true);
    });

    it("returns injected test doubles directly when available on window", () => {
      const mockLive = { testLiveDouble: true };
      const mockArbiter = { testArbiterDouble: true };

      const harness = setupClientHarness();
      (window as any).liveTabletopClient = mockLive;
      (window as any).rulesArbiterClient = mockArbiter;

      expect(harness.getOrCreateLiveTabletopClient()).toBe(mockLive);
      expect(harness.getLiveTabletopClient()).toBe(mockLive);
      expect(harness.getOrCreateRulesArbiterClient()).toBe(mockArbiter);
    });

    it("does not instantiate live clients and returns null when unconfigured without test doubles", () => {
      const harness = setupClientHarness();
      delete (window as any).liveTabletopClient;
      delete (window as any).rulesArbiterClient;
      delete (window as any).SOF_FIREBASE_CONFIG;

      const liveConstructorSpy = vi.fn();
      const arbiterConstructorSpy = vi.fn();
      (window as any).LiveTabletopClient = liveConstructorSpy;
      (window as any).RulesArbiterClient = arbiterConstructorSpy;

      expect(harness.getOrCreateLiveTabletopClient()).toBeNull();
      expect(harness.getLiveTabletopClient()).toBeNull();
      expect(harness.getOrCreateRulesArbiterClient()).toBeNull();

      expect(liveConstructorSpy).not.toHaveBeenCalled();
      expect(arbiterConstructorSpy).not.toHaveBeenCalled();

      // Placeholder apiKey explicitly rejected
      (window as any).SOF_FIREBASE_CONFIG = {
        apiKey: "demo-api-key",
        projectId: "sof-gm-screen"
      };

      expect(harness.getOrCreateLiveTabletopClient()).toBeNull();
      expect(harness.getLiveTabletopClient()).toBeNull();
      expect(harness.getOrCreateRulesArbiterClient()).toBeNull();

      expect(liveConstructorSpy).not.toHaveBeenCalled();
      expect(arbiterConstructorSpy).not.toHaveBeenCalled();
    });

    it("instantiates live clients with SOF_FIREBASE_CONFIG and consolidates singletons when configured", () => {
      const harness = setupClientHarness();
      delete (window as any).liveTabletopClient;
      delete (window as any).rulesArbiterClient;

      const validConfig = {
        apiKey: "AIzaSyLiveSecret999",
        projectId: "sof-production-live",
        authDomain: "sof-production-live.firebaseapp.com"
      };
      (window as any).SOF_FIREBASE_CONFIG = validConfig;

      const mockLiveInstance = { id: "live-inst-1" };
      const liveConstructorSpy = vi.fn().mockImplementation(function () {
        return mockLiveInstance;
      });
      const mockArbiterInstance = { id: "arbiter-inst-1" };
      const arbiterConstructorSpy = vi.fn().mockImplementation(function () {
        return mockArbiterInstance;
      });

      (window as any).LiveTabletopClient = liveConstructorSpy;
      (window as any).RulesArbiterClient = arbiterConstructorSpy;

      const client1 = harness.getOrCreateLiveTabletopClient();
      expect(client1).toBe(mockLiveInstance);
      expect(liveConstructorSpy).toHaveBeenCalledTimes(1);
      expect(liveConstructorSpy).toHaveBeenCalledWith({
        firebaseConfig: validConfig
      });

      // Consolidated getter shares singleton and does not re-instantiate
      const client2 = harness.getLiveTabletopClient();
      expect(client2).toBe(mockLiveInstance);
      expect(liveConstructorSpy).toHaveBeenCalledTimes(1);

      const arbiterClient = harness.getOrCreateRulesArbiterClient();
      expect(arbiterClient).toBe(mockArbiterInstance);
      expect(arbiterConstructorSpy).toHaveBeenCalledTimes(1);
      expect(arbiterConstructorSpy).toHaveBeenCalledWith({
        firebaseConfig: validConfig
      });
    });
  });

  describe("Progressive Fallback Hardening for Character Roster Claiming & GM Party Roster Seeding (Ticket #55)", () => {
    describe("Character Claiming & Switching Fallbacks", () => {
      it("falls back to selectPlayerIdentity without race-loss shake when claimCharacter returns code: ERROR", async () => {
        const harness = setupClientHarness({ viewMode: "companion" });
        const liveClient = harness.liveTabletopClient as any;
        liveClient.claimCharacter = vi.fn().mockResolvedValue({
          success: false,
          code: "ERROR",
          error: "Permission denied or network offline"
        });

        harness.executeCharacterClaim("pog", "Pog");
        await Promise.resolve();
        await Promise.resolve();

        const card = document.querySelector('[data-character-id="pog"]');
        expect(card?.classList.contains("contested")).toBe(false);

        expect(localStorage.getItem("sof_player_identity")).toBe("Pog");
        const playerTag = document.getElementById("player-tag");
        expect(playerTag?.textContent).toContain("Pog");
      });

      it("falls back to selectPlayerIdentity without race-loss shake when claimCharacter rejects", async () => {
        const harness = setupClientHarness({ viewMode: "companion" });
        const liveClient = harness.liveTabletopClient as any;
        liveClient.claimCharacter = vi
          .fn()
          .mockRejectedValue(new Error("Firestore unavailable"));

        harness.executeCharacterClaim("vaelor", "Vaelor");
        await Promise.resolve();
        await Promise.resolve();

        const card = document.querySelector('[data-character-id="vaelor"]');
        expect(card?.classList.contains("contested")).toBe(false);

        expect(localStorage.getItem("sof_player_identity")).toBe("Vaelor");
        const playerTag = document.getElementById("player-tag");
        expect(playerTag?.textContent).toContain("Vaelor");
      });

      it("triggers race-loss shake and rejection message when claimCharacter returns code: ALREADY_CLAIMED", async () => {
        const harness = setupClientHarness({ viewMode: "companion" });
        const liveClient = harness.liveTabletopClient as any;
        liveClient.claimCharacter = vi.fn().mockResolvedValue({
          success: false,
          code: "ALREADY_CLAIMED"
        });

        harness.executeCharacterClaim("orca", "Orca");
        await Promise.resolve();
        await Promise.resolve();

        const card = document.querySelector('[data-character-id="orca"]');
        expect(card?.classList.contains("contested")).toBe(true);

        const toast = document.querySelector(".toast-msg");
        expect(toast?.textContent).toContain(
          "Orca has just been claimed by another player."
        );
      });

      it("falls back to selectPlayerIdentity when switchCharacter returns code: ERROR or rejects", async () => {
        const harness = setupClientHarness({
          viewMode: "companion",
          initialLocalStorage: {
            sof_claimed_character_2026_10_31: "pog",
            sof_player_identity: "Pog"
          }
        });

        (window as any).currentClaimedCharacterId = "pog";
        (window as any).currentPlayerIdentity = "Pog";

        const liveClient = harness.liveTabletopClient as any;
        liveClient.switchCharacter = vi.fn().mockResolvedValue({
          success: false,
          code: "ERROR",
          error: "Simulated switch error"
        });

        harness.handleCharacterCardClick("Fade", "fade");
        harness.confirmSwitchCharacter();
        await Promise.resolve();
        await Promise.resolve();

        const card = document.querySelector('[data-character-id="fade"]');
        expect(card?.classList.contains("contested")).toBe(false);

        expect(localStorage.getItem("sof_player_identity")).toBe("Fade");
      });
    });

    describe("GM Party Roster Baseline Preservation & Listener Lifecycle", () => {
      it("renders the 5 canonical party members as Unclaimed on init before snapshot arrival", () => {
        const harness = setupClientHarness({ viewMode: "gm" });
        harness.initGmRoster();

        const rosterList = document.getElementById("gm-roster-list")!;
        ["Pog", "Vaelor", "Orca", "Fade", "Guest"].forEach((name) => {
          expect(rosterList.textContent).toContain(name);
        });
        expect(rosterList.textContent).not.toContain(
          "No characters in roster."
        );
      });

      it("retains the 5 canonical party members as Unclaimed when subscribeRoster emits empty array []", () => {
        let snapshotCallback: ((roster: any[]) => void) | null = null;
        const mockUnsubscribe = vi.fn();
        const mockLiveClient = {
          subscribeToRoster: vi
            .fn()
            .mockImplementation((_date: string, cb: any) => {
              snapshotCallback = cb;
              return mockUnsubscribe;
            })
        };

        const harness = setupClientHarness({
          viewMode: "gm",
          liveTabletopClient: mockLiveClient as any
        });

        harness.initGmRoster();

        expect(snapshotCallback).not.toBeNull();
        snapshotCallback!([]);

        const rosterList = document.getElementById("gm-roster-list")!;
        expect(rosterList.textContent).not.toContain(
          "No characters in roster."
        );
        ["Pog", "Vaelor", "Orca", "Fade", "Guest"].forEach((name) => {
          expect(rosterList.textContent).toContain(name);
        });
      });

      it("merges partial snapshots preserving remaining canonical party members as Unclaimed", () => {
        let snapshotCallback: ((roster: any[]) => void) | null = null;
        const mockLiveClient = {
          subscribeToRoster: vi
            .fn()
            .mockImplementation((_date: string, cb: any) => {
              snapshotCallback = cb;
              return vi.fn();
            })
        };

        const harness = setupClientHarness({
          viewMode: "gm",
          liveTabletopClient: mockLiveClient as any
        });

        harness.initGmRoster();

        snapshotCallback!([
          { characterId: "pog", name: "Pog", claimedBy: "player_pog_uid" }
        ]);

        const rosterList = document.getElementById("gm-roster-list")!;
        expect(rosterList.textContent).toContain("Pog");
        expect(rosterList.textContent).toContain("Claimed (player_p...");

        ["Vaelor", "Orca", "Fade", "Guest"].forEach((name) => {
          expect(rosterList.textContent).toContain(name);
        });
      });

      it("unsubscribes prior gmRoster listener on re-invocation", () => {
        const mockUnsubscribe = vi.fn();
        const mockLiveClient = {
          subscribeToRoster: vi.fn().mockReturnValue(mockUnsubscribe)
        };

        const harness = setupClientHarness({
          viewMode: "gm",
          liveTabletopClient: mockLiveClient as any
        });

        harness.initGmRoster();
        expect(mockLiveClient.subscribeToRoster).toHaveBeenCalledTimes(1);
        expect(mockUnsubscribe).not.toHaveBeenCalled();

        harness.initGmRoster();
        expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
        expect(mockLiveClient.subscribeToRoster).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("Deferred Audio Cue Polling Suppression & Snapshot Confirmation (Ticket #56)", () => {
    it("defers setting isFirestoreLive to true until the first snapshot arrives from Firestore", () => {
      const mockClient = new MockLiveTabletopClient();
      const harness = setupClientHarness({
        liveTabletopClient: mockClient as any
      });

      harness.initLiveAudioCueSubscription("2026-10-31");
      // Pre-condition: listener attached but no snapshot delivered yet
      expect(mockClient.cueListeners).toHaveLength(1);
      expect(harness.isFirestoreLive()).toBe(false);

      // 4-second HTTP polling continues
      harness.pollLatestAudioCue();
      expect(harness.getLatestAudioCueSpy).toHaveBeenCalledTimes(1);
      harness.getLatestAudioCueSpy.mockClear();

      // First snapshot arrives (even if null / empty doc)
      mockClient.emitCue(null);
      expect(harness.isFirestoreLive()).toBe(true);

      // Polling is now suppressed
      harness.pollLatestAudioCue();
      expect(harness.getLatestAudioCueSpy).not.toHaveBeenCalled();
    });

    it("keeps polling active if subscription immediately reports an error or disconnects", () => {
      const mockClient = new MockLiveTabletopClient();
      const harness = setupClientHarness({
        liveTabletopClient: mockClient as any
      });

      harness.initLiveAudioCueSubscription("2026-10-31");
      expect(harness.isFirestoreLive()).toBe(false);

      // Error occurs before any snapshot
      mockClient.emitError(new Error("Permission denied or offline"));
      expect(harness.isFirestoreLive()).toBe(false);

      harness.pollLatestAudioCue();
      expect(harness.getLatestAudioCueSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Test Harness Mock RPC Completion Defaults (Ticket #57)", () => {
    it("getRulesGlossary invokes success handler with null when options.rulesGlossary is omitted", () => {
      setupClientHarness();
      const onSuccess = vi.fn();

      (window as any).google.script.run
        .withSuccessHandler(onSuccess)
        .getRulesGlossary("2026-10-31");

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(null);
    });

    it("getFilePayload invokes failure handler when fileId is absent from filePayloads", () => {
      setupClientHarness({ filePayloads: {} });
      const onSuccess = vi.fn();
      const onFailure = vi.fn();

      (window as any).google.script.run
        .withSuccessHandler(onSuccess)
        .withFailureHandler(onFailure)
        .getFilePayload("missing_asset_id", "2026-10-31");

      expect(onSuccess).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith({
        message: "Missing mock payload for missing_asset_id"
      });
    });
  });
});
