# 03: BM25+ Ranking, Field Boosting & Keyboard Shortcut

**What to build:** Relevance-ranked BM25+ scoring with field boosting, fuzzy typo tolerance, keyboard shortcut navigation (`/`), and search hit highlighting in the GM Screen sidebar.

**Blocked by:** 02: 5e Statblock & Dossier Multi-Field Tokenizer

**Status:** completed

- [x] MiniSearch search options configure field boosting: `boost: { title: 3.0, tags: 2.5, properties: 2.0, content: 1.0 }`.
- [x] Fuzzy search tolerance is enabled (`fuzzy: 0.2`) so single-character typos still match targets.
- [x] Pressing `/` outside of input fields immediately focuses `#filter-input` and selects its text.
- [x] Pressing `Esc` clears the search input, un-focuses the field, and resets the manifest list.
- [x] Clicking a search result loads the asset into the primary pane and highlights its card in gold.
- [x] Vitest test validates that boosted title hits score higher than body text hits for identical search terms.
