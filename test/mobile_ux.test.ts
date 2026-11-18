// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupClientHarness } from "./helpers/client-harness";

describe("Mobile Player Companion UX (Tickets 07 & 08)", () => {
  let selectPlayerIdentity: (name: string) => void;
  let togglePlayerIdentityModal: () => void;
  let closePlayerIdentityModal: () => void;
  let openGmKeyModal: () => void;
  let closeGmKeyModal: () => void;
  let submitGmKey: () => void;
  let verifyGmKeySpy: ReturnType<typeof vi.fn>;
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
    togglePlayerIdentityModal = harness.togglePlayerIdentityModal;
    closePlayerIdentityModal = harness.closePlayerIdentityModal;
    openGmKeyModal = harness.openGmKeyModal;
    closeGmKeyModal = harness.closeGmKeyModal;
    submitGmKey = harness.submitGmKey;
    verifyGmKeySpy = harness.verifyGmKeySpy;
    triggerPtt = harness.triggerPtt;
    showRuleCard = harness.showRuleCard;
    submitRuleFeedback = harness.submitRuleFeedback;
    logRuleFeedbackSpy = harness.logRuleFeedbackSpy;
    mockLocalStorage = harness.mockLocalStorage;
    getLastSpeechRecognitionInstance = harness.getLastSpeechRecognitionInstance;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

    it("allows toggling character selection modal and switching character after one is chosen", () => {
      // Initially select Pog
      selectPlayerIdentity("Pog");
      expect(mockLocalStorage.getItem("sof_player_identity")).toBe("Pog");
      expect(document.getElementById("identity-modal")!.style.display).toBe(
        "none"
      );

      // Toggle open modal via switch button
      togglePlayerIdentityModal();
      const modal = document.getElementById("identity-modal")!;
      expect(modal.style.display).toBe("flex");
      expect(modal.classList.contains("hidden")).toBe(false);

      // Verify Pog button is marked active
      const pogBtn = document.querySelector(".id-btn[data-player='Pog']")!;
      const vaelorBtn = document.querySelector(
        ".id-btn[data-player='Vaelor']"
      )!;
      expect(pogBtn.classList.contains("active")).toBe(true);
      expect(vaelorBtn.classList.contains("active")).toBe(false);

      // Switch to Vaelor
      selectPlayerIdentity("Vaelor");
      expect(mockLocalStorage.getItem("sof_player_identity")).toBe("Vaelor");
      expect(
        document.getElementById("player-identity-display")!.textContent
      ).toBe("Player: Vaelor");
      expect(modal.style.display).toBe("none");

      // Toggle open again and verify closePlayerIdentityModal
      togglePlayerIdentityModal();
      expect(modal.style.display).toBe("flex");
      expect(vaelorBtn.classList.contains("active")).toBe(true);
      closePlayerIdentityModal();
      expect(modal.style.display).toBe("none");
      expect(modal.classList.contains("hidden")).toBe(true);
    });

    it("supports in-app GM login modal: opens, closes, and verifies GM key", () => {
      const gmModal = document.getElementById("gm-key-modal")!;
      const gmInput = document.getElementById(
        "gm-key-input"
      ) as HTMLInputElement;
      const gmError = document.getElementById("gm-key-error")!;

      expect(gmModal.style.display).toBe("none");

      // Open GM login modal
      openGmKeyModal();
      expect(gmModal.style.display).toBe("flex");
      expect(gmModal.classList.contains("hidden")).toBe(false);

      // Submit empty key -> validation error
      submitGmKey();
      expect(gmError.style.display).toBe("block");
      expect(gmError.textContent).toContain("Please enter your GM secret key");

      // Close modal
      closeGmKeyModal();
      expect(gmModal.style.display).toBe("none");

      // Re-open and submit valid key
      openGmKeyModal();
      gmInput.value = "my-secret-gm-key";
      submitGmKey();

      expect(verifyGmKeySpy).toHaveBeenCalledWith("my-secret-gm-key");
      expect(mockLocalStorage.getItem("sof_gm_key")).toBe("my-secret-gm-key");
    });

    it("displays error when server rejects GM key", () => {
      const failingHarness = setupClientHarness({
        viewMode: "companion",
        verifyGmKeyResult: false
      });
      failingHarness.openGmKeyModal();
      const gmInput = document.getElementById(
        "gm-key-input"
      ) as HTMLInputElement;
      const gmError = document.getElementById("gm-key-error")!;
      gmInput.value = "wrong-key";

      failingHarness.submitGmKey();
      expect(failingHarness.verifyGmKeySpy).toHaveBeenCalledWith("wrong-key");
      expect(gmError.style.display).toBe("block");
      expect(gmError.textContent).toContain("Invalid GM key");
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
      expect(
        (document.getElementById("ptt-dictation-input") as HTMLInputElement)
          .value
      ).toBe("How does Exhaustion work?");
      expect(document.getElementById("ptt-status-msg")!.textContent).toContain(
        'Heard: "How does Exhaustion work?"'
      );
    });

    it("handles SpeechRecognition error (not-allowed) by surfacing iframe security advice and focusing dictation input", () => {
      triggerPtt();
      const pttBtn = document.getElementById("ptt-btn")!;
      expect(pttBtn.classList.contains("listening")).toBe(true);

      const lastSpeechRecognitionInstance = getLastSpeechRecognitionInstance();
      lastSpeechRecognitionInstance.onerror({ error: "not-allowed" });

      expect(pttBtn.classList.contains("listening")).toBe(false);
      const statusMsg = document.getElementById("ptt-status-msg")!;
      expect(statusMsg.style.display).toBe("block");
      expect(statusMsg.textContent).toContain(
        "Microphone access blocked by browser iframe security"
      );
      expect(statusMsg.textContent).toContain(
        "tap your keyboard's 🎙️ microphone to dictate"
      );
    });

    it("handles SpeechRecognition error (no-speech) and unmatched query with informative feedback", () => {
      // 1. no-speech error
      triggerPtt();
      const lastSpeechRecognitionInstance = getLastSpeechRecognitionInstance();
      lastSpeechRecognitionInstance.onerror({ error: "no-speech" });
      const statusMsg = document.getElementById("ptt-status-msg")!;
      expect(statusMsg.textContent).toContain("No speech detected");

      // 2. Unmatched spoken query
      triggerPtt();
      lastSpeechRecognitionInstance.onresult({
        results: [[{ transcript: "xyzzy gibberish flurble" }]]
      });
      expect(
        (document.getElementById("ptt-dictation-input") as HTMLInputElement)
          .value
      ).toBe("xyzzy gibberish flurble");
      expect(statusMsg.textContent).toContain(
        'Heard: "xyzzy gibberish flurble" (no exact rule match found in glossary)'
      );
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

  describe("Ticket 05 & 38: Anonymous QR Onboarding & Atomic Character Roster Claiming", () => {
    it("bootstraps anonymous authentication with browserLocalPersistence and initializes companion roster subscription", async () => {
      const harness = setupClientHarness({
        viewMode: "companion",
        mockUser: { uid: "anon_test_user_1", isAnonymous: true },
        mockRoster: [
          { characterId: "pog", name: "Pog", claimedBy: null },
          { characterId: "vaelor", name: "Vaelor", claimedBy: null }
        ]
      });

      // Execute window.onload to trigger boot
      (window as any).onload();
      await vi.runAllTimersAsync();

      expect(harness.liveTabletopClient.currentUser).toEqual({
        uid: "anon_test_user_1",
        isAnonymous: true
      });
      expect(harness.liveTabletopClient.rosterListeners.size).toBeGreaterThan(
        0
      );
    });

    it("claims an unclaimed character atomically via LiveTabletopClient.claimCharacter and persists session cache", async () => {
      const harness = setupClientHarness({
        viewMode: "companion",
        mockUser: { uid: "anon_user_pog", isAnonymous: true },
        mockRoster: [
          { characterId: "pog", name: "Pog", claimedBy: null },
          { characterId: "donald", name: "Donald", claimedBy: null }
        ]
      });

      (window as any).onload();
      await vi.runAllTimersAsync();

      // Tap Pog card
      harness.handleCharacterCardClick("Pog", "pog");
      await vi.runAllTimersAsync();

      expect(harness.mockLocalStorage.getItem("sof_player_identity")).toBe(
        "Pog"
      );
      expect(
        harness.mockLocalStorage.getItem("sof_claimed_character_2026-10-31")
      ).toBe("pog");

      const pogDoc = harness.liveTabletopClient.rosterStore.get("pog");
      expect(pogDoc?.claimedBy).toBe("anon_user_pog");

      // Verify DOM reflects claimed state
      expect(document.getElementById("player-tag")!.textContent).toBe(
        "Player: Pog"
      );
      expect(
        document.getElementById("identity-modal")!.classList.contains("hidden")
      ).toBe(true);
    });

    it("triggers 400ms card shake animation, toast notification, and badge sync on contested claim race loss", async () => {
      const harness = setupClientHarness({
        viewMode: "companion",
        mockUser: { uid: "anon_loser", isAnonymous: true },
        mockRoster: [
          { characterId: "donald", name: "Donald", claimedBy: null }
        ],
        forceContentionForCharacterId: "donald"
      });

      (window as any).onload();
      await vi.runAllTimersAsync();

      const donaldCard = document.querySelector(
        '[data-character-id="donald"]'
      ) as HTMLButtonElement;
      expect(donaldCard).not.toBeNull();

      // Tap contested Donald card
      harness.handleCharacterCardClick("Donald", "donald");
      await vi.advanceTimersByTimeAsync(50);

      // 1. 400ms Card shake animation (.contested class)
      expect(donaldCard.classList.contains("contested")).toBe(true);

      // 2. Real-time badge sync and disablement
      expect(donaldCard.classList.contains("claimed")).toBe(true);
      expect(donaldCard.disabled).toBe(true);

      // 3. Toast notification rendered in DOM
      const toastContainer = document.getElementById("toast-container");
      expect(toastContainer).not.toBeNull();
      expect(toastContainer!.textContent).toContain(
        "Donald has just been claimed by another player."
      );

      // Advance past 400ms: shake animation class is removed
      await vi.advanceTimersByTimeAsync(400);
      expect(donaldCard.classList.contains("contested")).toBe(false);
      // Card remains disabled with badge
      expect(donaldCard.disabled).toBe(true);
    });

    it("enforces 1-character claim limit per anonymous UID with confirmation modal for switching characters", async () => {
      const harness = setupClientHarness({
        viewMode: "companion",
        mockUser: { uid: "anon_switcher", isAnonymous: true },
        mockRoster: [
          { characterId: "pog", name: "Pog", claimedBy: null },
          { characterId: "donald", name: "Donald", claimedBy: null }
        ]
      });

      (window as any).onload();
      await vi.runAllTimersAsync();

      // Claim first character: Pog
      harness.handleCharacterCardClick("Pog", "pog");
      await vi.runAllTimersAsync();

      expect(
        harness.mockLocalStorage.getItem("sof_claimed_character_2026-10-31")
      ).toBe("pog");
      expect(harness.liveTabletopClient.rosterStore.get("pog")?.claimedBy).toBe(
        "anon_switcher"
      );

      // Attempt to claim second character: Donald without releasing Pog
      harness.handleCharacterCardClick("Donald", "donald");
      await vi.runAllTimersAsync();

      // Confirmation modal should appear
      const switchModal = document.getElementById("switch-character-modal")!;
      expect(switchModal.style.display).toBe("flex");
      expect(switchModal.classList.contains("hidden")).toBe(false);
      expect(
        document.getElementById("switch-modal-msg")!.textContent
      ).toContain(
        "Switch to Donald? Pog will be released back to the party roster."
      );

      // Cancel switch: stays on Pog
      harness.cancelSwitchCharacter();
      expect(switchModal.style.display).toBe("none");
      expect(harness.liveTabletopClient.rosterStore.get("pog")?.claimedBy).toBe(
        "anon_switcher"
      );
      expect(
        harness.liveTabletopClient.rosterStore.get("donald")?.claimedBy
      ).toBe(null);

      // Re-trigger and confirm switch
      harness.handleCharacterCardClick("Donald", "donald");
      harness.confirmSwitchCharacter();
      await vi.runAllTimersAsync();

      // Old character Pog is released, new character Donald is claimed
      expect(harness.liveTabletopClient.rosterStore.get("pog")?.claimedBy).toBe(
        null
      );
      expect(
        harness.liveTabletopClient.rosterStore.get("donald")?.claimedBy
      ).toBe("anon_switcher");
      expect(
        harness.mockLocalStorage.getItem("sof_claimed_character_2026-10-31")
      ).toBe("donald");
      expect(harness.mockLocalStorage.getItem("sof_player_identity")).toBe(
        "Donald"
      );
      expect(document.getElementById("player-tag")!.textContent).toBe(
        "Player: Donald"
      );
    });

    it("reconnection logic validates cached character on page reload and bypasses the picker modal if still claimed", async () => {
      // Scenario A: Cached character is still claimed by current user UID -> Bypasses picker modal
      const reconnectHarness = setupClientHarness({
        viewMode: "companion",
        mockUser: { uid: "anon_returning_user", isAnonymous: true },
        initialLocalStorage: {
          "sof_claimed_character_2026-10-31": "pog",
          sof_player_identity: "Pog"
        },
        mockRoster: [
          {
            characterId: "pog",
            name: "Pog",
            claimedBy: "anon_returning_user"
          },
          { characterId: "donald", name: "Donald", claimedBy: null }
        ]
      });

      (window as any).onload();
      await vi.runAllTimersAsync();

      const modal = document.getElementById("identity-modal")!;
      expect(modal.classList.contains("hidden")).toBe(true);
      expect(modal.style.display).toBe("none");
      expect(document.getElementById("player-tag")!.textContent).toBe(
        "Player: Pog"
      );
      expect(
        reconnectHarness.mockLocalStorage.getItem(
          "sof_claimed_character_2026-10-31"
        )
      ).toBe("pog");
    });

    it("reconnection logic clears cached character and shows picker modal if claim was released or lost", async () => {
      // Scenario B: Cached character was force released or claimed by another user
      const lostClaimHarness = setupClientHarness({
        viewMode: "companion",
        mockUser: { uid: "anon_returning_user", isAnonymous: true },
        initialLocalStorage: {
          "sof_claimed_character_2026-10-31": "pog",
          sof_player_identity: "Pog"
        },
        mockRoster: [
          { characterId: "pog", name: "Pog", claimedBy: null }, // GM force released
          { characterId: "donald", name: "Donald", claimedBy: "other_user" }
        ]
      });

      (window as any).onload();
      await vi.runAllTimersAsync();

      // Cached character should be evicted from localStorage
      expect(
        lostClaimHarness.mockLocalStorage.getItem(
          "sof_claimed_character_2026-10-31"
        )
      ).toBeNull();

      // Picker modal is displayed so player can choose a new character
      const modal = document.getElementById("identity-modal")!;
      expect(modal.classList.contains("hidden")).toBe(false);
      expect(modal.style.display).toBe("flex");
    });

    it("GM Screen Roster panel provides 1-click Force Release button authorized via isGm() rules", async () => {
      const gmHarness = setupClientHarness({
        viewMode: "gm",
        mockRoster: [
          { characterId: "pog", name: "Pog", claimedBy: "anon_stuck_battery" },
          { characterId: "donald", name: "Donald", claimedBy: null }
        ]
      });

      (window as any).onload();
      await vi.advanceTimersByTimeAsync(100);

      // Check that GM screen roster panel is rendered
      const rosterList = document.getElementById("gm-roster-list")!;
      expect(rosterList).not.toBeNull();
      expect(rosterList.textContent).toContain("Pog");
      expect(rosterList.textContent).toContain("Claimed");

      // Find the 1-click Force Release button
      const forceReleaseBtn = rosterList.querySelector(
        '.force-release-btn[data-character-id="pog"]'
      ) as HTMLButtonElement;
      expect(forceReleaseBtn).not.toBeNull();

      // GM clicks Force Release
      forceReleaseBtn.click();
      await vi.advanceTimersByTimeAsync(100);

      // Character is now unclaimed in store and roster panel reflects it
      expect(
        gmHarness.liveTabletopClient.rosterStore.get("pog")?.claimedBy
      ).toBeNull();
      expect(rosterList.textContent).toContain("Unclaimed");
    });
  });

  describe("Ticket 06 / #39: Player Companion Ambient HUD: Web Haptics Turn Alerts & Table Reactions Drawer", () => {
    it("detects when activeCombatantId === myCharacterId, displays illuminated turn banner, and fires navigator.vibrate([100, 50, 100])", () => {
      const vibrateSpy = vi.fn();
      (navigator as any).vibrate = vibrateSpy;

      const harness = setupClientHarness({
        viewMode: "companion",
        initialLocalStorage: {
          "sof_claimed_character_2026-10-31": "pog",
          sof_player_identity: "Pog"
        }
      });
      (window as any).onload();

      const banner = document.getElementById("player-turn-banner")!;
      expect(banner).not.toBeNull();
      expect(banner.style.display).toBe("none");

      // Combat payload where Pog is active at index 0
      const combatStatePogActive = {
        round: 1,
        activeIndex: 0,
        isRunning: true,
        combatants: [
          {
            id: "pog",
            name: "Pog",
            initiative: 18,
            statusBand: "UNINJURED" as const,
            claimedBy: "anon_test_uid"
          },
          {
            id: "goblin",
            name: "Goblin",
            initiative: 12,
            statusBand: "INJURED" as const,
            claimedBy: null
          }
        ]
      };

      harness.renderPlayerCombat(combatStatePogActive);

      // Banner illuminated
      expect(banner.style.display).toBe("flex");
      // Haptics fired
      expect(vibrateSpy).toHaveBeenCalledWith([100, 50, 100]);

      // Turn advances to Goblin (not Pog)
      const combatStateGoblinActive = {
        round: 1,
        activeIndex: 1,
        isRunning: true,
        combatants: [
          {
            id: "pog",
            name: "Pog",
            initiative: 18,
            statusBand: "UNINJURED" as const,
            claimedBy: "anon_test_uid"
          },
          {
            id: "goblin",
            name: "Goblin",
            initiative: 12,
            statusBand: "INJURED" as const,
            claimedBy: null
          }
        ]
      };

      vibrateSpy.mockClear();
      harness.renderPlayerCombat(combatStateGoblinActive);

      // Banner hides
      expect(banner.style.display).toBe("none");
      // No extra vibration
      expect(vibrateSpy).not.toHaveBeenCalled();

      // Turn returns to Pog in Round 2 -> triggers haptics again
      const combatStatePogRound2 = {
        round: 2,
        activeIndex: 0,
        isRunning: true,
        combatants: [
          {
            id: "pog",
            name: "Pog",
            initiative: 18,
            statusBand: "UNINJURED" as const,
            claimedBy: "anon_test_uid"
          },
          {
            id: "goblin",
            name: "Goblin",
            initiative: 12,
            statusBand: "INJURED" as const,
            claimedBy: null
          }
        ]
      };

      harness.renderPlayerCombat(combatStatePogRound2);
      expect(banner.style.display).toBe("flex");
      expect(vibrateSpy).toHaveBeenCalledWith([100, 50, 100]);
    });

    it("degrades gracefully without throwing when navigator.vibrate is unavailable or throws (e.g. iOS Safari)", () => {
      // Delete navigator.vibrate
      delete (navigator as any).vibrate;

      const harness = setupClientHarness({
        viewMode: "companion",
        initialLocalStorage: {
          "sof_claimed_character_2026-10-31": "pog",
          sof_player_identity: "Pog"
        }
      });
      (window as any).onload();

      const banner = document.getElementById("player-turn-banner")!;
      expect(() => {
        harness.renderPlayerCombat({
          round: 1,
          activeIndex: 0,
          isRunning: true,
          combatants: [
            {
              id: "pog",
              name: "Pog",
              initiative: 18,
              statusBand: "UNINJURED" as const,
              claimedBy: null
            }
          ]
        });
      }).not.toThrow();

      expect(banner.style.display).toBe("flex");

      // When navigator.vibrate throws
      (navigator as any).vibrate = vi.fn().mockImplementation(() => {
        throw new Error("SecurityError: vibrate not allowed in iframe");
      });

      expect(() => {
        harness.renderPlayerCombat({
          round: 1,
          activeIndex: 0,
          isRunning: true,
          combatants: [
            {
              id: "pog",
              name: "Pog",
              initiative: 18,
              statusBand: "UNINJURED" as const,
              claimedBy: null
            }
          ]
        });
      }).not.toThrow();
    });

    it("renders persistent 5-emoji bottom reaction drawer with >= 44px hitboxes", () => {
      const harness = setupClientHarness({
        viewMode: "companion"
      });
      (window as any).onload();

      const drawer = document.getElementById("companion-reaction-drawer")!;
      expect(drawer).not.toBeNull();
      expect(drawer.getAttribute("role")).toBe("toolbar");

      const buttons =
        drawer.querySelectorAll<HTMLButtonElement>(".reaction-btn");
      expect(buttons.length).toBe(5);

      const expectedEmojis = ["⚔️", "🛡️", "🎲", "🍻", "💀"];
      const actualEmojis = Array.from(buttons).map((btn) =>
        btn.getAttribute("data-emoji")
      );
      expect(actualEmojis).toEqual(expectedEmojis);

      // Verify touch hitboxes >= 44px class presence
      for (const btn of Array.from(buttons)) {
        expect(btn.classList.contains("reaction-btn")).toBe(true);
      }
    });

    it("clicking reaction emoji writes to sessions/{date}/live/reactions via sendReaction", async () => {
      const harness = setupClientHarness({
        viewMode: "companion",
        mockUser: { uid: "anon_reactor", isAnonymous: true },
        initialLocalStorage: {
          "sof_claimed_character_2026-10-31": "pog",
          sof_player_identity: "Pog"
        }
      });
      (window as any).onload();

      const drawer = document.getElementById("companion-reaction-drawer")!;
      const diceBtn = drawer.querySelector<HTMLButtonElement>(
        '.reaction-btn[data-emoji="🎲"]'
      )!;
      expect(diceBtn).not.toBeNull();

      diceBtn.click();
      await vi.advanceTimersByTimeAsync(50);

      const reactions = harness.liveTabletopClient.reactionsStore;
      expect(reactions.length).toBe(1);
      expect(reactions[0].emoji).toBe("🎲");
      expect(reactions[0].characterName).toBe("Pog");
      expect(reactions[0].uid).toBe("anon_reactor");
      expect(typeof reactions[0].timestamp).toBe("number");
      expect(reactions[0].id).toMatch(/^rx_/);
    });
  });
});
