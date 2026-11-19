# Dual-Engine Real-Time Tabletop Fabric (Cloud Firestore + Google Apps Script)

The Sea of Fortune GM Screen operates across two distinct environments: Google Apps Script serves as the high-privilege asynchronous **Campaign Secretary** for Google Workspace governance (Google Drive session assets, Google Calendar attendance quorum, Google Tasks narrative promises, and Google Sheets feedback archiving), while Cloud Firestore (Modular SDK v11) and Firebase Hosting serve as the low-latency **Live Tabletop Edge Engine** on top-level HTTPS (`sea-of-fortune-gm.web.app`).

## Context & Limitations of Apps Script at the Table

[ADR-0001](0001-google-apps-script-architecture.md) established the GM Screen on Apps Script `HtmlService`, and [ADR-0008](0008-companion-isolation-and-os-dictation-fallback.md) and [ADR-0009](0009-edge-pi-classifier-tiered-fallback.md) bridged audio cues via Apps Script `doPost(e)` and 3-second HTTP polling of `CacheService`. However, live in-person tabletop play imposes strict constraints that Apps Script cannot meet in real time:

1. **Polling Latency & Quota Ceilings:** Client polling of `CacheService` or `PropertiesService` is restricted to $\ge 3000\text{ ms}$ intervals to avoid hitting daily Apps Script quota limits. A 3-second delay between an edge Raspberry Pi detecting combat music and the GM Screen playing the track disrupts tabletop pacing.
2. **Iframe Permissions & Sandbox Restrictions:** Google Apps Script wraps web apps in a cross-origin `#sandboxFrame` that rotates subdomains, strips permissions (`allow="microphone; webgpu"`), and prevents top-level Web Speech API integration.
3. **Multi-Device Tabletop Synchronization:** Synchronizing live combat initiative, HP, and player reactions across GM laptops and player mobile devices requires push-based sub-50ms document propagation, which Apps Script cannot provide natively.

## Decision: The Dual-Engine Architecture

Adopt a dual-engine model combining Google Apps Script and Cloud Firestore:

1. **Role Division:**
   - **Google Apps Script (Campaign Governance):** Owns pre-session manifest generation, Google Drive session folder scanning, Google Calendar 72-hour quorum calculation ([ADR-0010](0010-workspace-governance-quorum-and-on-demand-promises.md)), Google Tasks extraction, and post-session archival of table notes and audio logs.
   - **Cloud Firestore Modular SDK v11 (Real-Time Tabletop Edge):** Owns sub-50ms mood cue broadcasting, bi-directional live combat tracking, player tabletop reactions, and frictionless anonymous player authentication.
2. **Push-Based State Synchronization:**
   Replace client HTTP polling with real-time `onSnapshot` Firestore document and collection listeners (`live/audio_cue`, `live/combat`, `live/reactions`, `characters`).
3. **Partitioned Security Architecture:**
   Enforce structural boundaries via `firestore.rules`:
   - `combat_gm`: Private collection strictly restricted to authenticated GM credentials (`isGm()`), holding unpublished monster statblocks, secret initiatives, and hidden encounter notes.
   - `combat`: Public projection collection readable by all authenticated tabletop devices (`isAuthenticated()`).
   - `characters`: Publicly readable roster where players authenticate anonymously (`signInAnonymously`) and claim unassigned character slots via cryptographic self-ownership (`claimedBy == request.auth.uid`).
   - `live/reactions`: Public ephemeral reaction stream bound to a 20-item sliding FIFO queue with Web Haptics vibration feedback.
4. **Edge Delivery Ladder:**
   The edge Raspberry Pi classifier ([ADR-0009](0009-edge-pi-classifier-tiered-fallback.md)) delivers speech chunk audio cues via a fast-path direct Firestore write ($<35\text{ ms}$) using service account credentials. If the Firestore write fails or times out ($>800\text{ ms}$), the Pi automatically falls back to the existing Apps Script HTTPS `doPost(e)` webhook.
5. **Offline & Multi-Tab Client Persistence:**
   Initialize Firestore with `persistentLocalCache` and `persistentMultipleTabManager` capped at a 100MB LRU budget, ensuring uninterrupted offline operation on mobile devices and table laptops during Wi-Fi dropouts.

## Consequences

- **Positive:** Tabletop mood cue transitions drop from $\ge 3000\text{ ms}$ to $<50\text{ ms}$; zero Apps Script polling quota consumption; instant multi-device combat tracker sync; unblocked top-level HTTPS microphone permissions on Firebase Hosting; resilient offline operation via IndexedDB; frictionless QR code onboarding for players without requiring Google accounts.
- **Negative:** Requires maintaining Firebase Security Rules (`firestore.rules`) and local emulator/mock test harnesses alongside Google Apps Script mocks; requires dual deployment targets (`clasp push` for Apps Script and Firebase Hosting / Rules deployment).

## Amendments

- **2026-11-17 (ADR-0012):** Extended the Firestore live synchronization fabric with `match /live/audio_cue` rules broadcast for `RULE_QUERY` intents (`source in ['companion_ptt', 'gemini_tier2']`), ducking protection, and client-side conversational 5e rules adjudication via Firebase AI Logic (Gemini 2.5 Flash). See [ADR-0012](0012-client-side-rules-arbiter-firebase-ai-logic.md).
- **2026-11-18 (Progressive Fallback & Party Baseline Amendment):** Hardened Character Roster Claiming and GM Party Roster Seeding against unseeded collections and transport errors. When Firestore returns an empty snapshot (`[]`) or partial snapshot, the GM view merges active claims into the canonical 5-character **Party Roster Baseline** (`Pog`, `Vaelor`, `Orca`, `Fade`, `Guest`) preserving unclaimed slots, while listener subscriptions explicitly capture and dispose `gmRosterUnsubscribe_` on reconnect. Character claiming and switching errors (`code: "ERROR"` or promise rejection) fall back cleanly to local identity selection (`selectPlayerIdentity`), reserving race-loss feedback strictly for verified `code: "ALREADY_CLAIMED"` conflicts.
