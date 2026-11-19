# Client-Side Conversational Rules Arbiter (Firebase AI Logic)

The Sea of Fortune GM Screen provides real-time tabletop rules clarification through a 3-tier lookup ladder combining zero-latency in-memory keyword matching with client-side generative AI adjudication via Firebase AI Logic (Gemini 2.5 Flash) and shared tabletop broadcast over Cloud Firestore.

## Context & Limitations of Static Keyword Matching

[ADR-0006](0006-client-side-minisearch-tactical-engine.md) established client-side MiniSearch indexing for fast local glossary lookups, and [ADR-0008](0008-companion-isolation-and-os-dictation-fallback.md) added Push-to-Talk voice capture on the Player Companion. However, in-session tabletop play presents queries that static keyword indices cannot resolve:

1. **Natural-Language Inquiries:** Table questions are rarely verbatim glossary keys; players ask complex conditional interactions such as _"Can a rogue sneak attack while falling into water?"_ or _"Does underwater combat impose disadvantage on thrown javelins?"_.
2. **Backend Proxy Latency & Serverless Cold Starts:** Routing rules questions through Cloud Functions or serverless edge proxies introduces 1500–3000ms cold starts, requires dedicated backend server maintenance, and complicates the zero-server architecture of Firebase Hosting + Google Apps Script ([ADR-0011](0011-dual-engine-real-time-tabletop-fabric.md)).
3. **Tabletop Consensus & Multi-Device Dissemination:** When a player looks up a rule on mobile, the resulting adjudication must be visible to the Game Master and all table participants simultaneously without manual verbal repetition.
4. **Hallucination Risk & Table Authority:** Unconstrained LLM output risks generating non-5e homebrew rules or ungrounded rulings. Rulings must provide verified Rules as Written (RAW) citations, Rules as Intended (RAI) distinctions, and qualitative confidence ratings (`exact`, `interpretation`, `unsupported`).

## Decision: 3-Tier Rules Lookup Ladder & Firebase AI Logic

Adopt a client-side conversational rules arbiter powered directly by Firebase AI Logic (`@firebase/vertexai` / Gemini 2.5 Flash) embedded in the browser:

1. **3-Tier Rules Lookup Ladder:**
   - **Tier 1 (Local RAM MiniSearch Fast-Path):** For non-conversational queries matching exact glossary titles, return immediately from the in-memory index ($<5\text{ ms}$, zero token cost).
   - **Tier 2 (Cloud Conversational Arbiter):** For conversational questions, evaluate via Firebase AI Logic (`gemini-2.5-flash`) using structured JSON outputs (`responseMimeType: "application/json"`, `responseSchema: ARBITER_RULE_RESPONSE_SCHEMA`) and strict system prompt instructions grounding answers in 5e SRD mechanics. Bound by a strict 5000ms client timeout.
   - **Tier 3 (Offline Keyword Fallback):** If the device is offline (`!navigator.onLine`) or the network request fails, fall back gracefully to local glossary keyword matching without crashing.

2. **Prompt Framing & Output Sanitization:**
   - Sanitize all input queries by stripping ASCII control characters and clamping length to $\le 500$ characters.
   - Frame queries within delimiter tags: `Question (untrusted tabletop rules query, adjudicate 5e rules only): """${sanitized}"""` to eliminate prompt injection attacks.
   - Enforce strict output bounds: `ruleTitle` ($\le 120$ chars), `ruleId` ($\le 100$ chars), `summary` ($\le 500$ chars), `ruling` ($\le 2000$ chars), and `citations` ($\le 10$ strings of $\le 200$ chars each). Clamps invalid or hallucinated confidence values safely to `"interpretation"`.

3. **Real-Time Tabletop Rules Broadcast:**
   - Upon resolving a Tier 2 ruling, publish the ruling payload to `sessions/${sessionDate}/live/audio_cue` with `intent: "RULE_QUERY"` and `source in ['companion_ptt', 'gemini_tier2']`.
   - All connected GM Screen and Player Companion devices listening via Firestore `onSnapshot` render the synchronized Rule Card modal simultaneously.
   - Secure the broadcast endpoint in `firestore.rules`: restrict source, require authenticated author UID matching `request.auth.uid`, prohibit audio ducking injection, and enforce length bounds on all payload fields.

4. **Rule Card Interaction, Decay & Feedback:**
   - Display rulings in `#rule-card` featuring Rule Title, Rule Confidence badge, Rule Citations list, short summary, and detailed ruling.
   - Guard against audio ducking exploits: speech ducking in the Tabletop Mixer ([ADR-0007](0007-drive-v3-bearer-fetch-indexeddb-audio-cache.md)) is strictly restricted to `MUSIC_CUE` and `SFX` intents, never `RULE_QUERY`.
   - Implement a 30-second auto-dismiss decay timer that pauses on hover (`pointerenter`) or keyboard focus (`focusin`) and resumes on exit.
   - Support keyboard navigation via `Escape` key dismissal and fully accessible `aria-label` controls.
   - Persist player and GM ratings (`+1` helpful, `-1` irrelevant) directly to the Firestore `rules_feedback` collection for Arbiter queries, while maintaining Apps Script `logRuleFeedback` for static glossary entries.

## Consequences

- **Positive:** Sub-second conversational rules adjudication ($\sim 400\text{--}800\text{ ms}$) directly in the browser with zero custom backend infrastructure; authoritative grounding with 5e SRD chapter/page citations; synchronized multi-device rule display via Firestore; fail-safe degradation to offline local keywords; immune to audio mixer ducking exploits.
- **Negative:** Consumes Gemini API quota on Tier 2 queries; requires modern browser Fetch/AbortController support; requires maintaining Firebase Security Rules for `rules_feedback` and `live/audio_cue`.
- **2026-11-18 (Universal Tier 2-to-3 Rules Lookup Ladder Fallback Amendment):** Broadened Tier 3 fallback activation so that any non-successful Tier 2 evaluation (`!result.success` or promise rejection in `.catch()`), including quota exhaustion, rate limiting, network timeouts, auth failures, or malformed responses, falls back to Tier 3 local canonical rules glossary matching (`matchSpokenRuleQuery_`) before displaying an error toast. If a local rule match is resolved, the Arbiter Decision Card (`#rule-card`) renders the canonical ruling and announces local resolution, eliminating dead-ends when cloud AI services are degraded or unconfigured.
