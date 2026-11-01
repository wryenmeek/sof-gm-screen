// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import { marked } from "marked";

describe("Client-Side Logic (Index.html)", () => {
  let parseCustomMarkdown: (content: string) => string;
  let prepareHtmlSrcdoc: (htmlContent: string) => string;
  let createDrivePreviewIframe: (
    srcUrl: string,
    height?: string
  ) => HTMLIFrameElement;

  beforeEach(() => {
    (window as any).marked = marked;
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
      "google",
      cleanScript +
        `
      return {
        parseCustomMarkdown,
        prepareHtmlSrcdoc,
        createDrivePreviewIframe
      };
    `
    );
    const funcs = fn(window, document, marked, (window as any).google);
    parseCustomMarkdown = funcs.parseCustomMarkdown;
    prepareHtmlSrcdoc = funcs.prepareHtmlSrcdoc;
    createDrivePreviewIframe = funcs.createDrivePreviewIframe;
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
