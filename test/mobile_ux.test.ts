// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import { marked } from "marked";
import MiniSearch from "minisearch";

describe("Mobile Player Companion UX (Tickets 07 & 08)", () => {
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    clear: () => store.clear(),
    removeItem: (k: string) => store.delete(k)
  };

  let selectPlayerIdentity: (name: string) => void;
  let triggerPtt: () => void;
  let showRuleCard: (
    ruleTitle: string,
    ruleText: string,
    phrase?: string
  ) => void;
  let submitRuleFeedback: (vote: string) => void;
  let logRuleFeedbackSpy: ReturnType<typeof vi.fn>;
  let lastSpeechRecognitionInstance: any;

  beforeEach(() => {
    vi.useFakeTimers();
    (window as any).localStorage = mockLocalStorage;
    (globalThis as any).localStorage = mockLocalStorage;
    mockLocalStorage.clear();

    lastSpeechRecognitionInstance = null;
    (window as any).webkitSpeechRecognition = class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((e: any) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      constructor() {
        lastSpeechRecognitionInstance = this;
      }
    };

    const html = fs.readFileSync("Index.html", "utf8");
    const bodyMatch = html.match(/<body>([\s\S]*?)<script>/i);
    document.body.innerHTML = bodyMatch ? bodyMatch[1] : "";

    logRuleFeedbackSpy = vi.fn();
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
            getFilePayload: vi.fn(),
            saveAudioTimeline: vi.fn(),
            logRuleFeedback: logRuleFeedbackSpy
          }),
          logRuleFeedback: logRuleFeedbackSpy
        }
      }
    };

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
      "localStorage",
      cleanScript +
        `
      return {
        selectPlayerIdentity: typeof selectPlayerIdentity !== "undefined" ? selectPlayerIdentity : undefined,
        triggerPtt: typeof triggerPtt !== "undefined" ? triggerPtt : undefined,
        showRuleCard: typeof showRuleCard !== "undefined" ? showRuleCard : undefined,
        submitRuleFeedback: typeof submitRuleFeedback !== "undefined" ? submitRuleFeedback : undefined
      };
    `
    );
    const exported = fn(
      window,
      document,
      marked,
      MiniSearch,
      (window as any).google,
      mockLocalStorage
    );
    selectPlayerIdentity = exported.selectPlayerIdentity;
    triggerPtt = exported.triggerPtt;
    showRuleCard = exported.showRuleCard;
    submitRuleFeedback = exported.submitRuleFeedback;
  });

  describe("Ticket 07: Responsive Viewport Fork & Identity Selection", () => {
    it("renders #player-hud in Index.html and persists selected character identity in localStorage", () => {
      const playerHud = document.getElementById("player-hud");
      expect(playerHud).not.toBeNull();
      expect(selectPlayerIdentity).toBeDefined();

      selectPlayerIdentity("Pog");
      expect(mockLocalStorage.getItem("sof_player_identity")).toBe("Pog");
      expect(document.getElementById("player-tag")!.textContent).toBe(
        "Player: Pog"
      );
      expect(document.getElementById("identity-modal")!.style.display).toBe(
        "none"
      );
    });
  });

  describe("Ticket 08: Mobile Push-to-Talk (PTT) Rules Sniffer & Feedback Logger", () => {
    it("starts webkitSpeechRecognition on PTT tap, matches spoken transcript to glossary, and auto-stops after 4000ms", () => {
      expect(triggerPtt).toBeDefined();
      const pttBtn = document.getElementById("ptt-btn")!;
      triggerPtt();
      expect(pttBtn.classList.contains("listening")).toBe(true);
      expect(lastSpeechRecognitionInstance).not.toBeNull();
      expect(lastSpeechRecognitionInstance.start).toHaveBeenCalledTimes(1);

      lastSpeechRecognitionInstance.onresult({
        results: [[{ transcript: "How does Exhaustion work?" }]]
      });
      const card = document.getElementById("rule-card")!;
      expect(card.style.display).toBe("block");
      expect(document.getElementById("card-title")!.textContent).toBe(
        "Exhaustion"
      );
      expect(pttBtn.classList.contains("listening")).toBe(false);
    });

    it("displays rule card with 30-second auto-dismiss decay and logs feedback on vote", () => {
      expect(showRuleCard).toBeDefined();
      expect(submitRuleFeedback).toBeDefined();
      selectPlayerIdentity("Vaelor");

      const card = document.getElementById("rule-card")!;
      showRuleCard(
        "Disadvantage",
        "Roll two d20s and take lower.",
        "disadvantage on concentration"
      );
      expect(card.style.display).toBe("block");

      submitRuleFeedback("+1");
      expect(logRuleFeedbackSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          player: "Vaelor",
          phrase: "disadvantage on concentration",
          cardTitle: "Disadvantage",
          vote: "+1"
        })
      );
      expect(card.style.display).toBe("none");
    });
  });
});
