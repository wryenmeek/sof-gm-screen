# 01: Core In-Memory MiniSearch Manifest Indexing

**What to build:** In-browser client search engine setup in `Index.html` that indexes all asset names, folder shortcut tags (`[1. Floor Maps]`, `[3. Monsters]`), and MIME types upon session manifest load, instantly filtering the sidebar manifest as the user types.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] MiniSearch library (v7.x) is loaded via CDN script in `Index.html`.
- [x] On `renderManifest(files)`, a MiniSearch instance is created in RAM with fields `['name', 'simpleName', 'mimeType']`.
- [x] Typing in `#filter-input` queries the MiniSearch instance with prefix matching and updates the visible asset list in <5ms.
- [x] Clearing the input restores the full alphabetical manifest view.
- [x] Vitest unit test validates indexing and query execution over mock session manifests.
