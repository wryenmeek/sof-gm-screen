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

  describe("Ticket 07 & 22: Server-Isolated Player Companion Entrypoint, Boot Identity Restore & Header", () => {
    it("renders #player-hud in Index.html and persists selected character identity in localStorage", () => {
      const playerHud = document.getElementById("player-hud");
      expect(playerHud).not.toBeNull();
      expect(selectPlayerIdentity).toBeDefined();

      selectPlayerIdentity("Pog");
      expect(mockLocalStorage.getItem("sof_player_identity")).toBe("Pog");
      expect(document.getElementById("player-tag")!.textContent).toBe(
        "Player: Pog"
      );
      expect(
        document.getElementById("player-identity-display")!.textContent
      ).toBe("Player: Pog");
      expect(document.getElementById("identity-modal")!.style.display).toBe(
        "none"
      );
      expect(
        document.getElementById("identity-modal")!.classList.contains("hidden")
      ).toBe(true);
    });

    it("restores saved sof_player_identity on boot, renders #player-session-date, and isolates ?view=companion from GM RPCs", () => {
      const companionHarness = setupClientHarness({
        viewMode: "companion",
        initialLocalStorage: { sof_player_identity: "Fade" }
      });

      expect(companionHarness.initCompanionState).toBeDefined();
      (window as any).onload();

      // 1. Companion isolation: body has companion-only-mode, removes #sidebar & #workspace DOM nodes, skips the Table Notes RPC, calls getRulesGlossary
      expect(document.body.classList.contains("companion-only-mode")).toBe(
        true
      );
      expect(document.getElementById("sidebar")).toBeNull();
      expect(document.getElementById("workspace")).toBeNull();
      expect(companionHarness.getSessionManifestSpy).not.toHaveBeenCalled();
      expect(companionHarness.getTableNotesSpy).not.toHaveBeenCalled();
      expect(companionHarness.getRulesGlossarySpy).toHaveBeenCalledWith(
        "2026-10-31"
      );

      // 2. Boot identity restore & session date header
      expect(
        document.getElementById("player-identity-display")!.textContent
      ).toBe("Player: Fade");
      expect(
        document.getElementById("identity-modal")!.classList.contains("hidden")
      ).toBe(true);
      expect(document.getElementById("player-session-date")!.textContent).toBe(
        "2026-10-31"
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

    it("preserves the matched glossary source on audio-triggered Rule Cards", () => {
      const audioHarness = setupClientHarness({
        rulesGlossary: [
          {
            id: "campaign_grappling",
            title: "Grappling",
            source: "Campaign Combat Guide",
            summary:
              "A special melee attack that sets the target's speed to 0.",
            tags: "combat grapple"
          }
        ]
      });
      audioHarness.loadDriveRulesGlossary("2026-10-31");

      audioHarness.handleAudioIntent({
        intent: "RULE_QUERY",
        rule: "grappling",
        timestamp: 42
      });

      expect(document.getElementById("card-title")!.textContent).toBe(
        "Grappling"
      );
      expect(document.getElementById("card-type")!.textContent).toBe(
        "Campaign Combat Guide"
      );

      audioHarness.triggerPtt();
      audioHarness.getLastSpeechRecognitionInstance().onresult({
        results: [[{ transcript: "grappling" }]]
      });
      expect(document.getElementById("card-type")!.textContent).toBe(
        "Campaign Combat Guide"
      );
    });

    it.each([
      {
        result: { status: "rate_limited" },
        expectedMessage: "Feedback limit reached. Please try again later."
      },
      {
        result: { status: "unavailable" },
        expectedMessage:
          "Feedback logging is unavailable. Please try again later."
      },
      {
        result: { status: "unexpected" },
        expectedMessage: "Feedback could not be saved. Please try again."
      }
    ])(
      "keeps the Rule Card available when feedback is rejected",
      ({ result, expectedMessage }) => {
        const feedbackHarness = setupClientHarness({
          ruleFeedbackResult: result
        });
        feedbackHarness.showRuleCard(
          "Disadvantage",
          "Roll two d20s and take lower.",
          "disadvantage on concentration"
        );

        feedbackHarness.submitRuleFeedback("+1");

        const card = document.getElementById("rule-card")!;
        const status = document.getElementById("feedback-status");
        expect(card.style.display).toBe("block");
        expect(status?.textContent).toBe(expectedMessage);
        expect(status?.getAttribute("role")).toBe("status");
        expect(status?.getAttribute("aria-live")).toBe("polite");

        feedbackHarness.submitRuleFeedback("+1");
        expect(feedbackHarness.logRuleFeedbackSpy).toHaveBeenCalledTimes(2);
        expect(card.style.display).toBe("block");
      }
    );

    it("keeps the Rule Card open with a retry message when the feedback RPC fails", () => {
      const feedbackHarness = setupClientHarness({
        ruleFeedbackError: "Apps Script unavailable"
      });
      feedbackHarness.showRuleCard(
        "Disadvantage",
        "Roll two d20s and take lower.",
        "disadvantage on concentration"
      );

      feedbackHarness.submitRuleFeedback("+1");

      expect(document.getElementById("rule-card")!.style.display).toBe("block");
      expect(document.getElementById("feedback-status")?.textContent).toBe(
        "Feedback could not be saved. Please try again."
      );
    });

    it("keeps a pending vote from submitting twice", () => {
      const feedbackHarness = setupClientHarness({ deferRuleFeedback: true });
      feedbackHarness.showRuleCard("Disadvantage", "Roll two d20s.");

      feedbackHarness.submitRuleFeedback("+1");
      feedbackHarness.submitRuleFeedback("-1");

      expect(feedbackHarness.logRuleFeedbackSpy).toHaveBeenCalledTimes(1);
      expect(
        (document.getElementById("btn-up") as HTMLButtonElement).disabled
      ).toBe(true);
      expect(
        (document.getElementById("btn-down") as HTMLButtonElement).disabled
      ).toBe(true);

      feedbackHarness.respondToRuleFeedback({ status: "rate_limited" });

      expect(
        (document.getElementById("btn-up") as HTMLButtonElement).disabled
      ).toBe(false);
      expect(
        (document.getElementById("btn-down") as HTMLButtonElement).disabled
      ).toBe(false);
    });

    it("does not dismiss a newer Rule Card when an older vote completes", () => {
      const feedbackHarness = setupClientHarness({ deferRuleFeedback: true });
      feedbackHarness.showRuleCard("First Rule", "First summary.");
      feedbackHarness.submitRuleFeedback("+1");
      feedbackHarness.showRuleCard("Second Rule", "Second summary.");

      feedbackHarness.respondToRuleFeedback({ status: "logged" });

      expect(document.getElementById("card-title")!.textContent).toBe(
        "Second Rule"
      );
      expect(document.getElementById("rule-card")!.style.display).toBe("block");
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
          sessionDate: "2026-10-31",
          player: "Vaelor",
          phrase: "disadvantage on concentration",
          cardTitle: "Disadvantage",
          vote: "+1"
        })
      );
      expect(card.style.display).toBe("none");
    });

    it("indexes Drive glossary into rulesMiniSearch for fuzzy matching ('misty stp', 'grapple'), debounces #ptt-dictation-input by 900ms, handles Enter, and falls back to focusing #ptt-dictation-input on speech error/absence", () => {
      const harness = setupClientHarness({
        rulesGlossary: [
          {
            id: "srd_misty_step",
            title: "Misty Step",
            source: "5e SRD",
            summary:
              "2nd-level conjuration bonus action: teleport up to 30 feet.",
            tags: "spell bonus action teleport"
          },
          {
            id: "srd_grappling",
            title: "Grappling",
            source: "5e SRD",
            summary:
              "Special melee attack contested by Athletics or Acrobatics.",
            tags: "combat grapple athletics"
          }
        ]
      });

      harness.loadDriveRulesGlossary("2026-10-31");

      // 1. Fuzzy MiniSearch query ('misty stp' -> Misty Step) via 900ms dictation input debounce
      const dictationInput = document.getElementById(
        "ptt-dictation-input"
      ) as HTMLInputElement;
      expect(dictationInput).not.toBeNull();

      dictationInput.value = "misty stp";
      harness.handleDictationInput("misty stp");
      const card = document.getElementById("rule-card")!;
      expect(card.classList.contains("visible")).toBe(false);

      vi.advanceTimersByTime(900);
      expect(card.classList.contains("visible")).toBe(true);
      expect(card.style.display).toBe("block");
      expect(document.getElementById("card-title")!.textContent).toBe(
        "Misty Step"
      );

      // 2. Enter key immediately triggers rule query ('grapple' -> Grappling)
      harness.dismissRuleCard();
      expect(card.classList.contains("visible")).toBe(false);
      dictationInput.value = "grapple";
      dictationInput.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      expect(card.classList.contains("visible")).toBe(true);
      expect(document.getElementById("card-title")!.textContent).toBe(
        "Grappling"
      );

      // 3. SpeechRecognition 'not-allowed' error automatically focuses #ptt-dictation-input
      dictationInput.blur();
      harness.triggerPtt();
      const rec = harness.getLastSpeechRecognitionInstance();
      rec.onerror({ error: "not-allowed" });
      expect(document.activeElement).toBe(dictationInput);

      // 4. Missing webkitSpeechRecognition automatically focuses #ptt-dictation-input without throwing
      dictationInput.blur();
      delete (window as any).webkitSpeechRecognition;
      delete (window as any).SpeechRecognition;
      expect(() => harness.triggerPtt()).not.toThrow();
      expect(document.activeElement).toBe(dictationInput);
    });
  });
});
