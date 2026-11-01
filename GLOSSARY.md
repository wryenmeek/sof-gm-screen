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
