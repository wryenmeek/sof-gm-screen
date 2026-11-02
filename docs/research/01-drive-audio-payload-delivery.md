# Research Report: Google Drive Audio Payload Delivery & Apps Script Quota Limits

**Ticket:** [`01-drive-audio-payload-delivery.md`](../issues/01-drive-audio-payload-delivery.md)
**Date:** 2026-11-02
**Status:** Resolved

## Question

How can multi-megabyte MP3 **Session Assets** (10-minute ambient loops and thematic scores, typically 10MB–25MB each) be delivered from Google Drive into the **GM Screen** browser `IndexedDB` cache for the **Tabletop Mixer** without failing on `google.script.run`'s payload limits, 6-minute execution timeout, Base64 memory inflation, or Google Drive CORS restrictions?

---

## Primary-Source Findings

### 1. Google Apps Script Quotas & `HtmlService` Bridge Limits

| Constraint | Official Quota / Limit | Primary Source |
| :--- | :--- | :--- |
| **Script Execution Runtime** | **6 minutes / execution** | [Apps Script Quotas for Google Services](https://developers.google.com/apps-script/guides/services/quotas#current_limitations) |
| **`UrlFetchApp` Max Response Size** | **50 MB / call** | [Apps Script Quotas (`URL Fetch response size`)](https://developers.google.com/apps-script/guides/services/quotas#current_limitations) |
| **`DriveApp.getFileById().getBlob()` Memory Limit** | **~50 MB practical heap limit** before V8 worker termination (`File <name> exceeds the maximum file size`) | [Drive Service `File.getBlob()` Reference](https://developers.google.com/apps-script/reference/drive/file#getBlob()) |
| **`google.script.run` RPC Serialization** | Parameters and return values must be JSON-serializable primitives/objects (`Blob` return supported only as raw byte array or Base64 string). Practical bridge ceiling is **~10 MB–30 MB** of serialized JSON before the `*.script.googleusercontent.com` sandboxed iframe bridge drops the connection (`NetworkError: Connection failure due to HTTP 0`). | [HtmlService `google.script.run` Restrictions](https://developers.google.com/apps-script/guides/html/communication#parameters_and_return_values) |
| **Iframe Sandboxing Origin** | `HtmlService` runs in a double-sandboxed iframe (`sandbox="allow-scripts allow-forms allow-same-origin ..."`) served from a unique `https://n-<id>-0lu-script.googleusercontent.com` origin. | [HtmlService Restrictions (`IFRAME` sandbox mode)](https://developers.google.com/apps-script/guides/html/restrictions) |

---

### 2. Comparison of the Three Candidate Delivery Mechanisms

#### Option A: Direct Browser `fetch()` Against Drive API v3 (`files.get?alt=media`) with OAuth Bearer Token (**Recommended Primary Path**)

```javascript
const response = await fetch(
  `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
  {
    method: "GET",
    headers: {
      Authorization: `Bearer ${oauthToken}`
    }
  }
);
const arrayBuffer = await response.arrayBuffer();
```

* **Protocol & CORS Behavior:**
  * The official Google Drive REST API v3 media endpoint (`GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media`) natively supports Cross-Origin Resource Sharing (CORS) when the OAuth 2.0 credential is sent via the `Authorization: Bearer <token>` HTTP request header ([Google Drive API v3: Download & export files](https://developers.google.com/drive/api/guides/manage-downloads#download-content); [CORS Support in Google APIs](https://developers.google.com/api-client-library/javascript/features/cors)).
  * When `Authorization: Bearer <token>` is provided on `https://www.googleapis.com/drive/v3/files/{fileId}?alt=media`, the Google API frontend responds directly with `200 OK`, `Access-Control-Allow-Origin: <origin>`, and streams the binary octets directly to `response.arrayBuffer()` without redirecting to cookie-authenticated `*.googleusercontent.com` download hosts.
  * **Crucial Gotcha (Query-Parameter Tokens Fail CORS):** Passing `?alt=media&access_token=<token>` in the URL (instead of the `Authorization` header) is deprecated for media downloads and can trigger a `302 Found` redirect to `*-apidata.googleusercontent.com` where `Access-Control-Allow-Origin` is omitted, causing a browser CORS failure ([Google Issue Tracker #36759966: Drive API `alt=media` CORS redirect behavior](https://issuetracker.google.com/issues/36759966)).
* **Performance & Quota Profile:**
  * **Zero Apps Script Execution Time:** `Code.gs` only executes `ScriptApp.getOAuthToken()` (takes `<50ms`, returns a ~200-byte string valid for up to 3,600 seconds) ([`ScriptApp.getOAuthToken()` Reference](https://developers.google.com/apps-script/reference/script/script-app#getoauthtoken)).
  * **Zero Base64 Inflation:** Transfers raw binary bytes (`1.0x` wire size) directly from Google's API edge to the browser `ArrayBuffer` and into `IndexedDB`.
  * **Concurrent Pre-Warming:** Multiple 10MB–25MB **Session Assets** can be fetched in parallel via browser `fetch()` without touching Apps Script's 6-minute execution limit or 50MB `UrlFetchApp` cap.
* **Security & Scope Trade-Offs:**
  * In [`appsscript.json`](../../../appsscript.json), the web app is deployed with `"executeAs": "USER_DEPLOYING"` and `"access": "MYSELF"`, and currently declares `"https://www.googleapis.com/auth/drive"`.
  * Exposing `ScriptApp.getOAuthToken()` to the client passes the effective user's token with all scopes declared in `appsscript.json`.
  * **For the GM Screen (`access: "MYSELF"`):** The sole viewer is the deploying Game Master, so handing the GM's own browser session a short-lived token (or using it during pre-session cache warming) introduces no cross-user privilege escalation, provided third-party scripts in `Index.html` are trusted/pinned.
  * **For the Player Companion (if ever exposed beyond `MYSELF`):** `ScriptApp.getOAuthToken()` MUST NOT be exposed to untrusted player browsers if the manifest holds full `auth/drive` read/write scope, because any player inspecting DevTools could read/modify the GM's Drive files. Even downscoping to `drive.readonly` would expose GM-only **Encounter Dossiers** in Drive. However, the **Player Companion** does not run the **Tabletop Mixer** (`GM Screen` runs the mixer in the room).

---

#### Option B: Chunked Base64 RPC Streaming Over `google.script.run` via `UrlFetchApp` Byte-Range Slices (**Viable Fallback Only**)

```javascript
// Server-side (Code.gs)
function getAudioFileChunk(fileId, startByte, endByte) {
  const url = "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media";
  const res = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      Range: "bytes=" + startByte + "-" + endByte
    }
  });
  return Utilities.base64Encode(res.getContent());
}
```

* **Protocol & Mechanics:**
  * Drive API v3 `files.get?alt=media` supports standard HTTP `Range: bytes=<start>-<end>` headers for partial binary downloads, returning `206 Partial Content` ([Google Drive API v3: Partial download](https://developers.google.com/drive/api/guides/manage-downloads#partial-download)).
  * Note that `DriveApp.getFileById(id).getBlob().getBytes()` loads the *entire* file into V8 memory before slicing; therefore, server-side chunking of 20MB+ files must use `UrlFetchApp` with `Range` headers rather than `DriveApp.getBlob()`.
* **Performance & Quota Bottlenecks:**
  * **33% Base64 Inflation:** A 20MB MP3 becomes ~26.7MB of Base64 text across the `google.script.run` bridge.
  * **High RPC Latency & Memory Churn:** Fetching a 20MB file in five 4MB slices requires 5 sequential or concurrent `google.script.run` cold/warm V8 invocations (typically 1.5s–3.5s per chunk = 8s–18s per track), plus client-side `atob()` / `Uint8Array` reassembly before writing to `IndexedDB`.
  * **Daily `UrlFetchApp` Bandwidth:** Counts against the script owner's daily `UrlFetchApp` data received quota and 6-minute execution time if pre-warming an entire folder of tracks.

---

#### Option C: Direct Google Drive Content / CDN URLs (`drive.google.com/uc?export=download`, `lh3.googleusercontent.com/d/<fileId>`) (**Incompatible with Web Audio `ArrayBuffer` & `IndexedDB`**)

* **Why `<img src>` Works (ADR-0004) While `fetch()` / Web Audio Fails:**
  * In [`ADR-0004`](../../../docs/adr/0004-google-edge-cdn-image-delivery.md), `https://lh3.googleusercontent.com/d/<fileId>` is used inside standard `<img src="...">` elements, which perform an **opaque (no-CORS) subresource load**.
  * First, `lh3.googleusercontent.com/d/<fileId>` is an image-transcoding / thumbnail edge service: for non-image MIME types such as `audio/mpeg`, it returns `400 Bad Request` or `403 Forbidden` (or a rasterized waveform/icon thumbnail if one exists), never the raw MP3 byte stream.
  * Second, `https://drive.google.com/uc?export=download&id=<fileId>` (`webContentLink`) issues a `302` redirect to `https://doc-*-docs.googleusercontent.com/docs/securesc/...` without an `Access-Control-Allow-Origin` response header (and for files approaching 25MB–100MB, can return an HTML virus-scan warning page instead of binary bytes).
  * Third, the **Tabletop Mixer** requires raw binary `ArrayBuffer` access to:
    1. Persist the audio blob offline inside `IndexedDB` (`IDBObjectStore.put(arrayBuffer, fileId)`), and
    2. Decode gapless PCM buffers via `AudioContext.decodeAudioData(arrayBuffer)` (or feed a CORS-clean `MediaElementAudioSourceNode` without zeroing out the Web Audio graph due to "tainted" cross-origin media restrictions per the [W3C Web Audio API Specification: MediaElementAudioSourceNode Security](https://webaudio.github.io/web-audio-api/#MediaElementAudioSourceOptions-security)).
  * Any `fetch()` call to `drive.google.com/uc` from the `*.googleusercontent.com` sandboxed iframe is blocked by the browser's Same-Origin Policy (`No 'Access-Control-Allow-Origin' header is present`).

---

## Side-by-Side Architecture Matrix

| Criterion | Option A: Client `fetch()` + Drive v3 `alt=media` (`Bearer` header) | Option B: Chunked Base64 RPC (`google.script.run` + `Range` header) | Option C: Direct Drive / CDN URLs (`drive.google.com/uc` / `lh3`) |
| :--- | :--- | :--- | :--- |
| **CORS Compatible with `fetch()` → `ArrayBuffer`?** | **Yes** (native CORS on `www.googleapis.com` with `Authorization` header) | **Yes** (same-bridge `google.script.run` IPC) | **No** (blocked by missing `Access-Control-Allow-Origin` on redirect) |
| **Works with `IndexedDB` & `decodeAudioData()`?** | **Yes** | **Yes** (after client Base64 reassembly) | **No** (opaque response cannot be read into `ArrayBuffer` or `IndexedDB`) |
| **Apps Script 6-Min Execution Impact** | **Near zero** (1 call to `ScriptApp.getOAuthToken()` per hour) | **High** (5–7 RPC calls + `UrlFetchApp` per 20MB track) | N/A |
| **Payload Inflation** | **0%** (raw binary `ArrayBuffer`) | **+33%** (Base64 string encoding) | N/A |
| **20MB MP3 Transfer Latency** | **~0.5s – 1.5s** (direct HTTP/2 stream from Google API edge) | **~8s – 18s** (multi-chunk Apps Script proxy) | Fails |
| **Works on Private (Unshared) Drive Files?** | **Yes** (authenticates as GM via OAuth token) | **Yes** | **No** (requires link-sharing and still fails CORS) |

---

## Conclusion & Recommendation

1. **Adopt Option A (Direct Browser `fetch()` to `https://www.googleapis.com/drive/v3/files/{fileId}?alt=media` with `Authorization: Bearer <token>`)** as the primary delivery mechanism for pre-warming **Tabletop Mixer** audio **Session Assets** into the browser's `IndexedDB` cache.
2. **Token Provisioning Pattern:** Expose a lightweight `getDriveAccessToken()` helper (or include the token in the initial `getSessionManifest(sessionDate)` response) in `Code.gs` using `ScriptApp.getOAuthToken()`. Because [`appsscript.json`](../../../appsscript.json) already enforces `executeAs: "USER_DEPLOYING"` and `access: "MYSELF"` with the `https://www.googleapis.com/auth/drive` scope, no new OAuth consent flow or GCP configuration is required.
3. **Retain Option B (Chunked `Range` RPC) Only as an Architectural Escape Hatch:** If a restrictive browser extension or network proxy ever interferes with direct `googleapis.com` requests, a 4MB-chunked `Range` fetcher in `Code.gs` can serve as a fallback, but it is unnecessary for standard Chrome/Safari sessions.
