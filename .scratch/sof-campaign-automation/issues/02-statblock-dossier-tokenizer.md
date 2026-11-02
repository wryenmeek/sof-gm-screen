# 02: 5e Statblock & Dossier Multi-Field Tokenizer

**What to build:** A document tokenizer in `Index.html` that parses Homebrewery 5e statblock tags and extracts structured mechanical attributes (AC, HP, resistances, actions) and narrative headers into dedicated searchable fields for MiniSearch.

**Blocked by:** 01: Core In-Memory MiniSearch Manifest Indexing

**Status:** completed

- [x] Pre-processor parses Homebrewery tags (`{monster,frame}`) and extracts monster properties (`Armor Class`, `Hit Points`, `Speed`, `Damage Resistances`).
- [x] MiniSearch index schema expands to include `['title', 'tags', 'properties', 'content']`.
- [x] When a markdown file or encounter dossier is cached or viewed, its tokenized fields are added or updated in the MiniSearch index.
- [x] Searching for mechanics (e.g. "radiant vulnerability" or "legendary resistance") correctly matches relevant monster statblocks.
- [x] Vitest test asserts correct extraction of statblock fields from sample Homebrewery markdown text.
