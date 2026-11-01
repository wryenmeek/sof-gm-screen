import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import vm from "vm";
import { setupGoogleAppsScriptMocks } from "./mocks/google-apps-script";

describe("Apps Script Server Logic (Code.gs)", () => {
  let ctx: Record<string, any>;

  beforeEach(() => {
    const mocks = setupGoogleAppsScriptMocks([
      {
        id: "img_floor_1",
        name: "floor_1_map.png",
        mimeType: "image/png",
        size: 5 * 1024 * 1024,
        content: "png_bytes",
        updated: new Date("2026-10-31")
      },
      {
        id: "audio_1",
        name: "session_audio.m4a",
        mimeType: "audio/x-m4a",
        size: 50 * 1024 * 1024,
        content: "audio_bytes",
        updated: new Date("2026-10-31")
      },
      {
        id: "notes_md",
        name: "table_notes.md",
        mimeType: "text/markdown",
        size: 120,
        content: "# Session Notes\n\n- Initiative: Bard 18, Rogue 14",
        updated: new Date("2026-10-31")
      }
    ]);

    ctx = vm.createContext({
      ...mocks,
      DriveApp: (globalThis as any).DriveApp,
      PropertiesService: (globalThis as any).PropertiesService,
      ScriptApp: (globalThis as any).ScriptApp,
      Utilities: (globalThis as any).Utilities,
      MimeType: (globalThis as any).MimeType,
      UrlFetchApp: (globalThis as any).UrlFetchApp,
      console,
      JSON,
      Date,
      Math,
      String,
      RegExp,
      Array,
      Object,
      encodeURIComponent,
      decodeURIComponent
    });

    const code = fs.readFileSync("Code.gs", "utf8");
    vm.runInContext(code, ctx);
  });

  it("constructs high-performance Google Edge CDN URLs without memory bloat", () => {
    const fn = ctx.getDriveCdnUrl_;
    expect(fn).toBeDefined();
    expect(fn("file_12345")).toBe(
      "https://lh3.googleusercontent.com/d/file_12345"
    );
  });

  it("returns image payload as direct Google Edge CDN URL", () => {
    const getFilePayload = ctx.getFilePayload;
    const payload = getFilePayload("img_floor_1", "2026-10-31");
    expect(payload.type).toBe("image");
    expect(payload.content).toBe(
      "https://lh3.googleusercontent.com/d/img_floor_1"
    );
    expect(payload.id).toBe("img_floor_1");
  });

  it("returns audio payload as streaming preview URL", () => {
    const getFilePayload = ctx.getFilePayload;
    const payload = getFilePayload("audio_1", "2026-10-31");
    expect(payload.type).toBe("audio");
    expect(payload.content).toBe(
      "https://drive.google.com/file/d/audio_1/preview"
    );
  });

  it("resolves relative images in Markdown to Google CDN URLs", () => {
    const resolveRelativeImages = ctx.resolveRelativeImages_;
    const md = "Here is the floor map: ![Floor 1](floor_1_map.png)";
    const resolved = resolveRelativeImages(md, "2026-10-31");
    expect(resolved).toBe(
      "Here is the floor map: ![Floor 1](https://lh3.googleusercontent.com/d/img_floor_1)"
    );
  });

  it("resolves relative images in HTML tags to Google CDN URLs", () => {
    const resolveRelativeImages = ctx.resolveRelativeImages_;
    const html = '<div class="handout"><img src="floor_1_map.png"></div>';
    const resolved = resolveRelativeImages(html, "2026-10-31");
    expect(resolved).toBe(
      '<div class="handout"><img src="https://lh3.googleusercontent.com/d/img_floor_1"></div>'
    );
  });

  it("reads and writes table notes scratchpad", () => {
    const getScratchpadNotes = ctx.getScratchpadNotes;
    const saveScratchpadNotes = ctx.saveScratchpadNotes;

    const initial = getScratchpadNotes("2026-10-31");
    expect(initial.content).toContain("Initiative: Bard 18");

    const saveRes = saveScratchpadNotes(
      "2026-10-31",
      "# Updated Notes\n\n- Loot: 500 gp"
    );
    expect(saveRes.id).toBe("notes_md");

    const updated = getScratchpadNotes("2026-10-31");
    expect(updated.content).toContain("Loot: 500 gp");
  });
});
