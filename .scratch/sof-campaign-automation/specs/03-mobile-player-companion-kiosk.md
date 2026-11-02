# Spec: Universal Mobile Responsive Viewport & BYOD Player Companion

**Status:** `ready-for-agent`

## Problem Statement

During live play, players frequently ask for spell definitions, condition rules, and status effect mechanics, diverting the Game Master from running encounters. Dedicated burner phone kiosks create device clutter and battery maintenance, while unconstrained ambient phone microphones pick up TV bleed and trigger false-positive rule cards.

## Solution

Extend `Index.html` with a responsive viewport fork (`@media (max-width: 768px)`). When accessed on personal smartphones, the interface transforms into a silent **Player Companion**: players select their character identity (_Pog, Vaelor, Orca, Fade_), use an on-demand Push-to-Talk (PTT) button for intentional 3–4 second voice queries, and view high-contrast rule cards with crowdsourced feedback buttons logging to Google Sheets.

## User Stories

1. As a player on a smartphone, I want the web app to automatically render a clean mobile card HUD instead of the desktop GM sidebar and scratchpad, so that the screen is simple and touch-friendly.
2. As a player, I want to select my character identity once and have it persist in `localStorage`, so that my feedback votes are automatically tagged with my character name.
3. As a player, I want to tap a prominent Push-to-Talk button to activate the microphone for 3–4 seconds to ask a rule question ("Misty Step"), so that casual table chatter and TV audio never trigger unwanted cards.
4. As a player, I want matching rule cards to display title, source glossary, and rule text with an automatic 30-second dismiss timer, so that the screen does not remain cluttered.
5. As a player, I want to tap "Helpful" or "Irrelevant" on a card to log the heard phrase and match quality directly into the campaign Google Sheet (`Rules_Helper_Feedback`), so that we can continuously improve the campaign glossary.
6. As a Game Master, I want phone audio completely muted on the player devices, so that acoustic feedback loops are impossible.

## Implementation Decisions

- **Responsive Fork:** `@media (max-width: 768px)` hides `#sidebar` and `#workspace` and reveals `#player-hud`.
- **Speech Recognition:** Browser `webkitSpeechRecognition` with `continuous: false` bound strictly to PTT touch events.
- **Fuzzy Glossary Matching:** Client-side Levenshtein scoring against the campaign markdown glossary loaded on boot.
- **Backend Logging:** `logRuleFeedback()` endpoint in `Code.gs` appending rows to `Rules_Helper_Feedback`.

## Testing Decisions

- **Client Tests:** Vitest DOM tests verifying viewport responsive toggling, localStorage identity caching, and card timeout decay.

## Out of Scope

- Continuous open-microphone ambient listening.
- Audio playback on player mobile devices.
