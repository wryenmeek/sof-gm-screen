#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const indexPath = path.join(rootDir, "Index.html");
const publicDir = path.join(rootDir, "public");
const outPath = path.join(publicDir, "index.html");

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

let content = fs.readFileSync(indexPath, "utf8");

// Universal client-side RPC bridge for Firebase Hosting
const rpcBridge = `
      // Universal Apps Script RPC Transport Bridge for Firebase Hosting
      (function() {
        if (typeof window === "undefined") return;
        window.google = window.google || {};
        window.google.script = window.google.script || {};
        if (!window.google.script.run) {
          const DEFAULT_WEB_APP =
            "https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec";
          const paramMaps = {
            getRulesGlossary: ["sessionDate"],
            getSessionManifest: ["session", "gmKey"],
            getSessionList: ["gmKey"],
            verifyGmKey: ["gmKey"],
            logRuleFeedback: ["data"],
            getFilePayload: ["fileId", "sessionDate", "gmKey"],
            getTableNotes: ["sessionDate", "gmKey"],
            saveTableNotes: ["sessionDate", "content", "gmKey"],
            saveAudioTimeline: ["sessionDate", "jsonString", "gmKey"],
            getAudioAuthToken: ["gmKey"],
            getLatestAudioCue: ["gmKey"],
            getLatestRuleQueryCueForCompanion: []
          };

          function createRunner(successHandler, failureHandler) {
            const runner = {
              withSuccessHandler: function(fn) {
                return createRunner(fn, failureHandler);
              },
              withFailureHandler: function(fn) {
                return createRunner(successHandler, fn);
              }
            };

            return new Proxy(runner, {
              get: function(target, prop) {
                if (prop in target) return target[prop];
                return function() {
                  const args = Array.prototype.slice.call(arguments);
                  const webApp = window.WEB_APP_URL || DEFAULT_WEB_APP;
                  const isPost = prop === "saveTableNotes" || prop === "saveCombatTrackerState";
                  const params = { action: String(prop) };
                  const map = paramMaps[prop];
                  if (map) {
                    map.forEach(function(paramName, idx) {
                      if (args[idx] !== undefined) params[paramName] = args[idx];
                    });
                  } else if (args.length > 0) {
                    params.args = JSON.stringify(args);
                  }

                  let promise;
                  if (isPost) {
                    promise = fetch(webApp, {
                      method: "POST",
                      headers: { "Content-Type": "text/plain;charset=utf-8" },
                      body: JSON.stringify(params)
                    });
                  } else {
                    const url = new URL(webApp);
                    Object.keys(params).forEach(function(k) {
                      if (params[k] !== undefined && params[k] !== null) {
                        url.searchParams.set(k, String(params[k]));
                      }
                    });
                    promise = fetch(url.toString(), { method: "GET" });
                  }

                  promise
                    .then(function(res) { return res.json(); })
                    .then(function(data) {
                      if (data && data.error) {
                        if (failureHandler) failureHandler(new Error(data.error));
                        else if (successHandler) successHandler(data);
                      } else {
                        if (successHandler) successHandler(data);
                      }
                    })
                    .catch(function(err) {
                      if (failureHandler) failureHandler(err);
                      else console.warn("RPC fetch error:", err);
                    });
                };
              }
            });
          }

          window.google.script.run = createRunner();
        }
      })();
`;

// Replace server-side scriptlets with client-side reactive bindings
content = content.replace(
  /<body class="<\?= viewMode === 'companion' \? 'companion-only-mode' : '' \?>">/,
  '<body class="companion-only-mode">'
);

content = content.replace(
  /<\? if \(typeof viewMode === "undefined" \|\| viewMode !== "companion"\) \{ \?>/,
  "<!-- GM Screen Elements (Toggled via body.companion-only-mode) -->"
);

content = content.replace(/<\? \} \?>/, "<!-- /GM Screen Elements -->");

content = content.replace(
  /<option value="<\?= sessionDate \?>"><\?= sessionDate \?><\/option>/g,
  '<option value="2026-10-31">2026-10-31</option>'
);

content = content.replace(
  /<span id="scratchpad-label">table_notes\.md \(<\?= sessionDate \?>\)<\/span>/g,
  '<span id="scratchpad-label">table_notes.md (2026-10-31)</span>'
);

content = content.replace(/><\?= sessionDate \?><\/span/g, ">2026-10-31</span");

content = content.replace(
  /let currentSessionDate = "<\?= sessionDate \?>";/,
  'let currentSessionDate = new URLSearchParams(window.location.search).get("session") || "2026-10-31";'
);

content = content.replace(
  /"<\?= typeof viewMode !== 'undefined' \? viewMode : 'gm' \?>";/,
  'new URLSearchParams(window.location.search).get("view") || "companion";'
);

content = content.replace(
  /"<\?= typeof gmKey !== 'undefined' \? gmKey : '' \?>";/,
  'new URLSearchParams(window.location.search).get("gmKey") || sessionStorage.getItem("sof_gm_key") || "";'
);

content = content.replace(
  /"<\?= typeof webAppUrl !== 'undefined' \? webAppUrl : '' \?>";/,
  '"https://script.google.com/macros/s/AKfycbwj8LTo82ezIm21xIfEi3mKwXKDoNMQgkif9w-raC3cRtF3Dtoy6863i-FLSAuxpe6Akw/exec";'
);

// Inject the RPC bridge right inside <script>
content = content.replace(/<script>/, "<script>" + rpcBridge);

fs.writeFileSync(outPath, content, "utf8");
console.log(
  "Exported static distribution to " +
    outPath +
    " (" +
    Buffer.byteLength(content) +
    " bytes)"
);
