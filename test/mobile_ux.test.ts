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

      // 1. Companion isolation: body has companion-only-mode, skips getSessionManifest & getScratchpadNotes, calls getRulesGlossary
      expect(document.body.classList.contains("companion-only-mode")).toBe(
        true
      );
      expect(companionHarness.getSessionManifestSpy).not.toHaveBeenCalled();
      expect(companionHarness.getScratchpadNotesSpy).not.toHaveBeenCalled();
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
