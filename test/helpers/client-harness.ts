import fs from "fs";
import { vi } from "vitest";
import { marked } from "marked";
import MiniSearch from "minisearch";

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

  return {
    ...exported,
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
