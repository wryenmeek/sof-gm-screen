import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import vm from "vm";
import { setupGoogleAppsScriptMocks } from "./mocks/google-apps-script";

describe("Apps Script Server Logic (Code.gs)", () => {
  let ctx: Record<string, any>;
  let mocks: ReturnType<typeof setupGoogleAppsScriptMocks>;

  beforeEach(() => {
    mocks = setupGoogleAppsScriptMocks([
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
        content:
          "# Session Notes\n\n- Initiative: Bard 18, Rogue 14\n- Promise: Pog crafting Cloak of the Manta Ray (8 days)",
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
      SpreadsheetApp: (globalThis as any).SpreadsheetApp,
      CalendarApp: (globalThis as any).CalendarApp,
      Tasks: (globalThis as any).Tasks,
      Set,
      Map,
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

  describe("Ticket 06: Digital Sidecar Audio Logger (saveAudioTimeline)", () => {
    it("creates and appends non-duplicate timeline events to session_audio_timeline.json", () => {
      const saveAudioTimeline = ctx.saveAudioTimeline;
      const firstBatch = JSON.stringify([
        {
          timestamp: 1000,
          track: "Age_of_Sail.mp3",
          channel: 1,
          eventType: "LOOP",
          gain: 0.2
        }
      ]);
      const res1 = saveAudioTimeline("2026-10-31", firstBatch);
      expect(res1.count).toBe(1);

      const secondBatch = JSON.stringify([
        {
          timestamp: 1000,
          track: "Age_of_Sail.mp3",
          channel: 1,
          eventType: "LOOP",
          gain: 0.2
        },
        {
          timestamp: 2500,
          track: "cannon.mp3",
          channel: 3,
          eventType: "SFX",
          gain: 1.0
        }
      ]);
      const res2 = saveAudioTimeline("2026-10-31", secondBatch);
      expect(res2.count).toBe(2);
    });
  });

  describe("Ticket 08: Crowdsourced Rule Feedback Logger (logRuleFeedback)", () => {
    it("appends player vote row to Rules_Helper_Feedback sheet when configured", () => {
      mocks.propsStore.set("SOF_FEEDBACK_SHEET_ID", "sheet_123");
      const res = ctx.logRuleFeedback({
        player: "Vaelor",
        phrase: "concentration dc",
        cardTitle: "Concentration",
        vote: "+1"
      });
      expect(res.status).toBe("logged");
      expect(mocks.sheetRows.length).toBe(1);
      expect(mocks.sheetRows[0]).toContain("Vaelor");
      expect(mocks.sheetRows[0]).toContain("Concentration");
    });
  });

  describe("Ticket 09: 72-Hour Calendar Attendance Quorum Auditor (auditCalendarQuorum)", () => {
    it("shifts event forward 14 days when fewer than 3 guests confirm YES", () => {
      const start = new Date("2026-11-14T17:00:00Z");
      const end = new Date("2026-11-14T21:30:00Z");
      let currentStart = start;
      let desc = "";

      mocks.mockEvents.set("evt_under_quorum", {
        getGuestList: () => [
          { getGuestStatus: () => "YES" },
          { getGuestStatus: () => "YES" },
          { getGuestStatus: () => "NO" },
          { getGuestStatus: () => "MAYBE" }
        ],
        getStartTime: () => currentStart,
        getEndTime: () => end,
        setTime: (newStart: Date, _newEnd: Date) => {
          currentStart = newStart;
        },
        setDescription: (newDesc: string) => {
          desc = newDesc;
        }
      });

      const res = ctx.auditCalendarQuorum("evt_under_quorum");
      expect(res.quorumMet).toBe(false);
      expect(res.confirmedCount).toBe(2);
      expect(currentStart.toISOString()).toBe("2026-11-28T17:00:00.000Z");
      expect(desc).toContain("RESCHEDULED");
    });

    it("injects Harptos date and weather when 3 or more guests confirm YES", () => {
      let desc = "";
      mocks.mockEvents.set("evt_quorum_met", {
        getGuestList: () => [
          { getGuestStatus: () => "YES" },
          { getGuestStatus: () => "YES" },
          { getGuestStatus: () => "YES" }
        ],
        getStartTime: () => new Date("2026-11-14T17:00:00Z"),
        getEndTime: () => new Date("2026-11-14T21:30:00Z"),
        setTime: () => {},
        setDescription: (newDesc: string) => {
          desc = newDesc;
        }
      });

      const res = ctx.auditCalendarQuorum("evt_quorum_met", {
        harptosDate: "15 Tarsakh, 1494 DR",
        planarAlignment: "Elemental Water Waxing",
        weather: "Heavy monsoon squalls"
      });
      expect(res.quorumMet).toBe(true);
      expect(res.confirmedCount).toBe(3);
      expect(desc).toContain("15 Tarsakh, 1494 DR");
      expect(desc).toContain("Heavy monsoon squalls");
    });
  });

  describe("Ticket 10: Gemini Post-Session Promise Extractor (extractNarrativePromises)", () => {
    it("parses structured JSON tasks from Gemini and inserts non-duplicates into Google Tasks", () => {
      mocks.UrlFetchApp.fetch.mockReturnValueOnce({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        tasks: [
                          {
                            title: "Complete Pog Cloak of the Manta Ray",
                            notes: "8 downtime days elapsed",
                            category: "Crafting"
                          },
                          {
                            title: "Stat out Cowled Wizard Recon Squad",
                            notes: "Promised underwater undead intel",
                            category: "Prep"
                          }
                        ]
                      })
                    }
                  ]
                }
              }
            ]
          })
      });

      const res1 = ctx.extractNarrativePromises("2026-10-31", "@default");
      expect(res1.extractedCount).toBe(2);
      expect(res1.createdCount).toBe(2);
      expect(mocks.taskStore.length).toBe(2);

      // Re-running with same tasks must skip duplicates
      mocks.UrlFetchApp.fetch.mockReturnValueOnce({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            tasks: [
              {
                title: "Complete Pog Cloak of the Manta Ray",
                notes: "8 downtime days elapsed",
                category: "Crafting"
              }
            ]
          })
      });
      const res2 = ctx.extractNarrativePromises("2026-10-31", "@default");
      expect(res2.createdCount).toBe(0);
      expect(mocks.taskStore.length).toBe(2);
    });
  });
});
