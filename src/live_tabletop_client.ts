import {
  initializeApp,
  getApps,
  type FirebaseApp,
  type FirebaseOptions
} from "firebase/app";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  collection,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  type Firestore,
  type Unsubscribe,
  type DocumentData
} from "firebase/firestore";
import {
  getAuth,
  signInAnonymously,
  type Auth,
  type User
} from "firebase/auth";

export const FIRESTORE_CACHE_SIZE_BYTES = 104857600; // 100 MB dedicated LRU cache

export interface AudioCuePayload {
  trackTitle?: string;
  ducking?: boolean;
  duckingGain?: number;
  duckingDurationMs?: number;
  confidence?: number;
  speechChunkId?: string;
}

export interface AudioCueDocument {
  intent: "MUSIC_CUE" | "RULE_QUERY" | "SFX" | "TABLE_BANTER";
  mood:
    | "exploration"
    | "combat"
    | "tension"
    | "rest"
    | "port_town"
    | "tavern"
    | "seafaring";
  rule?: string | null;
  triggeredAt?: any;
  source: "pi_vad_tier1" | "gemini_tier2" | "gm_manual_tier3" | "companion_ptt";
  payload?: AudioCuePayload;
}

export interface CombatantState {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  initiative: number;
  status:
    | "active"
    | "downed"
    | "concentrating"
    | "stunned"
    | "paralyzed"
    | "unconscious"
    | "dead";
  claimedBy: string | null;
  isPlayerVisible: boolean;
}

export interface CombatDocument {
  round: number;
  activeIndex: number;
  combatants: CombatantState[];
  isRunning: boolean;
  updatedAt?: any;
}

export interface TableReaction {
  id: string;
  uid: string;
  characterName: string;
  emoji: string;
  timestamp: number;
}

export interface ReactionsDocument {
  recentReactions: TableReaction[];
  updatedAt?: any;
}

export interface CharacterRosterDoc {
  name: string;
  characterId: string;
  claimedBy: string | null;
  claimedAt?: any;
  color?: string;
  avatarUrl?: string;
}

export interface RuleFeedbackDoc {
  ruleId: string;
  isHelpful: boolean;
  authorUid: string;
  timestamp: any;
  notes?: string;
  sessionDate?: string;
}

export interface LiveTabletopClientOptions {
  firebaseConfig?: FirebaseOptions;
  firestore?: Firestore;
  auth?: Auth;
  appName?: string;
  cacheSizeBytes?: number;
}

/**
 * LiveTabletopClient encapsulates the Firebase Modular Web SDK v11 foundation,
 * multi-tab persistentLocalCache, authentication, and real-time tabletop pub/sub.
 */
export class LiveTabletopClient {
  private readonly app: FirebaseApp;
  private readonly db: Firestore;
  private readonly auth: Auth;
  private readonly activeUnsubscribes: Set<Unsubscribe> = new Set();

  constructor(options: LiveTabletopClientOptions = {}) {
    if (options.firestore && options.auth) {
      this.db = options.firestore;
      this.auth = options.auth;
      this.app = options.firestore.app;
      return;
    }

    const appName = options.appName || "[DEFAULT]";
    const existingApps = getApps();
    const existing = existingApps.find((a) => a.name === appName);

    if (existing) {
      this.app = existing;
    } else {
      const config = options.firebaseConfig || {
        apiKey: "demo-api-key",
        authDomain: "sea-of-fortune-gm.firebaseapp.com",
        projectId: "sof-gm-screen",
        storageBucket: "sof-gm-screen.firebasestorage.app",
        messagingSenderId: "1234567890",
        appId: "1:1234567890:web:abcdef123456"
      };
      this.app = initializeApp(
        config,
        appName === "[DEFAULT]" ? undefined : appName
      );
    }

    if (options.firestore) {
      this.db = options.firestore;
    } else {
      try {
        this.db = initializeFirestore(this.app, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
            cacheSizeBytes: options.cacheSizeBytes ?? FIRESTORE_CACHE_SIZE_BYTES
          })
        });
      } catch {
        // Fallback if Firestore has already been initialized on this app instance
        this.db = getFirestore(this.app);
      }
    }

    this.auth = options.auth || getAuth(this.app);
    void this.ensurePersistentStorage();
  }

  /**
   * Requests persistent storage to prevent browser eviction of IndexedDB under memory pressure.
   */
  public async ensurePersistentStorage(): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      try {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
          return await navigator.storage.persist();
        }
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  public getFirestore(): Firestore {
    return this.db;
  }

  public getAuth(): Auth {
    return this.auth;
  }

  public async signInAnonymously(): Promise<User> {
    const cred = await signInAnonymously(this.auth);
    return cred.user;
  }

  public getCurrentUser(): User | null {
    return this.auth.currentUser;
  }

  /**
   * Subscribes to live Audio Cue transitions.
   */
  public subscribeToAudioCue(
    sessionDate: string,
    callback: (cue: AudioCueDocument | null) => void,
    onError?: (err: Error) => void
  ): Unsubscribe {
    const cueDocRef = doc(this.db, `sessions/${sessionDate}/live/audio_cue`);
    const unsub = onSnapshot(
      cueDocRef,
      (snap) => {
        callback(snap.exists() ? (snap.data() as AudioCueDocument) : null);
      },
      onError
    );
    this.activeUnsubscribes.add(unsub);
    return () => {
      this.activeUnsubscribes.delete(unsub);
      unsub();
    };
  }

  /**
   * Subscribes to public Combat state projections.
   */
  public subscribeToCombat(
    sessionDate: string,
    callback: (combat: CombatDocument | null) => void,
    onError?: (err: Error) => void
  ): Unsubscribe {
    const combatDocRef = doc(this.db, `sessions/${sessionDate}/live/combat`);
    const unsub = onSnapshot(
      combatDocRef,
      (snap) => {
        callback(snap.exists() ? (snap.data() as CombatDocument) : null);
      },
      onError
    );
    this.activeUnsubscribes.add(unsub);
    return () => {
      this.activeUnsubscribes.delete(unsub);
      unsub();
    };
  }

  /**
   * Subscribes to the live ephemeral reactions stream.
   */
  public subscribeToReactions(
    sessionDate: string,
    callback: (reactions: ReactionsDocument | null) => void,
    onError?: (err: Error) => void
  ): Unsubscribe {
    const reactionsDocRef = doc(
      this.db,
      `sessions/${sessionDate}/live/reactions`
    );
    const unsub = onSnapshot(
      reactionsDocRef,
      (snap) => {
        callback(snap.exists() ? (snap.data() as ReactionsDocument) : null);
      },
      onError
    );
    this.activeUnsubscribes.add(unsub);
    return () => {
      this.activeUnsubscribes.delete(unsub);
      unsub();
    };
  }

  /**
   * Subscribes to Character Roster updates for a session.
   */
  public subscribeToRoster(
    sessionDate: string,
    callback: (roster: CharacterRosterDoc[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe {
    const rosterColRef = collection(this.db, `sessions/${sessionDate}/roster`);
    const unsub = onSnapshot(
      rosterColRef,
      (snap) => {
        const docs = snap.docs.map((d) => ({
          characterId: d.id,
          ...(d.data() as DocumentData)
        })) as CharacterRosterDoc[];
        callback(docs);
      },
      onError
    );
    this.activeUnsubscribes.add(unsub);
    return () => {
      this.activeUnsubscribes.delete(unsub);
      unsub();
    };
  }

  /**
   * Publishes or overwrites the active audio cue (GM or Edge writer).
   */
  public async publishAudioCue(
    sessionDate: string,
    cue: AudioCueDocument
  ): Promise<void> {
    const cueDocRef = doc(this.db, `sessions/${sessionDate}/live/audio_cue`);
    await setDoc(cueDocRef, {
      ...cue,
      triggeredAt: cue.triggeredAt ?? serverTimestamp()
    });
  }

  /**
   * Updates tactical combat state projection (GM only).
   */
  public async updateCombat(
    sessionDate: string,
    combat: Partial<CombatDocument>
  ): Promise<void> {
    const combatDocRef = doc(this.db, `sessions/${sessionDate}/live/combat`);
    await updateDoc(combatDocRef, {
      ...combat,
      updatedAt: serverTimestamp()
    });
  }

  /**
   * Sends an ephemeral table reaction, bounding recentReactions to max 20 items.
   */
  public async sendReaction(
    sessionDate: string,
    reaction: TableReaction
  ): Promise<void> {
    const reactionsDocRef = doc(
      this.db,
      `sessions/${sessionDate}/live/reactions`
    );
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(reactionsDocRef);
      const existing = snap.exists()
        ? (snap.data() as ReactionsDocument).recentReactions || []
        : [];
      const MAX_REACTIONS = 20;
      const updated = [...existing.slice(-(MAX_REACTIONS - 1)), reaction];
      tx.set(
        reactionsDocRef,
        {
          recentReactions: updated,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    });
  }

  /**
   * Claims an unclaimed character on the session roster.
   */
  public async claimCharacter(
    sessionDate: string,
    characterId: string,
    uid: string
  ): Promise<void> {
    const charDocRef = doc(
      this.db,
      `sessions/${sessionDate}/roster/${characterId}`
    );
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(charDocRef);
      if (!snap.exists()) {
        throw new Error(`Character ${characterId} does not exist in roster.`);
      }
      const data = snap.data() as CharacterRosterDoc;
      if (data.claimedBy && data.claimedBy !== uid) {
        throw new Error(
          `Character ${characterId} is already claimed by ${data.claimedBy}.`
        );
      }
      tx.update(charDocRef, {
        claimedBy: uid,
        claimedAt: serverTimestamp()
      });
    });
  }

  /**
   * Releases an owned character claim on the session roster.
   */
  public async releaseCharacter(
    sessionDate: string,
    characterId: string,
    uid: string
  ): Promise<void> {
    const charDocRef = doc(
      this.db,
      `sessions/${sessionDate}/roster/${characterId}`
    );
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(charDocRef);
      if (!snap.exists()) {
        throw new Error(`Character ${characterId} does not exist in roster.`);
      }
      const data = snap.data() as CharacterRosterDoc;
      if (data.claimedBy !== uid) {
        throw new Error(
          `Cannot release claim for character ${characterId}: claimedBy does not match.`
        );
      }
      tx.update(charDocRef, {
        claimedBy: null,
        claimedAt: serverTimestamp()
      });
    });
  }

  /**
   * Submits player feedback on a 5e rule card.
   */
  public async submitRuleFeedback(feedback: RuleFeedbackDoc): Promise<string> {
    const feedbackColRef = collection(this.db, "rules_feedback");
    const docRef = await addDoc(feedbackColRef, {
      ...feedback,
      timestamp: feedback.timestamp ?? serverTimestamp()
    });
    return docRef.id;
  }

  /**
   * Unsubscribes all active listeners managed by this client instance.
   */
  public unsubscribeAll(): void {
    for (const unsub of this.activeUnsubscribes) {
      try {
        unsub();
      } catch {
        // Ignore unsubscription errors on teardown
      }
    }
    this.activeUnsubscribes.clear();
  }

  /**
   * Cleans up all listeners and resources.
   */
  public destroy(): void {
    this.unsubscribeAll();
  }
}
