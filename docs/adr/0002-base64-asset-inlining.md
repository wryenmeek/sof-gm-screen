---
status: superseded by ADR-0004
---

# Base64 Data URI Asset Inlining

Session images under 8MB are read on the server, encoded into Base64 data URIs, and inlined directly into client payloads rather than linking to Google Drive `webContentLink` or `/preview` URLs. Modern browsers strictly partition third-party cookies and block cross-origin requests inside sandboxed Apps Script iframes, making direct Drive image URLs unreliable during live sessions; inlining data URIs eliminates all authentication and cookie failures at the cost of a 33% payload transfer overhead.
