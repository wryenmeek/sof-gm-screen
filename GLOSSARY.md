# Sea of Fortune GM Screen

Single-pane live session dashboard and digital screen for Game Masters running the Sea of Fortune tabletop campaign.

## Language

### Sessions & Structure

**Session**:
A scheduled tabletop roleplaying session identified by its date (`YYYY-MM-DD`), containing all narrative prep, tactical encounters, and media for that game.
_Avoid_: Episode, game night, run, match.

**Session Asset**:
Any media file, narrative text, tactical card, or audio track associated with a session.
_Avoid_: File, artifact, resource, attachment.

**Shortcut Folder**:
A pointer within a session folder linking to a shared asset library (such as floor maps or monster catalogues).
_Avoid_: Symlink, alias, virtual folder, subfolder.

### GM Interface

**GM Screen**:
The consolidated live dashboard interface displaying session assets, encounter dossiers, maps, and quick references side-by-side during play.
_Avoid_: Admin panel, console, web app, viewer.

**Pinned Pane**:
The secondary view pane in the GM Screen locked to a specific asset (such as a Floor Map or Encounter Dossier) while continuing to browse other assets in the primary pane.
_Avoid_: Right pane, secondary view, split screen, pinned tab.

**Table Notes**:
The dedicated markdown scratchpad used during active play to record dynamic initiative orders, ad-hoc rulings, and awarded loot.
_Avoid_: Scratchpad, scratch notes, scratch file, session log.

**Session Manifest**:
The structured inventory of all discovered session assets and unpacked shortcut libraries available for a given session.
_Avoid_: File list, directory tree, catalog, asset index.

### Game Content

**Encounter Dossier**:
A structured briefing document detailing a specific combat, puzzle, or social challenge, including phases, triggers, lore, and environmental effects.
_Avoid_: Encounter doc, battle guide, prep sheet, adventure note.

**Monster Statblock**:
A formatted reference card defining a creature's game mechanics, attributes, defenses, traits, and available actions.
_Avoid_: Monster card, sheet, creature entry, NPC stats.

**Floor Map**:
A visual cartographic depiction of a tactical encounter space, deck layout, or floor plan.
_Avoid_: Battlemap, dungeon map, plan, diagram.

**Handout**:
A player-facing document, prop, translated script, or companion handout referenced during play or linked from an Encounter Dossier.
_Avoid_: Player doc, companion handout, attachment, paper, handout file.

### Audio, Companion & Campaign Governance

**Tabletop Mixer**:
The multi-channel audio mixing engine managing continuous ambient loops, thematic musical scores with crossfades, and one-shot sound effects with automatic score ducking during a session.
_Avoid_: Soundboard, music player, audio controller, synthesizer.

**Mood Cue**:
A named thematic state transition—such as exploration, tension, combat, or rest—that triggers a musical score crossfade in the Tabletop Mixer.
_Avoid_: Music trigger, track switch, vibe shift, playlist cue.

**Audio Timeline Sidecar**:
The chronological event log recording mixer state transitions and track cues during play for post-session recap synchronization.
_Avoid_: Audio history, playback log, track history, mixer dump.

**Player Companion**:
The player-facing interface displaying character identity selection, voice rule lookups, and dismissible rule cards without exposing GM-only encounter notes.
_Avoid_: Mobile app, player view, phone mode, mini screen.

**Push-to-Talk Rules Sniffer**:
The on-demand voice query listener activated from the Player Companion or GM Screen to capture a spoken rules question and evaluate it across the Rules Lookup Ladder.
_Avoid_: Voice assistant, always-on mic, speech bot, rule search bar.

**Rules Glossary**:
The unified collection of 5e mechanics, spell definitions, condition summaries, and campaign lore entries indexed for instant lookup by the Player Companion and GM Screen.
_Avoid_: Rulebook, SRD dump, lore dictionary, reference table.

**Rule Card**:
A dismissible quick-reference modal displaying a matched game mechanic or Rules Arbiter ruling with summary, detailed ruling, Rule Citations, Rule Confidence badge, and Rule Feedback controls with a 30-second hover-pausable decay timer.
_Avoid_: Tooltip, popup, rule modal, glossary toast.

**Speech Chunk**:
A timestamped, voice-gated audio segment containing active table speech stripped of room silence.
_Avoid_: Audio clip, recording slice, voice snippet, raw stream.

**Audio Cue**:
A structured intent signal derived from classified audio or Rules Broadcast—identifying a musical shift (`MUSIC_CUE`), sound effect (`SFX`), or table rules query (`RULE_QUERY`)—dispatched to the shared `live/audio_cue` Firestore document.
_Avoid_: Webhook payload, intent event, voice command, classifier message.

**Attendance Quorum**:
The session readiness status calculated from player RSVPs against the campaign minimum attendance threshold and active Storyline Locks.
_Avoid_: Headcount, invite check, RSVP tally, roster check.

**Storyline Lock**:
A designation on a player whose character is central to the upcoming session's narrative arc, requiring their confirmed attendance for Attendance Quorum to hold.
_Avoid_: Mandatory player, VIP attendee, critical role, quorum blocker.

**Rules Arbiter**:
The client-side conversational AI adjudication engine (powered by Firebase AI Logic and Gemini 2.5 Flash) that parses complex, natural-language 5e rules questions, cross-references Rules as Written (RAW) and Rules as Intended (RAI), and yields structured rulings with citations and confidence tiers.
_Avoid_: AI GM, rulebot, oracle, ChatGPT helper, chatbot.

**Rule Confidence**:
The qualitative certainty rating—`exact` (1.0, codified RAW), `interpretation` (0.75, RAI tactical adjudication), or `unsupported` (0.5, table ruling required)—assigned by the Rules Arbiter and rendered as a visual badge on Rule Cards.
_Avoid_: Certainty score, probability, accuracy rating, arbiter score.

**Rule Citation**:
A specific authoritative source reference (e.g. `PHB p. 195`, `DMG p. 248`, `XGE p. 77`) formatted as an interactive pill on Rule Cards grounding a ruling in official 5e texts.
_Avoid_: Rule reference, book quote, page link, bibliography.

**Rules Broadcast**:
The real-time publish-subscribe dissemination of a resolved rule query from the inquiring client to the shared `live/audio_cue` document in Firestore, expanding synchronized Rule Cards across all connected GM Screen and Player Companion devices simultaneously.
_Avoid_: Rule sync, pubsub announcement, tabletop blast, screen broadcast.

**Rule Feedback**:
The player or GM rating (`+1` helpful, `-1` irrelevant) recorded either in Firestore `rules_feedback` collection (for Rules Arbiter rulings) or Google Sheets via Apps Script (for static glossary lookups) to evaluate adjudication quality.
_Avoid_: Rule vote, like/dislike, review, rating.

**Rules Lookup Ladder**:
The 3-tier lookup progression governing table rules inquiries: Tier 1 (local RAM MiniSearch index, <5ms, zero token), Tier 2 (cloud Firebase AI Logic / Gemini 2.5 Flash, ~400–800ms), and Tier 3 (universal local keyword and canonical glossary fallback invoked on offline state, quota exhaustion, network timeouts, API rejections, or unconfigured cloud services).
_Avoid_: Rule hierarchy, fallback chain, search ladder.

**Weather Hexflower**:
The campaign's maritime weather probability table rolled via 2d8 once Attendance Quorum is met to forecast sea conditions for the upcoming Session.
_Avoid_: Weather chart, random weather table, sea forecast generator, climate roll.

**Narrative Promise**:
An in-session GM commitment—such as a pending rules adjudication, custom crafting timer, NPC favor, or plot debt—recorded in Table Notes and tracked as an actionable post-session prep task.
_Avoid_: Todo item, reminder, action item, quest log.

**GM Secret**:
The shared authentication secret configured in Script Properties (`SOF_GM_KEY`) and passed via `gmKey` parameter or request header to guard Game Master RPCs, webhooks, and administrative actions from player exposure.
_Avoid_: Admin password, GM token, auth code, API key.

**3-Tier Classifier**:
The tiered intent classification architecture governing Speech Chunks across Tier 1 (local Raspberry Pi edge model <= 1500ms), Tier 2 (cloud Gemini 2.5 Flash fallback), and Tier 3 (manual GM Screen UI buttons).
_Avoid_: Classifier state machine, fallback hierarchy, intent parser.

**Audio Cache**:
The client-side IndexedDB store (`sof_audio_cache_v1`) pre-caching binary audio Session Assets from Google Drive v3 REST endpoints for zero-latency, CORS-free playback during play.
_Avoid_: Audio storage, track database, sound buffer.

**Edge Audio Manifest**:
The local JSON catalog (`session_audio_manifest.json`) generated on the Raspberry Pi recording timestamped metadata and file paths for all sliced Speech Chunks.
_Avoid_: Session manifest, audio log, speech list.

### Tactical Tabletop & Combat

**Combat Tracker**:
The real-time initiative and encounter synchronization engine tracking turn order, round count, and combatant states between private Game Master administration and public player observation.
_Avoid_: Battle tracker, turn manager, initiative list, fight widget.

**Status Band**:
A descriptive health classification—UNINJURED (100%), INJURED (50-99%), BLOODIED (25-49%), CRITICAL (1-24%), or DOWN (0 HP)—projected to players to reflect physical condition without disclosing exact numerical hit points.
_Avoid_: Health bar, HP tier, wound category, damage status.

**Ambush Combatant**:
A hidden adversary or unrevealed threat present in the Game Master's private encounter state but suppressed from public player projections until deliberately revealed.
_Avoid_: Hidden monster, secret NPC, ambush enemy, stealth combatant.

**Initiative Projection**:
The real-time, player-safe public broadcast reflecting current turn sequence, active combatant, and Status Bands while strictly filtering out Ambush Combatants and precise monster statistics.
_Avoid_: Public combat view, player initiative, sanitized feed.

### Player Companion & Ambient Tabletop

**Character Roster Claiming**:
The atomic concurrency-controlled transaction by which an anonymous or authenticated player claims exclusive operational control of a designated character on the session roster, preventing duplicate selections.
_Avoid_: Character lock, player binding, seat claiming.

**Party Roster Baseline**:
The immutable canonical five-character party roster (`Pog`, `Vaelor`, `Orca`, `Fade`, `Guest`) seeded across tabletop sessions. It acts as a permanent structural fallback ensuring all five character slots remain preserved and accessible across the GM Screen and Player Companions regardless of whether the remote Firestore roster is empty, partially populated, unseeded, or offline.
_Avoid_: Default roster, party template, character placeholder list.

**Table Reaction**:
An ephemeral, 5-emoji tactile reaction (`⚔️`, `🛡️`, `🎲`, `🍻`, `💀`) dispatched by Player Companions to the live tabletop stream and rendered as transient floating bubbles above the Game Master's initiative tracker.
_Avoid_: Emoji reaction, chat sticker, ping, floating icon.
