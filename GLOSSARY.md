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
The on-demand voice query listener activated from the Player Companion to capture a spoken rules question and match it against the Rules Glossary.
_Avoid_: Voice assistant, always-on mic, speech bot, rule search bar.

**Rules Glossary**:
The unified collection of 5e mechanics, spell definitions, condition summaries, and campaign lore entries indexed for instant lookup by the Player Companion and GM Screen.
_Avoid_: Rulebook, SRD dump, lore dictionary, reference table.

**Rule Card**:
A dismissible quick-reference card displaying a matched game mechanic, spell, or condition summary with player feedback controls.
_Avoid_: Tooltip, popup, rule modal, glossary toast.

**Speech Chunk**:
A timestamped, voice-gated audio segment containing active table speech stripped of room silence.
_Avoid_: Audio clip, recording slice, voice snippet, raw stream.

**Audio Cue**:
A structured intent signal derived from a classified Speech Chunk—identifying a musical shift, rules question, or table banter—dispatched to the GM Screen.
_Avoid_: Webhook payload, intent event, voice command, classifier message.

**Attendance Quorum**:
The session readiness status calculated from player RSVPs against the campaign minimum attendance threshold and active Storyline Locks.
_Avoid_: Headcount, invite check, RSVP tally, roster check.

**Storyline Lock**:
A designation on a player whose character is central to the upcoming session's narrative arc, requiring their confirmed attendance for Attendance Quorum to hold.
_Avoid_: Mandatory player, VIP attendee, critical role, quorum blocker.

**Weather Hexflower**:
The campaign's maritime weather probability table rolled via 2d8 once Attendance Quorum is met to forecast sea conditions for the upcoming Session.
_Avoid_: Weather chart, random weather table, sea forecast generator, climate roll.

**Narrative Promise**:
An in-session GM commitment—such as a pending rules adjudication, custom crafting timer, NPC favor, or plot debt—recorded in Table Notes and tracked as an actionable post-session prep task.
_Avoid_: Todo item, reminder, action item, quest log.
