# 10: Gemini Post-Session Promise Extractor to Google Tasks

**What to build:** Post-session Apps Script function that sends newly saved `table_notes.md` content to Gemini 1.5 Flash via structured JSON schema, extracting unresolved rulings, crafting timers, and NPC promises directly into Google Tasks.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] Apps Script function `extractNarrativePromises(sessionDate)` reads `table_notes.md`.
- [x] Calls Gemini 1.5 Flash API with `response_mime_type: "application/json"` and a schema defining `{ tasks: [{ title, notes, due, category }] }`.
- [x] Extracted items are inserted into the primary GM task list via the Apps Script Advanced Service `Tasks.Tasks.insert()`.
- [x] Duplicate check ensures identical tasks are not re-inserted if `table_notes.md` is saved multiple times.
- [x] Successful task creation logs task IDs and titles in the execution transcript.
- [x] Unit test verifies JSON schema validation and mock task payload parsing.
