import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  RulesTestEnvironment,
  assertSucceeds,
  assertFails
} from "./helpers/rules-mock-runner";
import { LiveTabletopClient } from "../src/live_tabletop_client";

describe("Cloud Firestore Security Rules & Access Boundary Suite (SEC-01 - SEC-12)", () => {
  let testEnv: RulesTestEnvironment;
  const SESSION_DATE = "2026-11-20";

  beforeEach(async () => {
    testEnv = new RulesTestEnvironment("firestore.rules");
    await testEnv.clearFirestore();

    // Pre-seed baseline documents via administrative bypass
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // Pre-seed GM secret manifest
      await db
        .doc(`sessions/${SESSION_DATE}/manifest_gm/encounter_dossier`)
        .set({
          title: "Sahuagin Lair GM Notes",
          secretBossStats: { hp: 120, ac: 16 }
        });

      // Pre-seed public manifest
      await db.doc(`sessions/${SESSION_DATE}/manifest/floor_map`).set({
        title: "Sunken Temple Map",
        mapUrl: "https://example.com/map.jpg"
      });

      // Pre-seed combat_gm secret state (hidden ambush monsters)
      await db.doc(`sessions/${SESSION_DATE}/live/combat_gm`).set({
        round: 1,
        activeIndex: 0,
        combatants: [
          { id: "c1", name: "Pog", hp: 45, maxHp: 45, isPlayerVisible: true },
          {
            id: "c2",
            name: "Hidden Assassin",
            hp: 80,
            maxHp: 80,
            isPlayerVisible: false
          }
        ]
      });

      // Pre-seed public combat state
      await db.doc(`sessions/${SESSION_DATE}/live/combat`).set({
        round: 1,
        activeIndex: 0,
        combatants: [
          { id: "c1", name: "Pog", hp: 45, maxHp: 45, isPlayerVisible: true }
        ],
        isRunning: true
      });

      // Pre-seed roster character (unclaimed)
      await db.doc(`sessions/${SESSION_DATE}/roster/pog`).set({
        name: "Pog",
        characterId: "pog",
        claimedBy: null,
        claimedAt: null,
        color: "#4a90e2",
        avatarUrl: "https://example.com/pog.png"
      });

      // Pre-seed roster character (already claimed by player_1)
      await db.doc(`sessions/${SESSION_DATE}/roster/donald`).set({
        name: "Donald",
        characterId: "donald",
        claimedBy: "player_1",
        claimedAt: 1000,
        color: "#50e3c2",
        avatarUrl: "https://example.com/donald.png"
      });

      // Pre-seed live reactions
      await db.doc(`sessions/${SESSION_DATE}/live/reactions`).set({
        recentReactions: [],
        updatedAt: 1000
      });

      // Pre-seed rules glossary
      await db.doc("rules_glossary/grappled").set({
        term: "Grappled",
        description: "Speed becomes 0."
      });
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  it("SEC-01: Anonymous Player cannot read manifest_gm private encounter notes", async () => {
    const anon = testEnv.authenticatedContext("player_anon_1", {
      firebase: { sign_in_provider: "anonymous" }
    });
    const db = anon.firestore();
    const docRef = db.doc(
      `sessions/${SESSION_DATE}/manifest_gm/encounter_dossier`
    );

    await assertFails(docRef.get());
  });

  it("SEC-02: Game Master can read manifest_gm private encounter notes", async () => {
    // Authenticate as GM with custom claim { gm: true }
    const gm = testEnv.authenticatedContext("gm_user_1", { gm: true });
    const db = gm.firestore();
    const docRef = db.doc(
      `sessions/${SESSION_DATE}/manifest_gm/encounter_dossier`
    );

    const snap = await assertSucceeds(docRef.get());
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.title).toBe("Sahuagin Lair GM Notes");
  });

  it("SEC-02 (Fallback): Verified GM email can read manifest_gm private encounter notes", async () => {
    // Authenticate as bootstrap GM with verified email
    const gmEmail = testEnv.authenticatedContext("gm_user_email", {
      email: "wryenmeek@gmail.com",
      email_verified: true
    });
    const snap = await assertSucceeds(
      gmEmail
        .firestore()
        .doc(`sessions/${SESSION_DATE}/manifest_gm/encounter_dossier`)
        .get()
    );
    expect(snap.exists()).toBe(true);
  });

  it("SEC-03: Anonymous Player cannot read live/combat_gm hidden ambush monster doc", async () => {
    const anon = testEnv.authenticatedContext("player_anon_2", {
      firebase: { sign_in_provider: "anonymous" }
    });
    const db = anon.firestore();
    const docRef = db.doc(`sessions/${SESSION_DATE}/live/combat_gm`);

    await assertFails(docRef.get());
  });

  it("SEC-04: Anonymous Player can read live/combat visible combat projection", async () => {
    const anon = testEnv.authenticatedContext("player_anon_3", {
      firebase: { sign_in_provider: "anonymous" }
    });
    const db = anon.firestore();
    const docRef = db.doc(`sessions/${SESSION_DATE}/live/combat`);

    const snap = await assertSucceeds(docRef.get());
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.round).toBe(1);
    expect(snap.data()?.combatants.length).toBe(1);
  });

  it("SEC-05: Anonymous Player cannot write live/combat (initiative or HP manipulation)", async () => {
    const anon = testEnv.authenticatedContext("player_anon_4", {
      firebase: { sign_in_provider: "anonymous" }
    });
    const db = anon.firestore();
    const docRef = db.doc(`sessions/${SESSION_DATE}/live/combat`);

    await assertFails(
      docRef.update({
        round: 2,
        activeIndex: 1
      })
    );
  });

  it("SEC-06: Game Master can write live/combat (advance turn index)", async () => {
    const gm = testEnv.authenticatedContext("gm_user_1", { gm: true });
    const db = gm.firestore();
    const docRef = db.doc(`sessions/${SESSION_DATE}/live/combat`);

    await assertSucceeds(
      docRef.update({
        round: 2,
        activeIndex: 1
      })
    );

    const snap = await docRef.get();
    expect(snap.data()?.round).toBe(2);
    expect(snap.data()?.activeIndex).toBe(1);
  });

  it("SEC-07: Anonymous Player can claim an unclaimed character (roster/pog)", async () => {
    const player1 = testEnv.authenticatedContext("player_1", {
      firebase: { sign_in_provider: "anonymous" }
    });
    const db = player1.firestore();
    const docRef = db.doc(`sessions/${SESSION_DATE}/roster/pog`);

    await assertSucceeds(
      docRef.update({
        claimedBy: "player_1",
        claimedAt: 2000
      })
    );

    const snap = await docRef.get();
    expect(snap.data()?.claimedBy).toBe("player_1");
  });

  it("SEC-08: Anonymous Player 2 cannot claim an already-claimed character (prevent claim theft)", async () => {
    // Character 'donald' is pre-seeded with claimedBy: "player_1"
    const player2 = testEnv.authenticatedContext("player_2", {
      firebase: { sign_in_provider: "anonymous" }
    });
    const db = player2.firestore();
    const docRef = db.doc(`sessions/${SESSION_DATE}/roster/donald`);

    await assertFails(
      docRef.update({
        claimedBy: "player_2",
        claimedAt: 2000
      })
    );
  });

  it("SEC-09: Claim owner can release their owned character claim", async () => {
    // 'donald' is claimed by 'player_1'
    const player1 = testEnv.authenticatedContext("player_1", {
      firebase: { sign_in_provider: "anonymous" }
    });
    const db = player1.firestore();
    const docRef = db.doc(`sessions/${SESSION_DATE}/roster/donald`);

    await assertSucceeds(
      docRef.update({
        claimedBy: null,
        claimedAt: 2500
      })
    );

    const snap = await docRef.get();
    expect(snap.data()?.claimedBy).toBe(null);
  });

  it("SEC-10: Anonymous Player can append a valid reaction to live/reactions", async () => {
    const player1 = testEnv.authenticatedContext("player_1", {
      firebase: { sign_in_provider: "anonymous" }
    });
    const db = player1.firestore();
    const docRef = db.doc(`sessions/${SESSION_DATE}/live/reactions`);

    const validReaction = {
      id: "rx_1",
      uid: "player_1",
      characterName: "Pog",
      emoji: "⚔️",
      timestamp: 3000
    };

    await assertSucceeds(
      docRef.update({
        recentReactions: [validReaction],
        updatedAt: 3000
      })
    );
  });

  it("SEC-11: Anonymous Player cannot write reaction with another player's UID", async () => {
    const player1 = testEnv.authenticatedContext("player_1", {
      firebase: { sign_in_provider: "anonymous" }
    });
    const db = player1.firestore();
    const docRef = db.doc(`sessions/${SESSION_DATE}/live/reactions`);

    // Spoofed reaction has uid: "player_2" but request is authenticated as "player_1"
    const spoofedReaction = {
      id: "rx_spoofed",
      uid: "player_2",
      characterName: "Donald",
      emoji: "🎲",
      timestamp: 3000
    };

    await assertFails(
      docRef.update({
        recentReactions: [spoofedReaction],
        updatedAt: 3000
      })
    );
  });

  it("SEC-12: Anonymous Player can submit valid Rule Card feedback", async () => {
    const player1 = testEnv.authenticatedContext("player_1", {
      firebase: { sign_in_provider: "anonymous" }
    });
    const db = player1.firestore();
    const feedbackRef = db.collection("rules_feedback").doc("fb_101");

    await assertSucceeds(
      feedbackRef.set({
        ruleId: "grappled",
        isHelpful: true,
        authorUid: "player_1",
        timestamp: 4000,
        notes: "Great quick explanation!",
        sessionDate: "2026-11-20"
      })
    );
  });

  describe("Additional Security Boundary Invariants", () => {
    it("denies unauthenticated read of live/combat", async () => {
      const unauth = testEnv.unauthenticatedContext();
      await assertFails(
        unauth.firestore().doc(`sessions/${SESSION_DATE}/live/combat`).get()
      );
    });

    it("allows public unauthenticated read of rules_glossary", async () => {
      const unauth = testEnv.unauthenticatedContext();
      const snap = await assertSucceeds(
        unauth.firestore().doc("rules_glossary/grappled").get()
      );
      expect(snap.exists()).toBe(true);
      expect(snap.data()?.term).toBe("Grappled");
    });

    it("denies anonymous player write to rules_glossary", async () => {
      const anon = testEnv.authenticatedContext("player_anon", {
        firebase: { sign_in_provider: "anonymous" }
      });
      await assertFails(
        anon.firestore().doc("rules_glossary/grappled").set({
          term: "Grappled",
          description: "Tampered by player"
        })
      );
    });

    it("denies tampering with character fields other than claimedBy/claimedAt", async () => {
      const player1 = testEnv.authenticatedContext("player_1", {
        firebase: { sign_in_provider: "anonymous" }
      });
      const docRef = player1
        .firestore()
        .doc(`sessions/${SESSION_DATE}/roster/pog`);

      // Attempt to tamper with name/color during claim
      await assertFails(
        docRef.update({
          name: "Super Pog",
          claimedBy: "player_1",
          claimedAt: 5000
        })
      );
    });

    it("denies non-owner from releasing another player's claim", async () => {
      // 'donald' is claimed by 'player_1'
      const player2 = testEnv.authenticatedContext("player_2", {
        firebase: { sign_in_provider: "anonymous" }
      });
      const docRef = player2
        .firestore()
        .doc(`sessions/${SESSION_DATE}/roster/donald`);

      await assertFails(
        docRef.update({
          claimedBy: null,
          claimedAt: 5000
        })
      );
    });

    it("denies reactions list exceeding 20 items", async () => {
      const player1 = testEnv.authenticatedContext("player_1", {
        firebase: { sign_in_provider: "anonymous" }
      });
      const docRef = player1
        .firestore()
        .doc(`sessions/${SESSION_DATE}/live/reactions`);

      const overflowReactions = Array.from({ length: 21 }, (_, i) => ({
        id: `rx_${i}`,
        uid: "player_1",
        characterName: "Pog",
        emoji: "⚔️",
        timestamp: 1000 + i
      }));

      await assertFails(
        docRef.update({
          recentReactions: overflowReactions,
          updatedAt: 6000
        })
      );
    });

    it("denies feedback submission with mismatched authorUid", async () => {
      const player1 = testEnv.authenticatedContext("player_1", {
        firebase: { sign_in_provider: "anonymous" }
      });
      const feedbackRef = player1
        .firestore()
        .collection("rules_feedback")
        .doc("fb_spoof");

      await assertFails(
        feedbackRef.set({
          ruleId: "grappled",
          isHelpful: true,
          authorUid: "player_victim",
          timestamp: 7000
        })
      );
    });
  });

  describe("LiveTabletopClient Interface Depth & Encapsulation", () => {
    it("instantiates cleanly and encapsulates SDK initialization", async () => {
      const client = new LiveTabletopClient({
        appName: "test-client-app"
      });

      expect(client).toBeDefined();
      expect(typeof client.subscribeToAudioCue).toBe("function");
      expect(typeof client.subscribeToCombat).toBe("function");
      expect(typeof client.subscribeToReactions).toBe("function");
      expect(typeof client.subscribeToRoster).toBe("function");
      expect(typeof client.publishAudioCue).toBe("function");
      expect(typeof client.updateCombat).toBe("function");
      expect(typeof client.sendReaction).toBe("function");
      expect(typeof client.claimCharacter).toBe("function");
      expect(typeof client.releaseCharacter).toBe("function");
      expect(typeof client.submitRuleFeedback).toBe("function");
      expect(typeof client.destroy).toBe("function");

      client.destroy();
    });
  });
});
