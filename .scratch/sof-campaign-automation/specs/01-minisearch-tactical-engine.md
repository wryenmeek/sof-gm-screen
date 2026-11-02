# Spec: Client-Side In-Memory MiniSearch Tactical Search Engine

**Status:** `ready-for-agent`

## Problem Statement

During live tabletop combat in the Sea of Fortune campaign, the Game Master needs to instantly retrieve creature stats, spell rules, hazard mechanics, and NPC lore without breaking narrative flow. Relying on Google Apps Script server round-trips (`google.script.run`) introduces 300ms–2000ms latency per query, while the current substring filename filter only searches asset titles rather than the rich markdown and Homebrewery 5e statblock contents within them.

## Solution

Embed an in-memory client-side full-text search engine using [MiniSearch](https://github.com/lucaong/minisearch) directly within `Index.html`. MiniSearch indexes document titles, unpacked folder shortcut categories (`[1. Floor Maps]`, `[3. Monsters]`), 5e statblock attributes (AC, HP, resistances, actions), and narrative notes in memory upon session load, providing sub-millisecond BM25+ ranked results with field boosting, prefix matching, and fuzzy search.

## User Stories

1. As a Game Master, I want to type a search query in the sidebar filter and see results ranked by BM25+ relevance across document contents, so that the most relevant tactical card appears first.
2. As a Game Master, I want creature names and statblock titles boosted 3x higher than body text, so that typing "orange sludge" surfaces the Orange Sludge monster statblock immediately rather than incidental lore mentions.
3. As a Game Master, I want to search for mechanical properties (such as "fire vulnerability" or "legendary resistance") and find creatures with those traits, so that I can quickly adjudicate spell outcomes in combat.
4. As a Game Master, I want prefix matching enabled as I type, so that entering "mut" immediately suggests "Muttering Serpent".
5. As a Game Master, I want fuzzy search tolerance with a distance of 1, so that minor typos during fast-paced combat still surface the intended spell or creature.
6. As a Game Master, I want pressing `/` anywhere on the screen to focus the search input, so that I can initiate searches without lifting my hands from the keyboard.
7. As a Game Master, I want clicking a search result to immediately load that asset in the primary pane and highlight it in the session manifest, so that I maintain visual orientation.
8. As a Game Master, I want the in-memory search index to build in under 50ms upon session selection, so that there is no perceived startup delay when switching between session dates.

## Implementation Decisions

- **In-Memory Engine:** Integrate MiniSearch (v7.x) via CDN script tag in `Index.html`.
- **Indexed Fields & Boosting:**
  - `title`: boost 3.0
  - `tags`: boost 2.5
  - `properties`: boost 2.0 (parsed 5e attributes: AC, HP, Speed, Resistances, Immunities)
  - `content`: boost 1.0 (raw markdown / plain text)
- **Tokenization Pipeline:** Custom pre-processor stripping outer markdown code fences and extracting Homebrewery 5e key-value pairs before indexing.
- **Search Options:** `prefix: true`, `fuzzy: 0.2`, `combineWith: 'AND'`.
- **Zero-Storage Footprint:** No binary files written or transferred across Google Drive; the index is instantiated in browser RAM from the session manifest and payload cache.

## Testing Decisions

- **Behavioral Tests:** Vitest unit tests verifying MiniSearch instantiation, tokenization of Homebrewery 5e statblock properties, BM25+ field boosting behavior, and fuzzy typo recovery.
- **Prior Art:** Existing client tests in `test/client.test.ts`.

## Out of Scope

- Multi-year analytical queries across all 60+ historical sessions (reserved for offline DuckDB).
- Storing SQLite binaries or FTS indexes in Google Drive.
