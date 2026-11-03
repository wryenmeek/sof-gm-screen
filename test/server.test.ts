import { describe, it, expect, beforeEach, vi } from "vitest";
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
    mocks.propsStore.set("SOF_GM_KEY", "test-gm-key");

    ctx = vm.createContext({
      ...mocks,
      DriveApp: (globalThis as any).DriveApp,
      PropertiesService: (globalThis as any).PropertiesService,
      ScriptApp: (globalThis as any).ScriptApp,
      LockService: (globalThis as any).LockService,
      HtmlService: (globalThis as any).HtmlService,
      ContentService: (globalThis as any).ContentService,
      Logger: (globalThis as any).Logger,
      CacheService: (globalThis as any).CacheService,
      Utilities: (globalThis as any).Utilities,
      MimeType: (globalThis as any).MimeType,
      UrlFetchApp: (globalThis as any).UrlFetchApp,
      SpreadsheetApp: (globalThis as any).SpreadsheetApp,
      CalendarApp: (globalThis as any).CalendarApp,
      Calendar: (globalThis as any).Calendar,
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
    const payload = getFilePayload("img_floor_1", "2026-10-31", "test-gm-key");
    expect(payload.type).toBe("image");
    expect(payload.content).toBe(
      "https://lh3.googleusercontent.com/d/img_floor_1"
    );
    expect(payload.id).toBe("img_floor_1");
  });

  it("returns audio payload as streaming preview URL", () => {
    const getFilePayload = ctx.getFilePayload;
    const payload = getFilePayload("audio_1", "2026-10-31", "test-gm-key");
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

    const initial = getScratchpadNotes("2026-10-31", "test-gm-key");
    expect(initial.content).toContain("Initiative: Bard 18");

    const saveRes = saveScratchpadNotes(
      "2026-10-31",
      "# Updated Notes\n\n- Loot: 500 gp",
      "test-gm-key"
    );
    expect(saveRes.id).toBe("notes_md");

    const updated = getScratchpadNotes("2026-10-31", "test-gm-key");
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
      const res1 = saveAudioTimeline("2026-10-31", firstBatch, "test-gm-key");
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
        },
        {
          timestamp: 2500,
          track: "cannon.mp3",
          channel: 3,
          eventType: "SFX",
          gain: 1.0
        }
      ]);
      const res2 = saveAudioTimeline("2026-10-31", secondBatch, "test-gm-key");
      expect(res2.count).toBe(2);
      expect(mocks.lockState.waits).toBe(2);
      expect(mocks.lockState.releases).toBe(2);
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

    it("appends [timestamp, sessionDate, player, phrase, cardTitle, vote] to Rules_Helper_Feedback sheet when configured, creating header row if sheet is missing", () => {
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
      expect(mocks.sheetRows[0][5]).toBe("'+1");

      // Simulate missing Rules_Helper_Feedback tab -> insertSheet + header row creation
      mocks.sheetRows.length = 0;
      mocks.SpreadsheetApp.openById.mockReturnValueOnce({
        getSheetByName: () => null,
        insertSheet: () => ({
          appendRow: (row: any[]) => mocks.sheetRows.push(row)
        })
      });
      ctx.logRuleFeedback({
        sessionDate: "2026-10-31",
        player: "Pog",
        phrase: "misty step",
        cardTitle: "Misty Step",
        vote: "+1"
      });
      expect(mocks.sheetRows.length).toBe(2);
      expect(mocks.sheetRows[0]).toEqual([
        "Timestamp ISO",
        "Session Date",
        "Player Identity",
        "Raw Query Phrase",
        "Matched Rule Title",
        "Vote"
      ]);
      expect(mocks.sheetRows[1][2]).toBe("Pog");

      ctx.logRuleFeedback({
        player: '=HYPERLINK("https://example.invalid","open")',
        phrase: '\t=IMPORTXML("https://example.invalid")',
        cardTitle: "@SUM(1,1)",
        vote: "-1"
      });
      const safeRow = mocks.sheetRows[2];
      expect(safeRow[2]).toBe('\'=HYPERLINK("https://example.invalid","open")');
      expect(safeRow[3]).toBe('\'\t=IMPORTXML("https://example.invalid")');
      expect(safeRow[4]).toBe("'@SUM(1,1)");
      expect(safeRow[5]).toBe("'-1");
    });

    it("bounds player feedback fields and limits each signed-in user to 20 votes per session", () => {
      mocks.propsStore.set("SOF_FEEDBACK_SHEET_ID", "sheet_123");
      mocks.setActiveUserEmail("player-one@example.test");
      const oversized = ctx.logRuleFeedback({
        sessionDate: "2026-10-31",
        player: "x".repeat(81),
        phrase: "concentration dc",
        cardTitle: "Concentration",
        vote: "+1"
      });
      expect(oversized.status).toBe("invalid");
      expect(mocks.sheetRows).toHaveLength(0);

      mocks.lockState.locked = true;
      expect(() =>
        ctx.logRuleFeedback({ sessionDate: "2026-10-31", vote: "+1" })
      ).toThrow("Lock is already held");
      mocks.lockState.locked = false;

      const submissions = Array.from({ length: 21 }, (_, index) =>
        ctx.logRuleFeedback({
          sessionDate: "2026-10-31",
          player: `Player ${index}`,
          phrase: "concentration dc",
          cardTitle: "Concentration",
          vote: "+1"
        })
      );
      expect(
        submissions.filter((entry: any) => entry.status === "logged")
      ).toHaveLength(20);
      expect(submissions[20].status).toBe("rate_limited");
      expect(mocks.sheetRows).toHaveLength(20);
      expect(mocks.lockState.waits).toBe(21);
      expect(mocks.lockState.releases).toBe(21);

      mocks.setActiveUserEmail("player-two@example.test");
      expect(
        ctx.logRuleFeedback({ sessionDate: "2026-10-31", vote: "+1" }).status
      ).toBe("logged");
      expect(mocks.lockState.waits).toBe(22);
      expect(mocks.lockState.releases).toBe(22);
    });

    it("also bounds feedback from a user who changes the submitted session date", () => {
      mocks.propsStore.set("SOF_FEEDBACK_SHEET_ID", "sheet_123");
      mocks.setActiveUserEmail("player-one@example.test");
      const submissions = Array.from({ length: 41 }, (_, index) => {
        const sessionDate = new Date(Date.UTC(2026, 0, index + 1))
          .toISOString()
          .slice(0, 10);
        return ctx.logRuleFeedback({ sessionDate, vote: "+1" });
      });

      expect(
        submissions.filter((entry: any) => entry.status === "logged")
      ).toHaveLength(40);
      expect(submissions[40].status).toBe("rate_limited");
      expect(mocks.sheetRows).toHaveLength(40);
    });

    it("keeps feedback caps enforced after ScriptCache counters are evicted", () => {
      mocks.propsStore.set("SOF_FEEDBACK_SHEET_ID", "sheet_123");
      mocks.setActiveUserEmail("player-one@example.test");
      const submissions = Array.from({ length: 20 }, () =>
        ctx.logRuleFeedback({ sessionDate: "2026-10-31", vote: "+1" })
      );
      expect(submissions.every((entry: any) => entry.status === "logged")).toBe(
        true
      );

      mocks.cacheStore.clear();
      const afterCacheEviction = ctx.logRuleFeedback({
        sessionDate: "2026-10-31",
        vote: "+1"
      });

      expect(afterCacheEviction.status).toBe("rate_limited");
      expect(mocks.sheetRows).toHaveLength(20);
    });

    it("bounds feedback across many identities and prunes expired per-user records", () => {
      const now = Date.now();
      mocks.propsStore.set(
        "rule_feedback_expired",
        JSON.stringify([
          { timestamp: now - 7 * 60 * 60 * 1000, sessionDate: "2026-10-31" }
        ])
      );
      const results = Array.from({ length: 201 }, (_, index) => {
        mocks.setActiveUserEmail(`player-${index}@example.test`);
        return ctx.logRuleFeedback({ sessionDate: "2026-10-31", vote: "+1" });
      });

      expect(
        results.slice(0, 200).every((result: any) => result.status === "logged")
      ).toBe(true);
      expect(results[200].status).toBe("rate_limited");
      expect(mocks.propsStore.has("rule_feedback_expired")).toBe(false);
      const perUserKeys = [...mocks.propsStore.keys()].filter((key) =>
        key.startsWith("rule_feedback_")
      );
      expect(perUserKeys).toHaveLength(200);
      expect(
        JSON.parse(mocks.propsStore.get("SOF_RULE_FEEDBACK_GLOBAL_ATTEMPTS")!)
      ).toHaveLength(200);
    });

    it("backfills the aggregate limiter from existing active user records", () => {
      const now = Date.now();
      for (let index = 0; index < 200; index++) {
        mocks.propsStore.set(
          `rule_feedback_existing_${index}`,
          JSON.stringify([{ timestamp: now, sessionDate: "2026-10-31" }])
        );
      }
      mocks.setActiveUserEmail("new-player@example.test");

      const result = ctx.logRuleFeedback({
        sessionDate: "2026-10-31",
        vote: "+1"
      });

      expect(result.status).toBe("rate_limited");
      expect(
        JSON.parse(mocks.propsStore.get("SOF_RULE_FEEDBACK_GLOBAL_ATTEMPTS")!)
      ).toHaveLength(200);
    });

    it("runs scheduled pruning under the script lock", () => {
      const now = Date.now();
      mocks.propsStore.set(
        "rule_feedback_expired",
        JSON.stringify([
          { timestamp: now - 7 * 60 * 60 * 1000, sessionDate: "2026-10-31" }
        ])
      );
      mocks.propsStore.set(
        "SOF_RULE_FEEDBACK_GLOBAL_ATTEMPTS",
        JSON.stringify([now - 7 * 60 * 60 * 1000])
      );

      expect(ctx.pruneRuleFeedbackRateLimitsTrigger_()).toEqual({
        removed: 1,
        status: "pruned"
      });
      expect(mocks.propsStore.has("rule_feedback_expired")).toBe(false);
      expect(mocks.propsStore.has("SOF_RULE_FEEDBACK_GLOBAL_ATTEMPTS")).toBe(
        false
      );
      expect(mocks.lockState.locked).toBe(false);
    });

    it("uses the temporary active-user key when the user's email is hidden", () => {
      mocks.propsStore.set("SOF_FEEDBACK_SHEET_ID", "sheet_123");
      mocks.setActiveUserEmail("");
      mocks.setTemporaryActiveUserKey("hidden-email-user-one");
      const submissions = Array.from({ length: 21 }, () =>
        ctx.logRuleFeedback({ sessionDate: "2026-10-31", vote: "+1" })
      );

      expect(
        submissions.filter((entry: any) => entry.status === "logged")
      ).toHaveLength(20);
      expect(submissions[20].status).toBe("rate_limited");
      mocks.setTemporaryActiveUserKey("hidden-email-user-two");
      expect(
        ctx.logRuleFeedback({ sessionDate: "2026-10-31", vote: "+1" }).status
      ).toBe("logged");
    });
  });

  describe("Ticket 09: 72-Hour Calendar Attendance Quorum Auditor (auditCalendarQuorum)", () => {
    it("shifts event forward 14 days when fewer than 3 guests confirm YES", () => {
      const start = new Date("2026-11-14T17:00:00Z");
      const end = new Date("2026-11-14T21:30:00Z");
      let currentStart = start;
      let desc = "";

      mocks.mockEvents.set("evt_under_quorum", {
        getTitle: () => "Sea of Fortune session",
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

      expect(() =>
        ctx.auditCalendarQuorum("evt_under_quorum", undefined, "wrong-key")
      ).toThrow("Unauthorized GM RPC");
      const res = ctx.auditCalendarQuorum(
        "evt_under_quorum",
        undefined,
        "test-gm-key"
      );
      expect(res.quorumMet).toBe(false);
      expect(res.confirmedCount).toBe(2);
      expect(currentStart.toISOString()).toBe("2026-11-28T17:00:00.000Z");
      expect(desc).toContain("RESCHEDULED");
      expect(mocks.Calendar.Events.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          start: expect.objectContaining({
            dateTime: "2026-11-28T17:00:00.000Z"
          }),
          end: expect.objectContaining({
            dateTime: "2026-11-28T21:30:00.000Z"
          }),
          description: expect.stringContaining("RESCHEDULED")
        }),
        "primary",
        "evt_under_quorum",
        { sendUpdates: "all" }
      );
    });

    it("preserves the Calendar timezone wall-clock time across spring and fall DST changes", () => {
      const cases = [
        {
          id: "evt_spring_dst",
          start: "2026-02-28T17:00:00Z",
          end: "2026-02-28T22:30:00Z",
          expectedStart: "2026-03-14T16:00:00.000Z",
          expectedEnd: "2026-03-14T21:30:00.000Z"
        },
        {
          id: "evt_fall_dst",
          start: "2026-10-31T16:00:00Z",
          end: "2026-10-31T17:30:00Z",
          expectedStart: "2026-11-14T17:00:00.000Z",
          expectedEnd: "2026-11-14T18:30:00.000Z"
        }
      ];

      for (const scenario of cases) {
        let currentStart = new Date(scenario.start);
        let currentEnd = new Date(scenario.end);
        mocks.mockEvents.set(scenario.id, {
          getTitle: () => "Sea of Fortune session",
          getGuestList: () => [
            { getGuestStatus: () => "YES" },
            { getGuestStatus: () => "YES" }
          ],
          getStartTime: () => currentStart,
          getEndTime: () => currentEnd,
          setTime: (nextStart: Date, nextEnd: Date) => {
            currentStart = nextStart;
            currentEnd = nextEnd;
          },
          setDescription: () => {}
        });

        ctx.auditCalendarQuorum(scenario.id, undefined, "test-gm-key");
        expect(currentStart.toISOString()).toBe(scenario.expectedStart);
        expect(currentEnd.toISOString()).toBe(scenario.expectedEnd);
      }
    });

    it("injects Harptos date and weather when 3 or more guests confirm YES", () => {
      let desc = "";
      mocks.mockEvents.set("evt_quorum_met", {
        getTitle: () => "Sea of Fortune session",
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

      const res = ctx.auditCalendarQuorum(
        "evt_quorum_met",
        {
          harptosDate: "15 Tarsakh, 1494 DR",
          planarAlignment: "Elemental Water Waxing",
          weather: "Heavy monsoon squalls"
        },
        "test-gm-key"
      );
      expect(res.quorumMet).toBe(true);
      expect(res.confirmedCount).toBe(3);
      expect(desc).toContain("15 Tarsakh, 1494 DR");
      expect(desc).toContain("Heavy monsoon squalls");
    });

    it("installs Wednesday and daily-pruning triggers idempotently from the editor setup entrypoint", () => {
      const first = ctx.setupGovernanceTriggers_();
      expect(first).toEqual({ installed: true });
      expect(mocks.triggers).toHaveLength(2);
      expect(mocks.triggers).toContainEqual({
        handlerFunction: "auditCalendarQuorumTrigger_",
        weekDay: "WEDNESDAY",
        hour: 12,
        everyDays: undefined
      });
      expect(mocks.triggers).toContainEqual({
        handlerFunction: "pruneRuleFeedbackRateLimitsTrigger_",
        weekDay: undefined,
        hour: 3,
        everyDays: 1
      });

      const second = ctx.setupGovernanceTriggers_();
      expect(second).toEqual({ installed: false });
      expect(mocks.triggers).toHaveLength(2);
      expect(mocks.lockState.waits).toBe(2);
      expect(mocks.lockState.releases).toBe(2);
      expect(() => ctx.installGovernanceTriggers()).toThrow(
        "Unauthorized GM RPC"
      );
      expect(() => ctx.installGovernanceTriggers("invalid-key")).toThrow(
        "Unauthorized GM RPC"
      );

      mocks.propsStore.delete("SOF_GM_KEY");
      expect(() => ctx.setupGovernanceTriggers_()).toThrow(
        "Set SOF_GM_KEY in Script Properties before setup."
      );
    });

    it("releases the trigger-installation lock on errors and waits before inspecting triggers", () => {
      mocks.ScriptApp.getProjectTriggers.mockImplementationOnce(() => {
        throw new Error("trigger service unavailable");
      });

      expect(() => ctx.installGovernanceTriggers("test-gm-key")).toThrow(
        "trigger service unavailable"
      );
      expect(mocks.lockState.locked).toBe(false);
      expect(mocks.lockState.waits).toBe(1);
      expect(mocks.lockState.releases).toBe(1);

      mocks.lockState.locked = true;
      expect(() => ctx.installGovernanceTriggers("test-gm-key")).toThrow(
        "Lock is already held"
      );
      expect(mocks.ScriptApp.getProjectTriggers).toHaveBeenCalledTimes(1);
      expect(mocks.ScriptApp.newTrigger).not.toHaveBeenCalled();
    });

    it("does not audit an alternate Saturday early on the following weekly run", () => {
      let currentStart = new Date("2026-11-14T17:00:00Z");
      let currentEnd = new Date("2026-11-14T21:30:00Z");
      const setTime = vi.fn((nextStart: Date, nextEnd: Date) => {
        currentStart = nextStart;
        currentEnd = nextEnd;
      });
      mocks.mockEvents.set("weekly-quorum-session", {
        getTitle: () => "Sea of Fortune session",
        getGuestList: () => [
          { getGuestStatus: () => "YES" },
          { getGuestStatus: () => "YES" },
          { getGuestStatus: () => "NO" }
        ],
        getStartTime: () => currentStart,
        getEndTime: () => currentEnd,
        setTime,
        getDescription: () => "GM-authored campaign description",
        setDescription: () => {}
      });

      const firstRun = ctx.auditCalendarQuorumTrigger_(
        { triggerUid: "weekly-trigger" },
        new Date("2026-11-11T17:00:00Z")
      );
      expect(firstRun.status).toBe("RESCHEDULED");
      expect(currentStart.toISOString()).toBe("2026-11-28T17:00:00.000Z");

      const nextWeeklyRun = ctx.auditCalendarQuorumTrigger_(
        { triggerUid: "weekly-trigger" },
        new Date("2026-11-18T17:00:00Z")
      );

      expect(nextWeeklyRun).toEqual({ status: "NO_UPCOMING_SESSION" });
      expect(currentStart.toISOString()).toBe("2026-11-28T17:00:00.000Z");
      expect(setTime).toHaveBeenCalledTimes(1);
    });

    it("selects the upcoming Saturday event, preserves user text, and normalizes trigger events", () => {
      let weekdayDescription = "GM weekday notes";
      let saturdayDescription = "GM-authored campaign description";
      const auditNow = new Date("2026-11-10T12:00:00-05:00");
      const dateAtOffset = (days: number) => {
        const date = new Date(auditNow.getTime());
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
      };
      const makeEvent = (
        title: string,
        date: string,
        readDescription: () => string,
        writeDescription: (value: string) => void
      ) => ({
        getTitle: () => title,
        getStartTime: () => new Date(date + "T17:00:00Z"),
        getEndTime: () => new Date(date + "T21:30:00Z"),
        getGuestList: () => [
          { getGuestStatus: () => "YES" },
          { getGuestStatus: () => "YES" },
          { getGuestStatus: () => "YES" }
        ],
        getDescription: readDescription,
        setDescription: writeDescription,
        setTime: () => {}
      });
      mocks.mockEvents.set(
        "weekday-match",
        makeEvent(
          "Dnd planning",
          dateAtOffset(1),
          () => weekdayDescription,
          (value) => {
            weekdayDescription = value;
          }
        )
      );
      mocks.mockEvents.set(
        "saturday-session",
        makeEvent(
          "Sea of Fortune session",
          dateAtOffset(4),
          () => saturdayDescription,
          (value) => {
            saturdayDescription = value;
          }
        )
      );

      const result = ctx.auditCalendarQuorum(
        "2026-11-11",
        undefined,
        "test-gm-key"
      );
      expect(result.status).toBe("QUORUM_MET");
      expect(weekdayDescription).toBe("GM weekday notes");
      expect(saturdayDescription).toContain("GM-authored campaign description");
      expect(saturdayDescription).toContain("SOF_QUORUM_AUTOMATION:START");

      const triggerResult = ctx.auditCalendarQuorumTrigger_(
        { triggerUid: "scheduled-trigger" },
        auditNow
      );
      expect(triggerResult.status).toBe("QUORUM_MET");
    });

    it("rejects a direct event ID that does not match the configured Calendar title", () => {
      const setTime = vi.fn();
      const setDescription = vi.fn();
      mocks.mockEvents.set("unrelated-saturday", {
        getTitle: () => "Birthday Party",
        getStartTime: () => new Date("2026-11-14T17:00:00Z"),
        getEndTime: () => new Date("2026-11-14T21:30:00Z"),
        getGuestList: () => [],
        setTime,
        setDescription
      });

      expect(() =>
        ctx.auditCalendarQuorum("unrelated-saturday", undefined, "test-gm-key")
      ).toThrow("Upcoming Saturday Calendar event not found");
      expect(setTime).not.toHaveBeenCalled();
      expect(setDescription).not.toHaveBeenCalled();
    });

    it("matches a Saturday using the Calendar timezone and its local date boundary", () => {
      mocks.setCalendarTimeZone("Europe/Berlin");
      let description = "GM notes";
      mocks.mockEvents.set("berlin-saturday", {
        getTitle: () => "Sea of Fortune session",
        getStartTime: () => new Date("2026-11-13T23:30:00Z"),
        getEndTime: () => new Date("2026-11-14T03:00:00Z"),
        getGuestList: () => [
          { getGuestStatus: () => "YES" },
          { getGuestStatus: () => "YES" },
          { getGuestStatus: () => "YES" }
        ],
        getDescription: () => description,
        setDescription: (value: string) => {
          description = value;
        },
        setTime: () => {}
      });

      const result = ctx.auditCalendarQuorum(
        "2026-11-14",
        undefined,
        "test-gm-key"
      );

      expect(result.status).toBe("QUORUM_MET");
      expect(description).toContain("SOF_QUORUM_AUTOMATION:START");
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

      const res = ctx.auditCalendarQuorum(
        "2026-11-14",
        undefined,
        "test-gm-key"
      );
      expect(res).toEqual({ status: "SKIPPED_NO_GUESTS", confirmed: 0 });
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

      const res = ctx.auditCalendarQuorum(
        "2026-11-14",
        undefined,
        "test-gm-key"
      );
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

      const res = ctx.auditCalendarQuorum(
        "2026-11-14",
        undefined,
        "test-gm-key"
      );
      expect(res.status).toBe("QUORUM_MET");
      expect(res.confirmedCount).toBe(3);
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
      mocks.propsStore.set("GEMINI_API_KEY", "test-gemini-key");
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

      const res1 = ctx.extractNarrativePromises("2026-10-31", "test-gm-key");
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
      const res2 = ctx.extractNarrativePromises("2026-10-31", "test-gm-key");
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

    it("normalizes relative and valid due dates and omits invalid Task timestamps", () => {
      mocks.propsStore.set("GEMINI_API_KEY", "test-gemini-key");
      mocks.UrlFetchApp.fetch.mockReturnValueOnce({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            tasks: [
              { title: "Relative due", due: "in 8 days" },
              { title: "Valid timestamp", due: "2026-11-09T10:30:00-05:00" },
              { title: "Invalid text", due: "sometime next month" },
              { title: "Invalid date", due: "2026-02-30T10:30:00Z" }
            ]
          })
      });

      const result = ctx.extractNarrativePromises("2026-10-31", "test-gm-key");

      expect(result.createdCount).toBe(4);
      expect(mocks.taskStore.map((task) => task.due)).toEqual([
        "2026-11-08T00:00:00.000Z",
        "2026-11-09T10:30:00-05:00",
        undefined,
        undefined
      ]);
    });

    it("rejects Gemini failures and deduplicates only open tasks across pages under a script lock", () => {
      expect(() =>
        ctx.extractNarrativePromises("2026-10-31", "test-gm-key")
      ).toThrow("GEMINI_API_KEY is not configured");
      mocks.propsStore.set("GEMINI_API_KEY", "test-gemini-key");
      mocks.UrlFetchApp.fetch.mockReturnValueOnce({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            tasks: [{ title: "Open promise" }, { title: "Finished promise" }]
          })
      });
      mocks.Tasks.Tasks.list
        .mockReturnValueOnce({
          items: [
            { id: "open-1", title: "Open promise", status: "needsAction" }
          ],
          nextPageToken: "next-page"
        })
        .mockReturnValueOnce({
          items: [
            {
              id: "completed-1",
              title: "Finished promise",
              status: "completed"
            }
          ]
        });

      const result = ctx.extractNarrativePromises("2026-10-31", "test-gm-key");
      expect(result.createdCount).toBe(1);
      expect(mocks.taskStore[0].title).toBe("Finished promise");
      expect(mocks.Tasks.Tasks.list).toHaveBeenNthCalledWith(
        2,
        "@default",
        expect.objectContaining({ pageToken: "next-page" })
      );
      expect(mocks.lockState.waits).toBe(1);
      expect(mocks.lockState.releases).toBe(1);

      mocks.UrlFetchApp.fetch.mockReturnValueOnce({
        getResponseCode: () => 429,
        getContentText: () => JSON.stringify({ error: { message: "quota" } })
      });
      expect(() =>
        ctx.extractNarrativePromises("2026-10-31", "test-gm-key")
      ).toThrow("Gemini API request failed (429)");
    });
  });

  describe("Ticket 15: Server-Side GM Access Guard (assertGmAccess_)", () => {
    it("fails closed when SOF_GM_KEY is unset and requires an exact matching key", () => {
      mocks.propsStore.delete("SOF_GM_KEY");
      expect(ctx.assertGmAccess_).toBeDefined();
      expect(() => ctx.assertGmAccess_()).toThrow("Unauthorized GM RPC");
      expect(() => ctx.assertGmAccess_("any_key")).toThrow(
        "Unauthorized GM RPC"
      );

      mocks.propsStore.set("SOF_GM_KEY", "secret-gm-token-99");
      expect(() => ctx.assertGmAccess_()).toThrow("Unauthorized GM RPC");

      expect(() => ctx.assertGmAccess_()).toThrow("Unauthorized GM RPC");
      expect(() => ctx.assertGmAccess_("wrong-token")).toThrow(
        "Unauthorized GM RPC"
      );
      expect(() => ctx.assertGmAccess_("secret-gm-token-99")).not.toThrow();
    });
  });

  describe("Ticket 19 & 22: doGet View Isolation & getAudioAuthToken", () => {
    it("serves the GM view only with a valid key and defaults unauthenticated requests to Companion", () => {
      const noKeyOut = ctx.doGet({
        parameter: { session: "2026-11-14" }
      });
      expect(noKeyOut.template.viewMode).toBe("companion");
      expect(noKeyOut.template.gmKey).toBe("");
      const templateSource = fs.readFileSync("Index.html", "utf8");
      const gmMarkupBlock = templateSource.match(
        /<\? if \(typeof viewMode === "undefined" \|\| viewMode !== "companion"\) \{ \?>([\s\S]*?)<\? \} \?>/
      );
      expect(gmMarkupBlock?.[1]).toContain('id="sidebar"');
      expect(gmMarkupBlock?.[1]).toContain('id="workspace"');
      const noKeyMarkup =
        noKeyOut.template.viewMode === "companion" && gmMarkupBlock
          ? templateSource.replace(gmMarkupBlock[0], "")
          : templateSource;
      expect(noKeyMarkup).not.toContain('id="sidebar"');
      expect(noKeyMarkup).not.toContain('id="workspace"');
      const companionBodyClass = templateSource.match(
        /class="<\?=([\s\S]*?)\?>"/
      );
      const companionHudRule = templateSource.match(
        /body\.companion-only-mode #player-hud\s*\{([^}]+)\}/
      );
      expect(companionBodyClass).not.toBeNull();
      expect(companionHudRule?.[1]).toContain("display: flex;");
      const renderedCompanionView = companionBodyClass
        ? noKeyMarkup.replace(
            companionBodyClass[0],
            `class="${noKeyOut.template.viewMode === "companion" ? "companion-only-mode" : ""}"`
          )
        : templateSource;
      expect(renderedCompanionView).toMatch(
        /<body\s+class="companion-only-mode"\s*>/
      );
      expect(renderedCompanionView).not.toContain('id="sidebar"');
      expect(renderedCompanionView).not.toContain('id="workspace"');
      const renderedGmHud = companionBodyClass
        ? templateSource.replace(companionBodyClass[0], 'class=""')
        : templateSource;
      expect(renderedGmHud).not.toMatch(
        /<body\s+class="companion-only-mode"\s*>/
      );

      const gmOut = ctx.doGet({
        parameter: { session: "2026-11-14", gmKey: "test-gm-key" }
      });
      expect(gmOut.template.sessionDate).toBe("2026-11-14");
      expect(gmOut.template.viewMode).toBe("gm");
      expect(gmOut.template.gmKey).toBe("test-gm-key");

      const compOut = ctx.doGet({
        parameter: { session: "2026-11-14", view: "companion" }
      });
      expect(compOut.template.sessionDate).toBe("2026-11-14");
      expect(compOut.template.viewMode).toBe("companion");
      expect(compOut.template.gmKey).toBe("");
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
      expect(banterRes.getMimeType()).toBe("application/json");
      expect(JSON.parse(banterRes.getContent()).cached).toBe(false);
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
      expect(JSON.parse(cueRes.getContent())).toEqual({
        status: "OK",
        cached: true
      });

      const latest = ctx.getLatestAudioCue("pi-edge-key");
      expect(latest).toEqual({
        intent: "MUSIC_CUE",
        mood: "combat",
        rule: null,
        tier: "TIER_1_PI_LOCAL",
        timestamp: 1730500000123
      });
    });

    it("relays cached Rule Query cues to Companion without GM-only cue fields", () => {
      mocks.propsStore.set("SOF_GM_KEY", "pi-edge-key");
      ctx.doPost({
        postData: {
          contents: JSON.stringify({
            gmKey: "pi-edge-key",
            intent: "RULE_QUERY",
            rule: "grappling",
            mood: "private-mood",
            tier: "TIER_2_GEMINI_CLOUD",
            timestamp: 1730500000456
          })
        }
      });

      expect(ctx.getLatestRuleQueryCueForCompanion()).toEqual({
        intent: "RULE_QUERY",
        rule: "grappling",
        timestamp: 1730500000456
      });

      ctx.doPost({
        postData: {
          contents: JSON.stringify({
            gmKey: "pi-edge-key",
            intent: "MUSIC_CUE",
            mood: "combat",
            timestamp: 1730500000789
          })
        }
      });
      expect(ctx.getLatestRuleQueryCueForCompanion()).toEqual({
        intent: "RULE_QUERY",
        rule: "grappling",
        timestamp: 1730500000456
      });
    });
  });

  it("declares signed-in Companion access and all configured automation services", () => {
    const manifest = JSON.parse(fs.readFileSync("appsscript.json", "utf8"));
    expect(manifest.webapp.access).toBe("ANYONE");
    expect(manifest.dependencies.enabledAdvancedServices).toContainEqual({
      userSymbol: "Tasks",
      serviceId: "tasks",
      version: "v1"
    });
    expect(manifest.oauthScopes).toEqual(
      expect.arrayContaining([
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/tasks",
        "https://www.googleapis.com/auth/script.scriptapp"
      ])
    );
  });
});
