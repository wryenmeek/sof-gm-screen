// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import { marked } from "marked";
import MiniSearch from "minisearch";

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

  beforeEach(() => {
    document.body.innerHTML = `
      <select id="session-select"></select>
      <input type="text" id="filter-input" value="" />
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
    `;

    (window as any).marked = marked;
    (window as any).MiniSearch = MiniSearch;
    (window as any).google = {
      script: {
        run: {
          withSuccessHandler: () => ({
            getScratchpadNotes: vi.fn(),
            saveScratchpadNotes: vi.fn(),
            getSessionList: vi.fn(),
            getSessionManifest: vi.fn(),
            getFilePayload: vi.fn()
          })
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
        parseCustomMarkdown,
        prepareHtmlSrcdoc,
        createDrivePreviewIframe,
        renderManifest,
        filterFiles,
        tokenizeStatblockAndDossier: typeof tokenizeStatblockAndDossier !== "undefined" ? tokenizeStatblockAndDossier : undefined,
        indexFilePayload: typeof indexFilePayload !== "undefined" ? indexFilePayload : undefined
      };
    `
    );
    const funcs = fn(
      window,
      document,
      marked,
      MiniSearch,
      (window as any).google
    );
    parseCustomMarkdown = funcs.parseCustomMarkdown;
    prepareHtmlSrcdoc = funcs.prepareHtmlSrcdoc;
    createDrivePreviewIframe = funcs.createDrivePreviewIframe;
    renderManifest = funcs.renderManifest;
    filterFiles = funcs.filterFiles;
    tokenizeStatblockAndDossier = funcs.tokenizeStatblockAndDossier;
    indexFilePayload = funcs.indexFilePayload;
  });

  describe("MiniSearch Manifest Indexing (Ticket 01)", () => {
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
      filterFiles("monsters serpent");
      expect(list.children.length).toBe(1);
      expect(list.textContent).toContain("Muttering_Serpent_Statblock.md");

      // Clearing query restores full alphabetical manifest
      filterFiles("");
      expect(list.children.length).toBe(3);
    });
  });

  describe("5e Statblock & Dossier Multi-Field Tokenizer (Ticket 02)", () => {
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

    const golemMarkdown = `
{monster,frame,wide
## Singing Golem
*Large construct, unaligned*
**Armor Class** :: 18 (natural armor)
**Hit Points** :: 142 (15d10 + 60)
**Speed** :: 30 ft.
**Damage Vulnerabilities** :: thunder, radiant
**Damage Immunities** :: poison, psychic
**Condition Immunities** :: charmed, exhaustion, frightened
### Actions
**Harmonic Slam.** Melee Weapon Attack: +9 to hit.
**Legendary Resistance (3/Day).** If the golem fails a saving throw, it can choose to succeed instead.
}
    `;

    it("extracts title, tags, 5e mechanical properties, and content from Homebrewery statblocks", () => {
      expect(tokenizeStatblockAndDossier).toBeDefined();
      const doc = tokenizeStatblockAndDossier(sampleManifest[0], golemMarkdown);
      expect(doc.title).toContain("Singing Golem");
      expect(doc.tags).toContain("3. Monsters");
      expect(doc.properties).toContain("Armor Class 18");
      expect(doc.properties).toContain(
        "Damage Vulnerabilities thunder, radiant"
      );
      expect(doc.content).toContain("Legendary Resistance");
    });

    it("updates the MiniSearch index when a file payload is loaded so mechanics queries match the statblock", () => {
      renderManifest(sampleManifest);
      expect(indexFilePayload).toBeDefined();

      indexFilePayload({
        id: "m1",
        name: "[3. Monsters] Singing_Golem_Statblock.md",
        type: "markdown",
        content: golemMarkdown
      });

      const list = document.getElementById("file-list")!;
      filterFiles("radiant vulnerability");
      expect(list.children.length).toBe(1);
      expect(list.textContent).toContain("Singing_Golem_Statblock.md");

      filterFiles("legendary resistance");
      expect(list.children.length).toBe(1);
      expect(list.textContent).toContain("Singing_Golem_Statblock.md");
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
});
