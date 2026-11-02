# 04: IndexedDB Audio Pre-Caching Engine

**What to build:** Client-side binary caching layer using browser `IndexedDB` that pre-fetches Tabletop Audio MP3 loops and score tracks from Google Drive on session load, completely eliminating live cloud audio streaming during play.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] IndexedDB database (`sof_audio_cache_v1`) is initialized in `Index.html` to store binary audio blobs keyed by Drive `fileId`.
- [x] When a session is selected, audio files listed in the manifest trigger background pre-fetching via Apps Script / authorized download links.
- [x] Pre-fetched audio tracks are stored as binary `ArrayBuffer` objects in IndexedDB.
- [x] Subsequent requests for the same track read directly from IndexedDB without hitting Google Drive.
- [x] A subtle cache indicator in the sidebar shows pre-caching progress (e.g. "Audio: 3/3 ready").
- [x] Vitest unit test verifies IndexedDB initialization, write, and read cycles using mock buffers.
