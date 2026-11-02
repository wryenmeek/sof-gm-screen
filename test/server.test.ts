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
      HtmlService: (globalThis as any).HtmlService,
      Logger: (globalThis as any).Logger,
      CacheService: (globalThis as any).CacheService,
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
      Error,
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

  describe("Ticket 08 & 23: Google Drive Glossary Loader & Rule Feedback Logger", () => {
    it("loads and parses markdown/JSON Drive glossaries and merges the core 5e SRD starter glossary without requiring GM access", () => {
      mocks.propsStore.set("SOF_GM_KEY", "gm-secret-only");
      mocks.fileStore.set("glossary_md_1", {
        id: "glossary_md_1",
        name: "dnd-rules-transcription-glossary.md",
        mimeType: "text/markdown",
        size: 200,
        content:
          "## Divine Smite\nWhen you hit a creature with a melee weapon attack, expend one spell slot to deal 2d8 radiant damage.\n\n- **exhaustion**: Measured in 6 levels; level 1 gives disadvantage on ability checks.",
        updated: new Date("2026-10-31")
      });
      mocks.fileStore.set("glossary_json_1", {
        id: "glossary_json_1",
        name: "5e-SRD-Rules.json",
        mimeType: "application/json",
        size: 180,
        content: JSON.stringify([
          {
            id: "srd_counterspell",
            title: "Counterspell",
            source: "5e-SRD-Rules.json",
            summary:
              "3rd-level abjuration reaction (60 ft): interrupt a creature casting a spell of 3rd level or lower.",
            tags: "spell reaction abjuration"
          }
        ]),
        updated: new Date("2026-10-31")
      });

      const entries = ctx.getRulesGlossary("2026-10-31");
      expect(Array.isArray(entries)).toBe(true);
      const titles = entries.map((e: any) => e.title);
      expect(titles).toContain("Misty Step");
      expect(titles).toContain("Grappling");
      expect(titles).toContain("Sneak Attack");
      expect(titles).toContain("Shield");
      expect(titles).toContain("Concentration");
      expect(titles).toContain("Divine Smite");
      expect(titles).toContain("exhaustion");
      expect(titles).toContain("Counterspell");

      const smite = entries.find((e: any) => e.title === "Divine Smite");
      expect(smite.source).toBe("dnd-rules-transcription-glossary.md");
      expect(smite.summary).toContain("2d8 radiant damage");
    });

    it("appends [timestamp, sessionDate, player, phrase, cardTitle, vote] to Rules_Helper_Feedback sheet when configured", () => {
      mocks.propsStore.set("SOF_FEEDBACK_SHEET_ID", "sheet_123");
      const res = ctx.logRuleFeedback({
        sessionDate: "2026-10-31",
        player: "Vaelor",
        phrase: "concentration dc",
        cardTitle: "Concentration",
        vote: "+1"
      });
      expect(res.status).toBe("logged");
      expect(mocks.sheetRows.length).toBe(1);
      expect(mocks.sheetRows[0][1]).toBe("2026-10-31");
      expect(mocks.sheetRows[0][2]).toBe("Vaelor");
      expect(mocks.sheetRows[0][3]).toBe("concentration dc");
      expect(mocks.sheetRows[0][4]).toBe("Concentration");
      expect(mocks.sheetRows[0][5]).toBe("+1");
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

    it("installs Wednesday 12:00 PM trigger idempotently via installGovernanceTriggers()", () => {
      const first = ctx.installGovernanceTriggers();
      expect(first).toEqual({ installed: true });
      expect(mocks.triggers.length).toBe(1);
      expect(mocks.triggers[0]).toEqual({
        handlerFunction: "auditCalendarQuorum",
        weekDay: "WEDNESDAY",
        hour: 12
      });

      const second = ctx.installGovernanceTriggers();
      expect(second).toEqual({ installed: false });
      expect(mocks.triggers.length).toBe(1);
    });

    it("matches 'Dnd' title and returns SKIPPED_NO_GUESTS with Logger warning when 0 guests are invited", () => {
      let shifted = false;
      mocks.mockEvents.set("evt_zero_guests", {
        getTitle: () => "Dnd",
        getGuestList: () => [],
        getStartTime: () => new Date("2026-11-14T17:00:00Z"),
        getEndTime: () => new Date("2026-11-14T21:30:00Z"),
        setTime: () => {
          shifted = true;
        },
        setDescription: () => {}
      });

      const res = ctx.auditCalendarQuorum("2026-11-14");
      expect(res.status).toBe("SKIPPED_NO_GUESTS");
      expect(res.confirmed).toBe(0);
      expect(shifted).toBe(false);
      expect(mocks.logs).toContain(
        "Skipping quorum cancellation: 0 guests invited on event"
      );
    });

    it("reschedules +14 days when a storyline-locked player in SOF_LOCKED_PLAYERS responds NO even with 3 YES", () => {
      mocks.propsStore.set("SOF_LOCKED_PLAYERS", "vaelor@example.com,pog");
      const start = new Date("2026-11-14T17:00:00Z");
      const end = new Date("2026-11-14T21:30:00Z");
      let currentStart = start;

      mocks.mockEvents.set("evt_locked_no", {
        getTitle: () => "Dnd - Session 12",
        getGuestList: () => [
          { getGuestStatus: () => "YES", getEmail: () => "orca@example.com" },
          { getGuestStatus: () => "YES", getEmail: () => "fade@example.com" },
          { getGuestStatus: () => "YES", getEmail: () => "guest@example.com" },
          { getGuestStatus: () => "NO", getEmail: () => "vaelor@example.com" }
        ],
        getStartTime: () => currentStart,
        getEndTime: () => end,
        setTime: (newStart: Date, _newEnd: Date) => {
          currentStart = newStart;
        },
        setDescription: () => {}
      });

      const res = ctx.auditCalendarQuorum("2026-11-14");
      expect(res.status).toBe("RESCHEDULED");
      expect(currentStart.toISOString()).toBe("2026-11-28T17:00:00.000Z");
    });

    it("rolls 2d8 Weather Hexflower and injects SOF_INGAME_DATE when quorum is met", () => {
      mocks.propsStore.set(
        "SOF_INGAME_DATE",
        "Day 19 on Hot Springs Island — Waxing Moon"
      );
      let desc = "";
      mocks.mockEvents.set("evt_hexflower", {
        getTitle: () => "Sea of Fortune",
        getGuestList: () => [
          { getGuestStatus: () => "YES", getEmail: () => "p1@example.com" },
          { getGuestStatus: () => "YES", getEmail: () => "p2@example.com" },
          { getGuestStatus: () => "YES", getEmail: () => "p3@example.com" }
        ],
        getStartTime: () => new Date("2026-11-14T17:00:00Z"),
        getEndTime: () => new Date("2026-11-14T21:30:00Z"),
        setTime: () => {},
        setDescription: (newDesc: string) => {
          desc = newDesc;
        }
      });

      const res = ctx.auditCalendarQuorum("2026-11-14");
      expect(res.status).toBe("QUORUM_MET");
      expect(res.confirmed).toBe(3);
      expect(res.inGameDate).toBe("Day 19 on Hot Springs Island — Waxing Moon");
      expect(res.weather).toBeDefined();
      expect(res.weather.roll).toBeGreaterThanOrEqual(2);
      expect(res.weather.roll).toBeLessThanOrEqual(16);
      expect(desc).toContain("Day 19 on Hot Springs Island — Waxing Moon");
      expect(desc).toContain("2d8");
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
                title: "complete pog cloak of the manta ray",
                notes: "8 downtime days elapsed",
                category: "Crafting"
              }
            ]
          })
      });
      const res2 = ctx.extractNarrativePromises("2026-10-31", "@default");
      expect(res2.createdCount).toBe(0);
      expect(mocks.taskStore.length).toBe(2);

      // Verify responseSchema in UrlFetchApp payload and Logger.log output
      const fetchCall = mocks.UrlFetchApp.fetch.mock.calls[0];
      const sentPayload = JSON.parse(fetchCall[1].payload);
      expect(sentPayload.generationConfig.responseMimeType).toBe(
        "application/json"
      );
      expect(sentPayload.generationConfig.responseSchema).toBeDefined();
      expect(sentPayload.generationConfig.responseSchema.type).toBe("OBJECT");
      expect(
        sentPayload.generationConfig.responseSchema.properties.tasks.type
      ).toBe("ARRAY");
      expect(mocks.logs).toContain(
        "Created Task [task_1]: Complete Pog Cloak of the Manta Ray"
      );
    });
  });

  describe("Ticket 15: Server-Side GM Access Guard (assertGmAccess_)", () => {
    it("allows calls when SOF_GM_KEY is unset (open single-user mode)", () => {
      expect(ctx.assertGmAccess_).toBeDefined();
      expect(() => ctx.assertGmAccess_()).not.toThrow();
      expect(() => ctx.assertGmAccess_("any_key")).not.toThrow();
    });

    it("throws 'Unauthorized GM RPC' when SOF_GM_KEY is set and gmKey is missing or mismatched, and succeeds on exact match", () => {
      mocks.propsStore.set("SOF_GM_KEY", "secret-gm-token-99");
      expect(ctx.assertGmAccess_).toBeDefined();

      expect(() => ctx.assertGmAccess_()).toThrow("Unauthorized GM RPC");
      expect(() => ctx.assertGmAccess_("wrong-token")).toThrow(
        "Unauthorized GM RPC"
      );
      expect(() => ctx.assertGmAccess_("secret-gm-token-99")).not.toThrow();
    });
  });

  describe("Ticket 19 & 22: doGet View Isolation & getAudioAuthToken", () => {
    it("sets template.viewMode to 'companion' when ?view=companion is passed and 'gm' otherwise", () => {
      const gmOut = ctx.doGet({ parameter: { session: "2026-11-14" } });
      expect(gmOut.template.sessionDate).toBe("2026-11-14");
      expect(gmOut.template.viewMode).toBe("gm");

      const compOut = ctx.doGet({
        parameter: { session: "2026-11-14", view: "companion" }
      });
      expect(compOut.template.sessionDate).toBe("2026-11-14");
      expect(compOut.template.viewMode).toBe("companion");
    });

    it("guards getAudioAuthToken with assertGmAccess_ and returns ScriptApp.getOAuthToken()", () => {
      mocks.propsStore.set("SOF_GM_KEY", "gm-secret-77");
      expect(() => ctx.getAudioAuthToken("wrong")).toThrow(
        "Unauthorized GM RPC"
      );
      expect(ctx.getAudioAuthToken("gm-secret-77")).toBe("mock_oauth_token");
    });
  });

  describe("Ticket 26: doPost(e) & getLatestAudioCue(gmKey) CacheService Cue Bridge", () => {
    it("caches non-BANTER cues in CacheService for 60s, ignores BANTER, and guards with assertGmAccess_", () => {
      mocks.propsStore.set("SOF_GM_KEY", "pi-edge-key");

      expect(ctx.getLatestAudioCue("pi-edge-key")).toBeNull();
      expect(() => ctx.getLatestAudioCue("bad-key")).toThrow(
        "Unauthorized GM RPC"
      );

      expect(() =>
        ctx.doPost({
          postData: {
            contents: JSON.stringify({
              gmKey: "bad-key",
              intent: "MUSIC_CUE",
              mood: "combat"
            })
          }
        })
      ).toThrow("Unauthorized GM RPC");

      const banterRes = ctx.doPost({
        postData: {
          contents: JSON.stringify({
            gmKey: "pi-edge-key",
            intent: "BANTER",
            timestamp: 100
          })
        }
      });
      expect(banterRes.cached).toBe(false);
      expect(ctx.getLatestAudioCue("pi-edge-key")).toBeNull();

      const cueRes = ctx.doPost({
        postData: {
          contents: JSON.stringify({
            gmKey: "pi-edge-key",
            intent: "MUSIC_CUE",
            mood: "combat",
            rule: null,
            tier: "TIER_1_PI_LOCAL",
            timestamp: 1730500000123
          })
        }
      });
      expect(cueRes).toEqual({ status: "OK", cached: true });

      const latest = ctx.getLatestAudioCue("pi-edge-key");
      expect(latest).toEqual({
        intent: "MUSIC_CUE",
        mood: "combat",
        rule: null,
        tier: "TIER_1_PI_LOCAL",
        timestamp: 1730500000123
      });
    });
  });
});
