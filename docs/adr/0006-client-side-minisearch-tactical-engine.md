# Client-Side In-Memory MiniSearch Tactical Engine

In-session full-text search across session dossiers, creature statblocks, rules cards, and narrative notes is implemented directly in the browser client using [MiniSearch](https://github.com/lucaong/minisearch) running in memory over session manifest payloads, rather than compiling an offline SQLite database and synchronizing binary blobs via WASM (`sql.js`) over Google Apps Script Base64 RPCs.

## Context & Problem

The GM Screen requires sub-millisecond search across thousands of campaign entities during active combat. An earlier exploration considered running WASM SQLite in the browser and serializing `.sqlite` database files to Google Drive via Base64 strings. However:

1. Pushing multi-megabyte binary database blobs back and forth across `google.script.run` causes severe serialization latency and memory exhaustion, directly repeating the failure mode resolved for battle maps in [ADR-0004](0004-google-edge-cdn-image-delivery.md).
2. The campaign's primary source of truth consists of modular Markdown documents, Google Docs, and HTML encounter dossiers organized by session folders in Google Drive. Forcing this content into SQLite introduces an unnecessary offline build pipeline to parse and serialize document text into relational SQL tables.

## Decision

We adopt client-side in-memory **MiniSearch** directly in `Index.html`:

1. **Zero-Latency In-Memory Indexing:** As `getSessionManifest()` loads the session asset tree, MiniSearch indexes document titles, 5e statblock tags, and cached markdown text in memory in under 50ms without network round-trips.
2. **BM25+ Ranking & Field Boosting:** Leverages BM25+ non-linear term frequency scaling and field-length normalization with multi-field weighting (e.g., boosting `title` and `tags` over ambient narrative text).
3. **Prefix & Fuzzy Search:** Supports instant prefix completion and Levenshtein distance fuzzy matching in a ~7KB minified bundle with zero WebAssembly or external binary dependencies.
4. **Separation of Concerns:** Live tactical lookups are handled by in-memory MiniSearch in the browser, while deep multi-year campaign analytics and embedding pipelines remain assigned to offline DuckDB scripts.
