// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupClientHarness } from "./helpers/client-harness";
import {
  projectCombatPublic,
  calculateStatusBand,
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
  });
});
