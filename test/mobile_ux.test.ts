// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupClientHarness } from "./helpers/client-harness";

describe("Mobile Player Companion UX (Tickets 07 & 08)", () => {
  let selectPlayerIdentity: (name: string) => void;
  let triggerPtt: () => void;
  let showRuleCard: (
    ruleTitle: string,
    ruleText: string,
    phrase?: string
  ) => void;
  let submitRuleFeedback: (vote: string) => void;
  let logRuleFeedbackSpy: ReturnType<typeof vi.fn>;
  let mockLocalStorage: ReturnType<
    typeof setupClientHarness
  >["mockLocalStorage"];
  let getLastSpeechRecognitionInstance: () => any;

  beforeEach(() => {
    vi.useFakeTimers();
    const harness = setupClientHarness();
    selectPlayerIdentity = harness.selectPlayerIdentity;
    triggerPtt = harness.triggerPtt;
    showRuleCard = harness.showRuleCard;
    submitRuleFeedback = harness.submitRuleFeedback;
    logRuleFeedbackSpy = harness.logRuleFeedbackSpy;
    mockLocalStorage = harness.mockLocalStorage;
    getLastSpeechRecognitionInstance = harness.getLastSpeechRecognitionInstance;
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
      const lastSpeechRecognitionInstance = getLastSpeechRecognitionInstance();
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
