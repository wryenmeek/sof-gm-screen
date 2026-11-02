# Research Report: Apps Script Dual-Iframe Sandbox Constraints on WebGPU, WebRTC & SpeechRecognition

**Ticket:** [03: Apps Script Dual-Iframe Sandbox Constraints on WebGPU, WebRTC & SpeechRecognition](../issues/03-iframe-sandbox-webgpu-webrtc-speech.md)  
**Date:** 2026-11-02  
**Status:** Verified against Google Apps Script `HtmlService` documentation, Google Issue Tracker, W3C WebGPU / Permissions-Policy specs, and Chrome Local Network Access (LNA) / Mixed Content specifications.

---

## Executive Summary

Google Apps Script's `HtmlService` renders every web app inside a **cross-origin dual-iframe hierarchy**:

1. **Top-level window**: `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`
2. **Outer sandbox iframe (`#sandboxFrame`)**: Hosted on `https://*-script.googleusercontent.com` with restricted HTML5 `sandbox` flags (`allow-same-origin allow-forms allow-scripts allow-popups allow-downloads allow-modals allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation`).
3. **Inner content iframe (`#userHtmlFrame`)**: Same-origin with `#sandboxFrame` (`https://n-<dynamic-hash>-script.googleusercontent.com`), where user HTML/JS executes (see also [ADR-0003](../../../docs/adr/0003-iframe-anchor-navigation-isolation.md)).

Because Google controls the outer `script.google.com` host document and does **not** expose an API in `HtmlOutput` to add `allow="..."` Permissions-Policy directives to `#sandboxFrame`, cross-origin default-`self` browser features (`microphone`, `camera`, `local-network-access`, and cross-origin `webgpu` when gated by Permissions Policy) are **blocked or severely degraded** inside the Apps Script web app iframe.

| Capability | Inside `HtmlService` (`*.googleusercontent.com` iframe) | Root Cause / Constraint | Viable Workaround |
| :--- | :--- | :--- | :--- |
| **`getUserMedia` / `webkitSpeechRecognition`** | **Blocked** (`NotAllowedError` / `not-allowed`) | `microphone` & `camera` Permissions-Policy default allowlist is `'self'`; `#sandboxFrame` omits `allow="microphone; camera"`. | Run voice capture in a top-level companion window/PWA or static host (`https://`) or capture audio directly on the Raspberry Pi via ALSA/PipeWire. |
| **`navigator.gpu` (WebGPU)** | **Fragile / Restricted** + **Ephemeral Cache** | Cross-origin iframe lacks `allow="webgpu"`; `n-<hash>-script.googleusercontent.com` subdomain shifts across deployments and is subject to 3P storage partitioning, wiping multi-hundred-MB `IndexedDB` / `CacheStorage` LLM weights (`gemma-4-E2B-it`). | Run local LLM inference on a stable top-level origin or server-side/edge process rather than inside the ephemeral `googleusercontent.com` iframe. |
| **LAN `ws://192.168.x.x` (WebSocket)** | **Blocked** (Mixed Content + LNA) | `https://` page loading `ws://` is blocked as Active Mixed Content; `wss://192.168.x.x` fails TLS cert validation + Chrome 142+ `local-network-access` iframe policy block. | Expose the Raspberry Pi `go2rtc` / signaling server via a valid HTTPS/WSS tunnel (Cloudflare Tunnel / Tailscale Funnel) or relay through WebRTC. |
| **LAN `RTCPeerConnection` (WebRTC)** | **Signaling requires HTTPS/WSS; Media/Data works via STUN/ICE (with LNA caveat)** | SDP signaling over `http://`/`ws://` to LAN IP is blocked by Mixed Content/LNA, but once SDP is exchanged over HTTPS/WSS, UDP ICE candidates (`host`/`srflx`) can establish media/data channels. | Exchange WebRTC SDP offer/answer over an HTTPS/WSS signaling endpoint (or Tailscale Funnel / Cloudflare Tunnel) and stream audio/data over `RTCPeerConnection`. |

---

## 1. Apps Script `HtmlService` Dual-Iframe Architecture

Per the official [Google Apps Script HTML Service Restrictions](https://developers.google.com/apps-script/guides/html/restrictions) guide:

- All web apps run exclusively in `IFRAME` sandbox mode (`HtmlService.SandboxMode.IFRAME`).
- The top-level `https://script.google.com` shell embeds `#sandboxFrame` pointing to a dynamic origin matching `https://n-<token>-0-script.googleusercontent.com` (or `https://<id>-script.googleusercontent.com`).
- `#sandboxFrame` sets the `sandbox` attribute with:

  ```text
  allow-same-origin allow-forms allow-scripts allow-popups allow-downloads allow-modals allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation
  ```

- Crucially, `#sandboxFrame` is a **cross-origin iframe** relative to `https://script.google.com`, and Google does not attach `allow="microphone; camera; webgpu; local-network-access"` to `#sandboxFrame`.

---

## 2. Microphone & Speech Recognition (`getUserMedia` / `webkitSpeechRecognition`)

### Finding: Blocked inside `HtmlService` (`NotAllowedError` / `not-allowed`)

1. **W3C Permissions Policy Specification**: Both `microphone` and `camera` policy-controlled features have a default allowlist of `'self'` ([W3C Permissions Policy](https://www.w3.org/TR/permissions-policy-1/#default-allowlists), [MDN `Permissions-Policy: microphone`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy/microphone)). A cross-origin iframe (`*.googleusercontent.com` inside `script.google.com`) is denied access unless the embedding `<iframe>` tag explicitly specifies `allow="microphone"`.
2. **Google Issue Tracker Verification**:
   - Calling `navigator.mediaDevices.getUserMedia({ audio: true })` inside `HtmlService` immediately rejects with `DOMException: Permission denied` / `Permissions policy violation: microphone is not allowed in this document` (tracked in Google Issue Tracker issues `486623612` and `489159857`, and marked Won't Fix / Intended Behavior for `HtmlService` sandboxing).
   - Calling `new webkitSpeechRecognition().start()` inside a cross-origin iframe without `allow="microphone"` fails immediately with `SpeechRecognitionErrorEvent { error: 'not-allowed' }` without ever prompting the user.
3. **Mobile Safari / Chrome**: Both iOS Safari (`webkitSpeechRecognition` / `getUserMedia`) and Android Chrome enforce the exact same cross-origin iframe `allow="microphone"` delegation rule.

---

## 3. WebGPU (`navigator.gpu`) & Origin-Scoped `IndexedDB` / `CacheStorage` for `gemma-4-E2B-it`

### Finding A: WebGPU in Cross-Origin Sandboxed Iframes

- **Desktop Chrome vs. Mobile Safari/Chrome**: WebGPU (`navigator.gpu`) is supported in secure contexts (`https://`) on desktop Chrome 113+, Android Chrome 121+, and iOS/iPadOS Safari 26+ (experimental/recent WebKit). However, W3C WebGPU defines a `"webgpu"` policy-controlled feature with default allowlist `'self'` ([W3C WebGPU Spec - Permissions Policy Integration](https://www.w3.org/TR/webgpu/#permissions-policy)). Where enforced by the browser, cross-origin iframes without `allow="webgpu"` return `null` from `navigator.gpu.requestAdapter()`.
- **Memory Constraints on Mobile**: Even when `navigator.gpu` is reachable, a quantized `gemma-4-E2B-it` (~1.2–1.5 GB in 4-bit GGUF/WebGPU buffer weights plus KV cache) regularly exceeds mobile Safari jetsam limits (~1.5–2 GB per web content process) and causes tab crashes on phones/tablets.

### Finding B: `IndexedDB` / `CacheStorage` Volatility on `*.googleusercontent.com`

- **Dynamic Subdomain Rotation**: Apps Script assigns each script execution context an origin of the form `https://n-<dynamic-string>-0-script.googleusercontent.com`. While `allow-same-origin` allows `IndexedDB` and `CacheStorage` APIs to execute without throwing `SecurityError`, the subdomain prefix changes across deployments, account switches, or sandbox rotations ([StackOverflow / GAS Community documentation on `script.googleusercontent.com` origins](https://developers.google.com/apps-script/guides/html/restrictions)). Every origin shift orphans previously cached 1.5 GB model weights and forces a full re-download.
- **Third-Party Storage Partitioning & Eviction**: Because `*.googleusercontent.com` is rendered as a cross-site iframe inside `script.google.com`, Chrome Storage Partitioning ([Chrome Storage Partitioning](https://developer.chrome.com/docs/privacy-security/storage-partitioning)) and Safari Intelligent Tracking Prevention (ITP) treat the iframe's `IndexedDB` and `CacheStorage` as **third-party partitioned storage**. Safari aggressively purges third-party iframe `IndexedDB`/`CacheStorage` after 7 days of lack of top-level user interaction and imposes much stricter per-partition quota limits than top-level origins.

---

## 4. `RTCPeerConnection` & Local LAN (`ws://` / `wss://`) to Raspberry Pi (`go2rtc`)

### Finding A: Direct `ws://192.168.x.x` or `http://192.168.x.x` is Hard-Blocked

1. **W3C Mixed Content**: The Apps Script iframe runs over `https://*.googleusercontent.com`. Any `fetch('http://192.168.x.x/...')` or `new WebSocket('ws://192.168.x.x:1984/api/ws')` to a local Raspberry Pi is classified as **blockable (active) mixed content** and unconditionally blocked by all modern browsers ([W3C Mixed Content Level 2](https://www.w3.org/TR/mixed-content/), [MDN Mixed Content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)).
2. **Self-Signed `wss://192.168.x.x` Fails TLS + Chrome Local Network Access (LNA)**:
   - Public CAs (Let's Encrypt) do not issue certificates for RFC 1918 private IPs (`192.168.x.x`), so `wss://192.168.x.x` fails TLS handshake unless a custom root CA is manually installed on every client device.
   - Starting in **Chrome 142+**, Chrome enforces **Local Network Access (LNA)** (formerly Private Network Access / PNA) ([Chrome Local Network Access Blog](https://developer.chrome.com/blog/local-network-access)). LNA gates any request from a public origin (`*.googleusercontent.com`) to a private IP range (`192.168.0.0/16` or `.local` mDNS) behind the `local-network-access` (or `local-network`) Permissions-Policy directive. Cross-origin iframes without `allow="local-network-access"` on their parent `<iframe>` tag are **automatically denied** without even showing the permission prompt to the user.

### Finding B: How `RTCPeerConnection` (`go2rtc`) Can Work

- **Signaling vs. Media Plane**: `RTCPeerConnection` itself does not perform its own signaling; the SDP offer/answer exchange must occur over an HTTPS/WSS channel.
- **Viable Architecture for Raspberry Pi `go2rtc`**:
  1. **HTTPS/WSS Tunnel (Recommended)**: Run **Cloudflare Tunnel (`cloudflared`)** or **Tailscale Funnel / Tailscale HTTPS (`*.ts.net`)** on the Raspberry Pi in front of `go2rtc`. This gives the Pi a publicly trusted `https://` / `wss://` hostname with valid TLS certificates. Because the tunnel endpoint is a public HTTPS/WSS hostname (or Tailnet cert), the `*.googleusercontent.com` iframe can make standard CORS `fetch()` or `wss://` connections to exchange WebRTC SDP offers/answers—or stream MSE/WebSocket audio directly—completely bypassing Mixed Content and Chrome LNA cross-origin iframe blocks.
  2. **WebRTC ICE Media/Data Transport**: Once the SDP offer/answer is exchanged over HTTPS/WSS, `RTCPeerConnection` negotiates UDP ICE candidates (including local LAN `host` candidates advertised by `go2rtc` in its SDP). Note that Chrome 142+ also tracks WebRTC local network probing under LNA ([ChromeStatus: Local Network Access for WebRTC](https://chromestatus.com/feature/5152728072060928)), so keeping a WSS/HTTPS relay or TURN/tunnel fallback ensures zero-friction playback inside the `googleusercontent.com` iframe.

---

## Primary Sources Cited

1. Google Developers — [HTML Service: Restrictions (`IFRAME` sandbox flags and HTTPS active content rules)](https://developers.google.com/apps-script/guides/html/restrictions)
2. Google Issue Tracker — Issues `486623612` & `489159857` (*Web App camera/microphone access via `getUserMedia` fails with 'Permissions policy violation'* inside Apps Script `HtmlService`)
3. W3C — [Permissions Policy Specification (Default Allowlists `'self'` for `microphone`, `camera`)](https://www.w3.org/TR/permissions-policy-1/#default-allowlists)
4. W3C — [WebGPU Specification — Permissions Policy Integration (`"webgpu"` feature token)](https://www.w3.org/TR/webgpu/#permissions-policy)
5. Chrome for Developers — [Storage Partitioning in Third-Party Contexts](https://developer.chrome.com/docs/privacy-security/storage-partitioning)
6. Chrome for Developers — [New Permission Prompt for Local Network Access (`local-network-access` iframe delegation in Chrome 142+)](https://developer.chrome.com/blog/local-network-access)
7. W3C — [Mixed Content Specification (`ws://` and `http://` subresource blocking from `https://` contexts)](https://www.w3.org/TR/mixed-content/)
8. Chrome Platform Status — [Local Network Access Restrictions for WebRTC](https://chromestatus.com/feature/5152728072060928)
