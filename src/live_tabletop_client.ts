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

export type CombatStatusBand =
  "UNINJURED" | "INJURED" | "BLOODIED" | "CRITICAL" | "DOWN";

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
  statusBand?: CombatStatusBand;
  notes?: string;
}

export interface PublicCombatantState {
  id: string;
  name: string;
  initiative: number;
  statusBand: CombatStatusBand;
  status?:
    | "active"
    | "downed"
    | "concentrating"
    | "stunned"
    | "paralyzed"
    | "unconscious"
    | "dead"
    | string;
  claimedBy: string | null;
  hp?: number;
  maxHp?: number;
  isPlayerVisible?: boolean;
}

export interface CombatGmDocument {
  round: number;
  activeIndex: number;
  combatants: CombatantState[];
  isRunning: boolean;
  updatedAt?: any;
}

export interface PublicCombatDocument {
  round?: number;
  activeIndex?: number;
  combatants?: PublicCombatantState[];
  isRunning?: boolean;
  updatedAt?: any;
}

export interface CombatDocument {
  round: number;
  activeIndex: number;
  combatants: (PublicCombatantState | CombatantState)[];
  isRunning: boolean;
  updatedAt?: any;
}

/**
 * Calculates the descriptive 5e status band based on current and maximum HP.
 * UNINJURED (100%), INJURED (50-99%), BLOODIED (25-49%), CRITICAL (1-24%), DOWN (<=0).
 */
export function calculateStatusBand(
  hp: number,
  maxHp: number
): CombatStatusBand {
  if (hp <= 0) return "DOWN";
  if (maxHp <= 0) return "UNINJURED";
  const ratio = hp / maxHp;
  if (ratio < 0.25) return "CRITICAL";
  if (ratio < 0.5) return "BLOODIED";
  if (ratio < 1.0) return "INJURED";
  return "UNINJURED";
}

/**
 * Transforms private GM combat state into a player-safe public projection.
 * Filters out unrevealed ambush monsters (isPlayerVisible === false),
 * converts raw hit points into status bands, masks secret stats (AC/HP),
 * and adjusts activeIndex if the current turn belongs to a hidden monster.
 */
export function projectCombatPublic(
  combatGm: Partial<CombatGmDocument> | Partial<CombatDocument>
): PublicCombatDocument {
  const result: PublicCombatDocument = {};
  if (typeof combatGm.round === "number") {
    result.round = combatGm.round;
  }
  if (typeof combatGm.isRunning === "boolean") {
    result.isRunning = combatGm.isRunning;
  }
  if (combatGm.updatedAt !== undefined) {
    result.updatedAt = combatGm.updatedAt;
  }

  if (Array.isArray(combatGm.combatants)) {
    const visibleCombatants = combatGm.combatants.filter(
      (c) => c.isPlayerVisible !== false
    );

    let activeIndex =
      typeof combatGm.activeIndex === "number" ? combatGm.activeIndex : -1;
    if (activeIndex >= 0 && activeIndex < combatGm.combatants.length) {
      const activeCombatant = combatGm.combatants[activeIndex];
      if (activeCombatant && activeCombatant.isPlayerVisible === false) {
        // Active turn is hidden from players
        activeIndex = -1;
      } else if (activeCombatant) {
        activeIndex = visibleCombatants.findIndex(
          (c) => c.id === activeCombatant.id
        );
      }
    }
    result.activeIndex = activeIndex;

    result.combatants = visibleCombatants.map((c) => {
      const maxHp = typeof c.maxHp === "number" ? c.maxHp : (c.hp ?? 0);
      const hp = typeof c.hp === "number" ? c.hp : maxHp;
      return {
        id: c.id,
        name: c.name,
        initiative: c.initiative ?? 0,
        statusBand: calculateStatusBand(hp, maxHp),
        status: c.status,
        claimedBy: c.claimedBy ?? null,
        isPlayerVisible: true
      };
    });
  } else if (typeof combatGm.activeIndex === "number") {
    result.activeIndex = combatGm.activeIndex;
  }

  return result;
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

  private async setDocument(
    path: string,
    data: Record<string, any>,
    options: { merge?: boolean } = {}
  ): Promise<void> {
    if (typeof (this.db as any).doc === "function") {
      const dRef = (this.db as any).doc(path);
      if (typeof dRef.set === "function") {
        await dRef.set(data, options);
        return;
      }
    }
    const docRef = doc(this.db, path);
    await setDoc(docRef, data, options);
  }

  /**
   * Subscribes to private GM Combat state document (sessions/{date}/live/combat_gm).
   */
  public subscribeToCombatGm(
    sessionDate: string,
    callback: (combat: CombatGmDocument | null) => void,
    onError?: (err: Error) => void
  ): Unsubscribe {
    const path = `sessions/${sessionDate}/live/combat_gm`;
    if (typeof (this.db as any).doc === "function") {
      const dRef = (this.db as any).doc(path);
      if (typeof dRef.onSnapshot === "function") {
        const unsub = dRef.onSnapshot(
          (snap: any) =>
            callback(snap.exists() ? (snap.data() as CombatGmDocument) : null),
          onError
        );
        this.activeUnsubscribes.add(unsub);
        return () => {
          this.activeUnsubscribes.delete(unsub);
          unsub();
        };
      }
    }
    const combatGmDocRef = doc(this.db, path);
    const unsub = onSnapshot(
      combatGmDocRef,
      (snap) => {
        callback(snap.exists() ? (snap.data() as CombatGmDocument) : null);
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
    const path = `sessions/${sessionDate}/live/combat`;
    if (typeof (this.db as any).doc === "function") {
      const dRef = (this.db as any).doc(path);
      if (typeof dRef.onSnapshot === "function") {
        const unsub = dRef.onSnapshot(
          (snap: any) =>
            callback(snap.exists() ? (snap.data() as CombatDocument) : null),
          onError
        );
        this.activeUnsubscribes.add(unsub);
        return () => {
          this.activeUnsubscribes.delete(unsub);
          unsub();
        };
      }
    }
    const combatDocRef = doc(this.db, path);
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
   * Updates tactical combat state partitioned between private GM data and public projection (GM only).
   * Writes raw combat data (including hidden ambush monsters, exact HP, AC) to combat_gm,
   * automatically computes the public projection with status bands and hidden monster filtering,
   * and publishes the projection to combat.
   */
  public async updateCombat(
    sessionDate: string,
    combat: Partial<CombatGmDocument> | Partial<CombatDocument>
  ): Promise<void> {
    const gmPath = `sessions/${sessionDate}/live/combat_gm`;
    const publicPath = `sessions/${sessionDate}/live/combat`;

    const projection = projectCombatPublic(combat);

    await Promise.all([
      this.setDocument(
        gmPath,
        {
          ...combat,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ),
      this.setDocument(
        publicPath,
        {
          ...projection,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      )
    ]);
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
