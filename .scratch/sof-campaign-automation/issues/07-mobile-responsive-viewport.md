# 07: Universal Mobile Responsive Viewport & Player HUD

**What to build:** Responsive CSS viewport fork (`@media (max-width: 768px)`) in `Index.html` transforming the screen on personal smartphones into a streamlined, touch-friendly Player Companion HUD with persistent character identity selection.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] `@media (max-width: 768px)` hides `#sidebar` and `#workspace` split panes and displays `#player-hud`.
- [x] On first mobile load, a modal prompts: "Who are you? [ Pog | Vaelor | Orca | Fade | Guest ]" and stores selection in `localStorage`.
- [x] Top mobile header displays current character identity and active session date.
- [x] High-contrast, large touch-target layout formatted for handheld vertical use under low table lighting.
- [x] Vitest DOM test verifies viewport breakpoint toggle and localStorage identity persistence.
