// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { setupClientHarness } from "./helpers/client-harness";

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
      const scratchpad = document.getElementById(
        "scratchpad"
      ) as HTMLTextAreaElement;

      // Pressing '/' while focused in textarea must NOT steal focus
      scratchpad.focus();
      expect(document.activeElement).toBe(scratchpad);
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "/", bubbles: true })
      );
      expect(document.activeElement).toBe(scratchpad);
      scratchpad.blur();

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
    it("renders #extract-promises-btn in Table Notes header, calls extractNarrativePromises(currentSessionDate), and updates #notes-status", () => {
      const harness = setupClientHarness({
        extractedPromisesResult: {
          sessionDate: "2026-10-31",
          extractedCount: 3,
          createdCount: 3,
          created: 3,
          tasks: [
            { id: "t1", title: "Promise A" },
            { id: "t2", title: "Promise B" },
            { id: "t3", title: "Promise C" }
          ]
        }
      });

      const btn = document.getElementById(
        "extract-promises-btn"
      ) as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toContain("✨ Extract Promises to Tasks");
      expect(harness.triggerPromiseExtraction).toBeDefined();

      harness.triggerPromiseExtraction();
      expect(harness.extractNarrativePromisesSpy).toHaveBeenCalledWith(
        "2026-10-31"
      );
      const statusEl =
        document.getElementById("notes-status") ||
        document.getElementById("save-status");
      expect(statusEl).not.toBeNull();
      expect(statusEl!.textContent).toContain("3");
    });
  });
});
