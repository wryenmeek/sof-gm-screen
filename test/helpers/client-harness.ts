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
  filePayloads?: Record<string, any>;
}

export function setupClientHarness(options: ClientHarnessOptions = {}) {
  document.body.innerHTML = cachedBodyHtml;
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

  const idbStore = new Map<string, ArrayBuffer>();
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
            put: (val: ArrayBuffer, key: string) => {
              idbStore.set(key, val);
              const putReq: any = {};
              setTimeout(() => putReq.onsuccess && putReq.onsuccess(), 0);
              return putReq;
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
  (window as any).AudioContext = class MockAudioContext {
    currentTime = 10.0;
    destination = {};
    createGain = audioCtxCreateGainSpy;
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
  const filePayloads = options.filePayloads || {};

  (window as any).marked = marked;
  (window as any).MiniSearch = MiniSearch;
  (window as any).google = {
    script: {
      run: {
        withSuccessHandler: (cb: any) => ({
          getScratchpadNotes: getScratchpadNotesSpy,
          saveScratchpadNotes: saveScratchpadNotesSpy,
          getSessionList: getSessionListSpy,
          getSessionManifest: getSessionManifestSpy,
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
          logRuleFeedback: logRuleFeedbackSpy
        }),
        saveAudioTimeline: saveAudioTimelineSpy,
        logRuleFeedback: logRuleFeedbackSpy,
        getFilePayload: getFilePayloadSpy
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
        handleAudioIntent: typeof handleAudioIntent !== "undefined" ? handleAudioIntent : undefined,
        hasWebGpuSupport: typeof hasWebGpuSupport !== "undefined" ? hasWebGpuSupport : undefined,
        flushAudioTimeline: typeof flushAudioTimeline !== "undefined" ? flushAudioTimeline : undefined,
        selectPlayerIdentity: typeof selectPlayerIdentity !== "undefined" ? selectPlayerIdentity : undefined,
        triggerPtt: typeof triggerPtt !== "undefined" ? triggerPtt : undefined,
        showRuleCard: typeof showRuleCard !== "undefined" ? showRuleCard : undefined,
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
    idbStore,
    idbOpenSpy,
    audioCtxCreateGainSpy,
    saveAudioTimelineSpy,
    logRuleFeedbackSpy,
    getFilePayloadSpy,
    getLastSpeechRecognitionInstance: () => lastSpeechRecognitionInstance
  };
}
