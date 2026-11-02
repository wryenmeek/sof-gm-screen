import fs from "fs";
import { vi } from "vitest";
import { marked } from "marked";
import MiniSearch from "minisearch";

const cachedHtml = fs.readFileSync("Index.html", "utf8");
const bodyMatch = cachedHtml.match(/<body>([\s\S]*?)<script>/i);
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
  initialLocalStorage?: Record<string, string>;
  filePayloads?: Record<string, any>;
  rulesGlossary?: Array<any>;
  latestAudioCue?: any;
  extractedPromisesResult?: any;
  audioAuthToken?: string;
}

export function setupClientHarness(options: ClientHarnessOptions = {}) {
  document.body.className = "";
  document.body.innerHTML = cachedBodyHtml;
  (window as any).INITIAL_VIEW_MODE = options.viewMode || "gm";
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
  const audioCtxCreateGainSpy = vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    gain: {
      value: 1.0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn()
    }
  }));
  const audioCtxCreateCompressorSpy = vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    threshold: { value: -18 },
    knee: { value: 12 },
    ratio: { value: 4 },
    attack: { value: 0.003 },
    release: { value: 0.25 }
  }));
  (window as any).AudioContext = class MockAudioContext {
    currentTime = 10.0;
    destination = {};
    createGain = audioCtxCreateGainSpy;
    createDynamicsCompressor = audioCtxCreateCompressorSpy;
    decodeAudioData = vi.fn();
    createBufferSource = vi.fn();
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
  const getScratchpadNotesSpy = vi.fn();
  const saveScratchpadNotesSpy = vi.fn();
  const getSessionListSpy = vi.fn();
  const getSessionManifestSpy = vi.fn();
  const getAudioAuthTokenSpy = vi.fn();
  const getRulesGlossarySpy = vi.fn();
  const extractNarrativePromisesSpy = vi.fn();
  const getLatestAudioCueSpy = vi.fn();
  const filePayloads = options.filePayloads || {};

  (window as any).marked = marked;
  (window as any).MiniSearch = MiniSearch;
  (window as any).google = {
    script: {
      run: {
        withSuccessHandler: (cb: any) => ({
          getScratchpadNotes: (sessionDate: string) => {
            getScratchpadNotesSpy(sessionDate);
            if (cb)
              cb({
                id: "notes_1",
                content: "# Notes",
                updated: "10:00:00 AM"
              });
          },
          saveScratchpadNotes: (sessionDate: string, content: string) => {
            saveScratchpadNotesSpy(sessionDate, content);
            if (cb) cb({ id: "notes_1", updated: "10:01:00 AM" });
          },
          getSessionList: () => {
            getSessionListSpy();
            if (cb) cb(["2026-10-31"]);
          },
          getSessionManifest: (sessionDate: string) => {
            getSessionManifestSpy(sessionDate);
            if (cb) cb([]);
          },
          getFilePayload: (fileId: string, sessionDate: string) => {
            getFilePayloadSpy(fileId, sessionDate);
            if (cb && filePayloads[fileId]) {
              cb(filePayloads[fileId]);
            }
          },
          saveAudioTimeline: (sessionDate: string, json: string) => {
            saveAudioTimelineSpy(sessionDate, json);
            if (cb) cb({ status: "saved" });
          },
          logRuleFeedback: (payload: any) => {
            logRuleFeedbackSpy(payload);
            if (cb) cb({ status: "logged" });
          },
          getAudioAuthToken: (gmKey?: string) => {
            getAudioAuthTokenSpy(gmKey);
            if (cb) cb(options.audioAuthToken || "mock_oauth_token");
          },
          getRulesGlossary: (sessionDate: string) => {
            getRulesGlossarySpy(sessionDate);
            if (cb && options.rulesGlossary) {
              cb(options.rulesGlossary);
            }
          },
          extractNarrativePromises: (sessionDate: string) => {
            extractNarrativePromisesSpy(sessionDate);
            if (cb) {
              cb(
                options.extractedPromisesResult || {
                  sessionDate,
                  extractedCount: 2,
                  createdCount: 2,
                  created: 2,
                  tasks: [
                    { id: "t1", title: "Promise 1" },
                    { id: "t2", title: "Promise 2" }
                  ]
                }
              );
            }
          },
          getLatestAudioCue: (gmKey?: string) => {
            getLatestAudioCueSpy(gmKey);
            if (cb && options.latestAudioCue !== undefined) {
              cb(options.latestAudioCue);
            }
          }
        }),
        saveAudioTimeline: saveAudioTimelineSpy,
        logRuleFeedback: logRuleFeedbackSpy,
        getFilePayload: getFilePayloadSpy,
        extractNarrativePromises: extractNarrativePromisesSpy,
        getLatestAudioCue: getLatestAudioCueSpy
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
        loadFile,
        tokenizeStatblockAndDossier: typeof tokenizeStatblockAndDossier !== "undefined" ? tokenizeStatblockAndDossier : undefined,
        indexFilePayload: typeof indexFilePayload !== "undefined" ? indexFilePayload : undefined,
        updateSearchIndexWithContent: typeof updateSearchIndexWithContent !== "undefined" ? updateSearchIndexWithContent : undefined,
        AudioCache: typeof AudioCache !== "undefined" ? AudioCache : undefined,
        TabletopMixer: typeof TabletopMixer !== "undefined" ? TabletopMixer : undefined,
        classifyAudioAssetChannel: typeof classifyAudioAssetChannel !== "undefined" ? classifyAudioAssetChannel : undefined,
        triggerManualMoodCue: typeof triggerManualMoodCue !== "undefined" ? triggerManualMoodCue : undefined,
        handleAudioIntent: typeof handleAudioIntent !== "undefined" ? handleAudioIntent : undefined,
        resolveClassifierTier: typeof resolveClassifierTier !== "undefined" ? resolveClassifierTier : undefined,
        pollLatestAudioCue: typeof pollLatestAudioCue !== "undefined" ? pollLatestAudioCue : undefined,
        hasWebGpuSupport: typeof hasWebGpuSupport !== "undefined" ? hasWebGpuSupport : undefined,
        flushAudioTimeline: typeof flushAudioTimeline !== "undefined" ? flushAudioTimeline : undefined,
        saveNotes: typeof saveNotes !== "undefined" ? saveNotes : undefined,
        saveScratchpad: typeof saveScratchpad !== "undefined" ? saveScratchpad : undefined,
        triggerPromiseExtraction: typeof triggerPromiseExtraction !== "undefined" ? triggerPromiseExtraction : undefined,
        initCompanionState: typeof initCompanionState !== "undefined" ? initCompanionState : undefined,
        selectPlayerIdentity: typeof selectPlayerIdentity !== "undefined" ? selectPlayerIdentity : undefined,
        loadDriveRulesGlossary: typeof loadDriveRulesGlossary !== "undefined" ? loadDriveRulesGlossary : undefined,
        indexRulesGlossary: typeof indexRulesGlossary !== "undefined" ? indexRulesGlossary : undefined,
        matchSpokenRuleQuery_: typeof matchSpokenRuleQuery_ !== "undefined" ? matchSpokenRuleQuery_ : undefined,
        handleDictationInput: typeof handleDictationInput !== "undefined" ? handleDictationInput : undefined,
        triggerPtt: typeof triggerPtt !== "undefined" ? triggerPtt : undefined,
        showRuleCard: typeof showRuleCard !== "undefined" ? showRuleCard : undefined,
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
    saveAudioTimelineSpy,
    logRuleFeedbackSpy,
    getFilePayloadSpy,
    getScratchpadNotesSpy,
    saveScratchpadNotesSpy,
    getSessionListSpy,
    getSessionManifestSpy,
    getAudioAuthTokenSpy,
    getRulesGlossarySpy,
    extractNarrativePromisesSpy,
    getLatestAudioCueSpy,
    getLastSpeechRecognitionInstance: () => lastSpeechRecognitionInstance
  };
}
