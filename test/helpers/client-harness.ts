import fs from "fs";
import { vi } from "vitest";
import { marked } from "marked";
import MiniSearch from "minisearch";
import {
  LiveTabletopClient,
  type CharacterRosterDoc,
  type ClaimResult
} from "../../src/live_tabletop_client";

const cachedHtml = fs.readFileSync("Index.html", "utf8");
const bodyMatch = cachedHtml.match(
  /<body\b(?:(?:<\?[\s\S]*?\?>)|[^>])*?>([\s\S]*?)<script>/i
);
const cachedBodyHtml = bodyMatch ? bodyMatch[1] : "";
const scriptMatch = cachedHtml.match(
  /<script>([\s\S]*?)<\/script>\s*<\/body>/i
);
if (!scriptMatch) {
  throw new Error("Could not find client script in Index.html");
}
const cachedScript = scriptMatch[1].replace("<?= sessionDate ?>", "2026-10-31");

export interface MockLiveTabletopOptions {
  sessionDate?: string;
  currentUser?: { uid: string; isAnonymous?: boolean } | null;
  initialRoster?: CharacterRosterDoc[];
  simDelayMs?: number;
  forceContentionForCharacterId?: string | null;
}

export class MockLiveTabletopClient {
  public currentUser: { uid: string; isAnonymous: boolean } | null = null;
  public rosterStore: Map<string, CharacterRosterDoc> = new Map();
  public rosterListeners: Set<(roster: CharacterRosterDoc[]) => void> =
    new Set();
  public audioCueListeners: Set<(cue: any) => void> = new Set();
  public combatListeners: Set<(combat: any) => void> = new Set();
  public reactionsListeners: Set<(reactions: any) => void> = new Set();
  public sessionDate: string = "2026-10-31";
  public simDelayMs: number = 0;
  public forceContentionForCharacterId: string | null = null;
  public claimHistory: Array<{
    characterId: string;
    uid: string;
    timestamp: number;
  }> = [];
  public releaseHistory: Array<{
    characterId: string;
    uid: string;
    timestamp: number;
  }> = [];

  constructor(options?: MockLiveTabletopOptions) {
    if (options?.sessionDate) this.sessionDate = options.sessionDate;
    this.simDelayMs = options?.simDelayMs || 0;
    this.forceContentionForCharacterId =
      options?.forceContentionForCharacterId ?? null;
    this.currentUser =
      options?.currentUser !== undefined
        ? options.currentUser
          ? {
              uid: options.currentUser.uid,
              isAnonymous: options.currentUser.isAnonymous ?? true
            }
          : null
        : { uid: "anon_test_uid", isAnonymous: true };

    const initial = options?.initialRoster || [
      { characterId: "pog", name: "Pog", claimedBy: null, color: "#f59e0b" },
      {
        characterId: "vaelor",
        name: "Vaelor",
        claimedBy: null,
        color: "#3b82f6"
      },
      { characterId: "orca", name: "Orca", claimedBy: null, color: "#10b981" },
      { characterId: "fade", name: "Fade", claimedBy: null, color: "#8b5cf6" },
      { characterId: "guest", name: "Guest", claimedBy: null, color: "#64748b" }
    ];
    for (const c of initial) {
      this.rosterStore.set(c.characterId, { ...c });
    }
  }

  public async signInAnonymously(): Promise<any> {
    if (!this.currentUser) {
      this.currentUser = { uid: "anon_test_uid", isAnonymous: true };
    }
    return this.currentUser;
  }

  public async bootstrapPlayerAuth(): Promise<any> {
    return this.signInAnonymously();
  }

  public getCurrentUser(): any {
    return this.currentUser;
  }

  public onAuthStateChanged(callback: (user: any) => void): () => void {
    callback(this.currentUser);
    return () => {};
  }

  public subscribeToRoster(
    _sessionDate: string,
    callback: (roster: CharacterRosterDoc[]) => void
  ): () => void {
    this.rosterListeners.add(callback);
    callback(this.getRosterSnapshot());
    return () => {
      this.rosterListeners.delete(callback);
    };
  }

  public getRosterSnapshot(): CharacterRosterDoc[] {
    return Array.from(this.rosterStore.values()).map((doc) => ({ ...doc }));
  }

  public emitRosterUpdate(): void {
    const snap = this.getRosterSnapshot();
    for (const cb of this.rosterListeners) {
      cb(snap);
    }
  }

  public setCharacterClaim(
    characterId: string,
    claimedBy: string | null
  ): void {
    const doc = this.rosterStore.get(characterId);
    if (doc) {
      doc.claimedBy = claimedBy;
      doc.claimedAt = claimedBy ? Date.now() : null;
      this.emitRosterUpdate();
    }
  }

  public async claimCharacter(
    sessionDate: string,
    characterId: string,
    uid: string
  ): Promise<ClaimResult> {
    if (this.simDelayMs) {
      await new Promise((r) => setTimeout(r, this.simDelayMs));
    }
    if (this.forceContentionForCharacterId === characterId) {
      return {
        success: false,
        code: "ALREADY_CLAIMED",
        claimedByUid: "other_player_uid"
      };
    }
    const doc = this.rosterStore.get(characterId);
    if (!doc) {
      return { success: false, code: "ERROR", error: "Character not found" };
    }
    if (doc.claimedBy && doc.claimedBy !== uid) {
      return {
        success: false,
        code: "ALREADY_CLAIMED",
        claimedByUid: doc.claimedBy
      };
    }
    doc.claimedBy = uid;
    doc.claimedAt = Date.now();
    this.claimHistory.push({ characterId, uid, timestamp: Date.now() });
    if (typeof localStorage !== "undefined" && localStorage) {
      localStorage.setItem(`sof_claimed_character_${sessionDate}`, characterId);
      localStorage.setItem("sof_player_identity", doc.name);
    }
    this.emitRosterUpdate();
    return { success: true, code: "CLAIMED", claimedByUid: uid };
  }

  public async releaseCharacter(
    sessionDate: string,
    characterId: string,
    uid: string
  ): Promise<{ success: boolean; error?: string }> {
    const doc = this.rosterStore.get(characterId);
    if (!doc) return { success: false, error: "Character not found" };
    if (doc.claimedBy && doc.claimedBy !== uid) {
      return { success: false, error: "Claimed by another user" };
    }
    doc.claimedBy = null;
    doc.claimedAt = null;
    this.releaseHistory.push({ characterId, uid, timestamp: Date.now() });
    if (typeof localStorage !== "undefined" && localStorage) {
      localStorage.removeItem(`sof_claimed_character_${sessionDate}`);
    }
    this.emitRosterUpdate();
    return { success: true };
  }

  public async forceReleaseCharacter(
    _sessionDate: string,
    characterId: string
  ): Promise<void> {
    const doc = this.rosterStore.get(characterId);
    if (doc) {
      doc.claimedBy = null;
      doc.claimedAt = null;
      this.emitRosterUpdate();
    }
  }

  public async switchCharacter(
    sessionDate: string,
    oldCharacterId: string,
    newCharacterId: string,
    uid: string
  ): Promise<ClaimResult> {
    const newDoc = this.rosterStore.get(newCharacterId);
    if (!newDoc) return { success: false, code: "ERROR", error: "Not found" };
    if (newDoc.claimedBy && newDoc.claimedBy !== uid) {
      return {
        success: false,
        code: "ALREADY_CLAIMED",
        claimedByUid: newDoc.claimedBy
      };
    }
    const oldDoc = this.rosterStore.get(oldCharacterId);
    if (oldDoc && oldDoc.claimedBy === uid) {
      oldDoc.claimedBy = null;
      oldDoc.claimedAt = null;
      this.releaseHistory.push({
        characterId: oldCharacterId,
        uid,
        timestamp: Date.now()
      });
    }
    newDoc.claimedBy = uid;
    newDoc.claimedAt = Date.now();
    this.claimHistory.push({
      characterId: newCharacterId,
      uid,
      timestamp: Date.now()
    });
    if (typeof localStorage !== "undefined" && localStorage) {
      localStorage.setItem(
        `sof_claimed_character_${sessionDate}`,
        newCharacterId
      );
      localStorage.setItem("sof_player_identity", newDoc.name);
    }
    this.emitRosterUpdate();
    return { success: true, code: "CLAIMED", claimedByUid: uid };
  }

  public subscribeToAudioCue(_sessionDate: string, cb: any): () => void {
    this.audioCueListeners.add(cb);
    return () => this.audioCueListeners.delete(cb);
  }

  public subscribeToCombat(_sessionDate: string, cb: any): () => void {
    this.combatListeners.add(cb);
    return () => this.combatListeners.delete(cb);
  }

  public subscribeToReactions(_sessionDate: string, cb: any): () => void {
    this.reactionsListeners.add(cb);
    return () => this.reactionsListeners.delete(cb);
  }

  public async publishAudioCue(): Promise<void> {}
  public async updateCombat(): Promise<void> {}
  public async sendReaction(): Promise<void> {}
  public async submitRuleFeedback(): Promise<string> {
    return "mock_fb_id";
  }
  public unsubscribeAll(): void {
    this.rosterListeners.clear();
    this.audioCueListeners.clear();
    this.combatListeners.clear();
    this.reactionsListeners.clear();
  }
  public destroy(): void {
    this.unsubscribeAll();
  }
}

export interface ClientHarnessOptions {
  sessionDate?: string;
  viewMode?: "gm" | "companion";
  gmKey?: string;
  initialLocalStorage?: Record<string, string>;
  filePayloads?: Record<string, any>;
  rulesGlossary?: Array<any>;
  latestAudioCue?: any;
  companionRuleQueryCue?: any;
  deferLatestAudioCue?: boolean;
  extractedPromisesResult?: any;
  audioAuthToken?: string;
  idbPutDelayMs?: number;
  deferIdbTransactionCompletion?: boolean;
  abortIdbTransactions?: boolean;
  saveDelayMs?: number;
  saveError?: string;
  ruleFeedbackResult?: any;
  ruleFeedbackError?: string;
  deferRuleFeedback?: boolean;
  verifyGmKeyResult?: boolean;
  verifyGmKeyError?: string;
  initLiveTabletopClient?: boolean;
  liveTabletopClient?: LiveTabletopClient | MockLiveTabletopClient;
  mockRoster?: CharacterRosterDoc[];
  mockUser?: { uid: string; isAnonymous?: boolean } | null;
  forceContentionForCharacterId?: string | null;
}

export function setupClientHarness(options: ClientHarnessOptions = {}) {
  document.body.className = "";
  document.body.innerHTML = cachedBodyHtml;
  (window as any).INITIAL_VIEW_MODE = options.viewMode || "gm";
  (window as any).INITIAL_GM_KEY = options.gmKey || "";
  const filterInput = document.getElementById(
    "filter-input"
  ) as HTMLInputElement | null;
  if (filterInput) {
    filterInput.value = "";
  }
  const fileList = document.getElementById("file-list");
  if (fileList) {
    fileList.innerHTML = "";
  }

  // LocalStorage mock
  const localStorageStore = new Map<string, string>();
  if (options.initialLocalStorage) {
    for (const [k, v] of Object.entries(options.initialLocalStorage)) {
      localStorageStore.set(k, v);
    }
  }
  const mockLocalStorage = {
    getItem: (k: string) => localStorageStore.get(k) ?? null,
    setItem: (k: string, v: string) => localStorageStore.set(k, v),
    clear: () => localStorageStore.clear(),
    removeItem: (k: string) => localStorageStore.delete(k)
  };
  (window as any).localStorage = mockLocalStorage;
  (globalThis as any).localStorage = mockLocalStorage;

  // IndexedDB & fetch mocks
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(256)
  });
  (window as any).fetch = fetchSpy;

  const idbStore = new Map<string, any>();
  const deferredIdbTransactions: any[] = [];
  const scheduleTransactionCompletion = (tx: any) => {
    if (tx.completionScheduled) return;
    tx.completionScheduled = true;
    if (options.deferIdbTransactionCompletion) {
      deferredIdbTransactions.push(tx);
    } else {
      setTimeout(() => {
        const handler = options.abortIdbTransactions
          ? tx.onabort
          : tx.oncomplete;
        if (handler) handler();
      }, 0);
    }
  };
  const scheduleIdbRequest = (
    tx: any,
    request: any,
    action: () => void = () => {},
    delay = 0
  ) => {
    setTimeout(() => {
      action();
      if (request.onsuccess) request.onsuccess();
      scheduleTransactionCompletion(tx);
    }, delay);
    return request;
  };
  const idbOpenSpy = vi.fn().mockImplementation(() => {
    const req: any = {
      result: {
        objectStoreNames: { contains: () => true },
        createObjectStore: vi.fn(),
        close: vi.fn(),
        transaction: () => {
          const tx: any = {
            objectStore: () => ({
              get: (key: string) =>
                scheduleIdbRequest(tx, { result: idbStore.get(key) }),
              put: (val: any, key?: string) => {
                const resolvedKey = key ?? (val && val.fileId);
                return scheduleIdbRequest(
                  tx,
                  {},
                  () => {
                    if (resolvedKey) idbStore.set(resolvedKey, val);
                  },
                  options.idbPutDelayMs || 0
                );
              },
              delete: (key: string) =>
                scheduleIdbRequest(tx, {}, () => idbStore.delete(key)),
              clear: () => scheduleIdbRequest(tx, {}, () => idbStore.clear()),
              getAll: () =>
                scheduleIdbRequest(tx, {
                  result: Array.from(idbStore.values())
                }),
              getAllKeys: () =>
                scheduleIdbRequest(tx, {
                  result: Array.from(idbStore.keys())
                })
            })
          };
          return tx;
        }
      }
    };
    Promise.resolve().then(() => {
      if (req.onsuccess) req.onsuccess();
    });
    return req;
  });
  (window as any).indexedDB = { open: idbOpenSpy };

  // Web Audio API mock
  const audioCtxCreateGainSpy = vi.fn().mockImplementation(() => {
    const gainParam: any = {
      value: 1.0,
      setValueAtTime: vi.fn((val: number) => {
        gainParam.value = val;
      }),
      linearRampToValueAtTime: vi.fn((val: number) => {
        gainParam.value = val;
      })
    };
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: gainParam
    };
  });
  const audioCtxCreateCompressorSpy = vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    threshold: { value: -18 },
    knee: { value: 12 },
    ratio: { value: 4 },
    attack: { value: 0.003 },
    release: { value: 0.25 }
  }));
  const audioCtxDecodeSpy = vi.fn(
    (_data: ArrayBuffer, onDecoded: (buffer: any) => void) =>
      onDecoded({ duration: 1 })
  );
  const audioCtxCreateSourceSpy = vi.fn(() => ({
    buffer: null as any,
    loop: false,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  }));
  (window as any).AudioContext = class MockAudioContext {
    currentTime = 10.0;
    destination = {};
    createGain = audioCtxCreateGainSpy;
    createDynamicsCompressor = audioCtxCreateCompressorSpy;
    decodeAudioData = audioCtxDecodeSpy;
    createBufferSource = audioCtxCreateSourceSpy;
  };

  // SpeechRecognition mock
  let lastSpeechRecognitionInstance: any = null;
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

  // google.script.run spies
  const saveAudioTimelineSpy = vi.fn();
  const logRuleFeedbackSpy = vi.fn();
  const getFilePayloadSpy = vi.fn();
  const getTableNotesSpy = vi.fn();
  const saveTableNotesSpy = vi.fn();
  const getSessionListSpy = vi.fn();
  const getSessionManifestSpy = vi.fn();
  const getAudioAuthTokenSpy = vi.fn();
  const getRulesGlossarySpy = vi.fn();
  const extractNarrativePromisesSpy = vi.fn();
  const getLatestAudioCueSpy = vi.fn();
  const getLatestCompanionRuleQueryCueSpy = vi.fn();
  const verifyGmKeySpy = vi.fn();
  const latestAudioCueResponses: Array<(value: any) => void> = [];
  const ruleFeedbackResponses: Array<(value: any) => void> = [];
  const filePayloads = options.filePayloads || {};

  (window as any).marked = marked;
  (window as any).MiniSearch = MiniSearch;
  (window as any).google = {
    script: {
      run: {
        withSuccessHandler: (cb: any) => {
          let failureCb: any;
          const runner: any = {
            withFailureHandler: (handler: any) => {
              failureCb = handler;
              return runner;
            },
            getTableNotes: (...args: any[]) => {
              getTableNotesSpy(...args);
              if (cb)
                cb({
                  id: "notes_1",
                  content: "# Notes",
                  updated: "10:00:00 AM"
                });
            },
            saveTableNotes: (...args: any[]) => {
              saveTableNotesSpy(...args);
              const complete = () => {
                if (options.saveError) {
                  failureCb?.({ message: options.saveError });
                } else {
                  cb?.({ id: "notes_1", updated: "10:01:00 AM" });
                }
              };
              if (options.saveDelayMs) {
                setTimeout(complete, options.saveDelayMs);
              } else {
                complete();
              }
            },
            getSessionList: (...args: any[]) => {
              getSessionListSpy(...args);
              if (cb) cb(["2026-10-31"]);
            },
            getSessionManifest: (...args: any[]) => {
              getSessionManifestSpy(...args);
              if (cb) cb([]);
            },
            getFilePayload: (...args: any[]) => {
              getFilePayloadSpy(...args);
              const fileId = args[0];
              if (cb && filePayloads[fileId]) {
                cb(filePayloads[fileId]);
              }
            },
            saveAudioTimeline: (...args: any[]) => {
              saveAudioTimelineSpy(...args);
              if (cb) cb({ status: "saved" });
            },
            logRuleFeedback: (payload: any) => {
              logRuleFeedbackSpy(payload);
              if (options.ruleFeedbackError) {
                failureCb?.({ message: options.ruleFeedbackError });
              } else if (cb && options.deferRuleFeedback) {
                ruleFeedbackResponses.push(cb);
              } else if (cb) {
                cb(options.ruleFeedbackResult || { status: "logged" });
              }
            },
            getAudioAuthToken: (...args: any[]) => {
              getAudioAuthTokenSpy(...args);
              if (cb) cb(options.audioAuthToken || "mock_oauth_token");
            },
            getRulesGlossary: (sessionDate: string) => {
              getRulesGlossarySpy(sessionDate);
              if (cb && options.rulesGlossary) {
                cb(options.rulesGlossary);
              }
            },
            extractNarrativePromises: (...args: any[]) => {
              extractNarrativePromisesSpy(...args);
              if (cb) {
                cb(
                  options.extractedPromisesResult || {
                    created: 2,
                    tasks: [
                      { id: "t1", title: "Promise 1" },
                      { id: "t2", title: "Promise 2" }
                    ]
                  }
                );
              }
            },
            getLatestAudioCue: (...args: any[]) => {
              getLatestAudioCueSpy(...args);
              if (cb && options.deferLatestAudioCue) {
                latestAudioCueResponses.push(cb);
              } else if (cb && options.latestAudioCue !== undefined) {
                cb(options.latestAudioCue);
              }
            },
            getLatestRuleQueryCueForCompanion: (...args: any[]) => {
              getLatestCompanionRuleQueryCueSpy(...args);
              if (cb && options.companionRuleQueryCue !== undefined) {
                cb(options.companionRuleQueryCue);
              }
            },
            verifyGmKey: (candidateKey: string) => {
              verifyGmKeySpy(candidateKey);
              if (options.verifyGmKeyError) {
                failureCb?.({ message: options.verifyGmKeyError });
              } else if (cb) {
                cb(
                  options.verifyGmKeyResult !== undefined
                    ? options.verifyGmKeyResult
                    : true
                );
              }
            }
          };
          return runner;
        },
        saveAudioTimeline: saveAudioTimelineSpy,
        logRuleFeedback: logRuleFeedbackSpy,
        getFilePayload: getFilePayloadSpy,
        extractNarrativePromises: extractNarrativePromisesSpy,
        getLatestAudioCue: getLatestAudioCueSpy,
        getLatestRuleQueryCueForCompanion: getLatestCompanionRuleQueryCueSpy,
        verifyGmKey: verifyGmKeySpy
      }
    }
  };

  const fn = new Function(
    "window",
    "document",
    "marked",
    "MiniSearch",
    "google",
    "localStorage",
    cachedScript +
      `
      return {
        parseCustomMarkdown,
        prepareHtmlSrcdoc,
        createDrivePreviewIframe,
        renderManifest,
        filterFiles,
        loadFile: loadFile_,
        selectFile: typeof selectFile_ !== "undefined" ? selectFile_ : undefined,
        loadSession: typeof loadSession !== "undefined" ? loadSession : undefined,
        startNotesAutoSave: typeof startNotesAutoSave_ !== "undefined" ? startNotesAutoSave_ : undefined,
        tokenizeStatblockAndDossier: typeof tokenizeStatblockAndDossier_ !== "undefined" ? tokenizeStatblockAndDossier_ : undefined,
        indexFilePayload: typeof indexFilePayload_ !== "undefined" ? indexFilePayload_ : undefined,
        updateSearchIndexWithContent: typeof updateSearchIndexWithContent_ !== "undefined" ? updateSearchIndexWithContent_ : undefined,
        AudioCache: typeof AudioCache !== "undefined" ? AudioCache : undefined,
        TabletopMixer: typeof TabletopMixer !== "undefined" ? TabletopMixer : undefined,
        classifyAudioAssetChannel: typeof classifyAudioAssetChannel_ !== "undefined" ? classifyAudioAssetChannel_ : undefined,
        triggerManualMoodCue: typeof triggerManualMoodCue !== "undefined" ? triggerManualMoodCue : undefined,
        handleAudioIntent: typeof handleAudioIntent_ !== "undefined" ? handleAudioIntent_ : undefined,
        pollLatestAudioCue: typeof pollLatestAudioCue_ !== "undefined" ? pollLatestAudioCue_ : undefined,
        installAudioUnlockHandler_: typeof installAudioUnlockHandler_ !== "undefined" ? installAudioUnlockHandler_ : undefined,
        flushAudioTimeline: typeof flushAudioTimeline !== "undefined" ? flushAudioTimeline : undefined,
        loadTableNotes: typeof loadTableNotes_ !== "undefined" ? loadTableNotes_ : undefined,
        saveTableNotes: typeof saveTableNotes_ !== "undefined" ? saveTableNotes_ : undefined,
        handleManualSave_: typeof handleManualSave_ !== "undefined" ? handleManualSave_ : undefined,
        triggerPromiseExtraction: typeof triggerPromiseExtraction !== "undefined" ? triggerPromiseExtraction : undefined,
        initCompanionState: typeof initCompanionState_ !== "undefined" ? initCompanionState_ : undefined,
        selectPlayerIdentity: typeof selectPlayerIdentity !== "undefined" ? selectPlayerIdentity : undefined,
        togglePlayerIdentityModal: typeof togglePlayerIdentityModal !== "undefined" ? togglePlayerIdentityModal : undefined,
        closePlayerIdentityModal: typeof closePlayerIdentityModal !== "undefined" ? closePlayerIdentityModal : undefined,
        openGmKeyModal: typeof openGmKeyModal !== "undefined" ? openGmKeyModal : undefined,
        closeGmKeyModal: typeof closeGmKeyModal !== "undefined" ? closeGmKeyModal : undefined,
        submitGmKey: typeof submitGmKey !== "undefined" ? submitGmKey : undefined,
        loadDriveRulesGlossary: typeof loadDriveRulesGlossary_ !== "undefined" ? loadDriveRulesGlossary_ : undefined,
        indexRulesGlossary: typeof indexRulesGlossary_ !== "undefined" ? indexRulesGlossary_ : undefined,
        matchSpokenRuleQuery_: typeof matchSpokenRuleQuery_ !== "undefined" ? matchSpokenRuleQuery_ : undefined,
        handleDictationInput: typeof handleDictationInput !== "undefined" ? handleDictationInput : undefined,
        handleDictationFocus: typeof handleDictationFocus !== "undefined" ? handleDictationFocus : undefined,
        showPttStatus: typeof showPttStatus_ !== "undefined" ? showPttStatus_ : undefined,
        triggerPtt: typeof triggerPtt !== "undefined" ? triggerPtt : undefined,
        showRuleCard: typeof showRuleCard_ !== "undefined" ? showRuleCard_ : undefined,
        dismissRuleCard: typeof dismissRuleCard !== "undefined" ? dismissRuleCard : undefined,
        submitRuleFeedback: typeof submitRuleFeedback !== "undefined" ? submitRuleFeedback : undefined,
        initLiveAudioCueSubscription: typeof initLiveAudioCueSubscription_ !== "undefined" ? initLiveAudioCueSubscription_ : undefined,
        teardownLiveAudioCueSubscription: typeof teardownLiveAudioCueSubscription_ !== "undefined" ? teardownLiveAudioCueSubscription_ : undefined,
        isFirestoreLive: () => typeof isFirestoreLive_ !== "undefined" ? isFirestoreLive_ : false,
        getAudioCueUnsubscribe: () => typeof audioCueUnsubscribe_ !== "undefined" ? audioCueUnsubscribe_ : null,
        setFirestoreLiveState: typeof setFirestoreLiveState_ !== "undefined" ? setFirestoreLiveState_ : undefined,
        handleCharacterCardClick: typeof handleCharacterCardClick !== "undefined" ? handleCharacterCardClick : undefined,
        confirmSwitchCharacter: typeof confirmSwitchCharacter !== "undefined" ? confirmSwitchCharacter : undefined,
        cancelSwitchCharacter: typeof cancelSwitchCharacter !== "undefined" ? cancelSwitchCharacter : undefined,
        forceReleaseCharacter_: typeof forceReleaseCharacter_ !== "undefined" ? forceReleaseCharacter_ : undefined,
        showToast_: typeof showToast_ !== "undefined" ? showToast_ : undefined,
        updateRosterDom_: typeof updateRosterDom_ !== "undefined" ? updateRosterDom_ : undefined,
        updateGmRosterDom_: typeof updateGmRosterDom_ !== "undefined" ? updateGmRosterDom_ : undefined,
        bootstrapCompanionRoster_: typeof bootstrapCompanionRoster_ !== "undefined" ? bootstrapCompanionRoster_ : undefined,
        onRosterSnapshotUpdate_: typeof onRosterSnapshotUpdate_ !== "undefined" ? onRosterSnapshotUpdate_ : undefined,
        renderGmCombat: typeof renderGmCombat_ !== "undefined" ? renderGmCombat_ : undefined,
        renderPlayerCombat: typeof renderPlayerCombat_ !== "undefined" ? renderPlayerCombat_ : undefined,
        advanceCombatTurn: typeof advanceCombatTurn !== "undefined" ? advanceCombatTurn : undefined,
        initCombatTracker: typeof initCombatTracker !== "undefined" ? initCombatTracker : undefined,
        getActiveCombatGmState: typeof getActiveCombatGmState !== "undefined" ? getActiveCombatGmState : undefined,
        getActiveCombatPlayerState: typeof getActiveCombatPlayerState !== "undefined" ? getActiveCombatPlayerState : undefined
      };
    `
  );

  const liveTabletopClient =
    options.liveTabletopClient ??
    (options.initLiveTabletopClient
      ? new LiveTabletopClient({ appName: `harness-${Date.now()}` })
      : new MockLiveTabletopClient({
          sessionDate: options.sessionDate || "2026-10-31",
          initialRoster: options.mockRoster,
          currentUser: options.mockUser,
          forceContentionForCharacterId: options.forceContentionForCharacterId
        }));

  if (liveTabletopClient) {
    (window as any).liveTabletopClient = liveTabletopClient;
  }
  (window as any).LiveTabletopClient = options.initLiveTabletopClient
    ? LiveTabletopClient
    : MockLiveTabletopClient;

  const exported = fn(
    window,
    document,
    marked,
    MiniSearch,
    (window as any).google,
    mockLocalStorage
  );
  Object.assign(window, exported);

  return {
    ...exported,
    liveTabletopClient,
    mockLocalStorage,
    fetchSpy,
    idbStore,
    idbOpenSpy,
    audioCtxCreateGainSpy,
    audioCtxCreateCompressorSpy,
    audioCtxDecodeSpy,
    audioCtxCreateSourceSpy,
    saveAudioTimelineSpy,
    logRuleFeedbackSpy,
    getFilePayloadSpy,
    getTableNotesSpy,
    saveTableNotesSpy,
    getSessionListSpy,
    getSessionManifestSpy,
    getAudioAuthTokenSpy,
    getRulesGlossarySpy,
    extractNarrativePromisesSpy,
    getLatestAudioCueSpy,
    getLatestCompanionRuleQueryCueSpy,
    verifyGmKeySpy,
    completeIdbTransactions: () => {
      deferredIdbTransactions.splice(0).forEach((tx) => {
        if (tx.oncomplete) tx.oncomplete();
      });
    },
    respondToLatestAudioCue: () => {
      const respond = latestAudioCueResponses.shift();
      if (respond) respond(options.latestAudioCue);
    },
    respondToRuleFeedback: (
      result: any = options.ruleFeedbackResult || { status: "logged" }
    ) => {
      const respond = ruleFeedbackResponses.shift();
      if (respond) respond(result);
    },
    getLastSpeechRecognitionInstance: () => lastSpeechRecognitionInstance
  };
}
