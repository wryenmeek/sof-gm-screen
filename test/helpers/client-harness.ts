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
  saveDelayMs?: number;
  saveError?: string;
  ruleFeedbackResult?: any;
  ruleFeedbackError?: string;
  deferRuleFeedback?: boolean;
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
  const idbOpenSpy = vi.fn().mockImplementation(() => {
    const req: any = {
      result: {
        objectStoreNames: { contains: () => true },
        createObjectStore: vi.fn(),
        transaction: () => ({
          objectStore: () => ({
            get: (key: string) => {
              const getReq: any = { result: idbStore.get(key) };
              setTimeout(() => getReq.onsuccess && getReq.onsuccess(), 0);
              return getReq;
            },
            put: (val: any, key?: string) => {
              const resolvedKey = key ?? (val && val.fileId);
              if (resolvedKey) {
                idbStore.set(resolvedKey, val);
              }
              const putReq: any = {};
              setTimeout(() => putReq.onsuccess && putReq.onsuccess(), 0);
              return putReq;
            },
            delete: (key: string) => {
              idbStore.delete(key);
              const delReq: any = {};
              setTimeout(() => delReq.onsuccess && delReq.onsuccess(), 0);
              return delReq;
            },
            clear: () => {
              idbStore.clear();
              const clearReq: any = {};
              setTimeout(() => clearReq.onsuccess && clearReq.onsuccess(), 0);
              return clearReq;
            },
            getAll: () => {
              const allReq: any = { result: Array.from(idbStore.values()) };
              setTimeout(() => allReq.onsuccess && allReq.onsuccess(), 0);
              return allReq;
            },
            getAllKeys: () => {
              const keysReq: any = { result: Array.from(idbStore.keys()) };
              setTimeout(() => keysReq.onsuccess && keysReq.onsuccess(), 0);
              return keysReq;
            }
          })
        })
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
            }
          };
          return runner;
        },
        saveAudioTimeline: saveAudioTimelineSpy,
        logRuleFeedback: logRuleFeedbackSpy,
        getFilePayload: getFilePayloadSpy,
        extractNarrativePromises: extractNarrativePromisesSpy,
        getLatestAudioCue: getLatestAudioCueSpy,
        getLatestRuleQueryCueForCompanion: getLatestCompanionRuleQueryCueSpy
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
        loadDriveRulesGlossary: typeof loadDriveRulesGlossary_ !== "undefined" ? loadDriveRulesGlossary_ : undefined,
        indexRulesGlossary: typeof indexRulesGlossary_ !== "undefined" ? indexRulesGlossary_ : undefined,
        matchSpokenRuleQuery_: typeof matchSpokenRuleQuery_ !== "undefined" ? matchSpokenRuleQuery_ : undefined,
        handleDictationInput: typeof handleDictationInput !== "undefined" ? handleDictationInput : undefined,
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
