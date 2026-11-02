# Spec: Zero-Token Google Workspace Governance (Calendar & Tasks)

**Status:** `ready-for-agent`

## Problem Statement

Tabletop scheduling and post-session administration create recurring friction: sessions risk last-minute cancellations if attendance isn't audited in advance, and narrative promises made during 4-hour sessions (custom crafting requests, NPC favors, legal debts) are easily forgotten if not transcribed into actionable GM prep tasks.

## Solution

Deploy two zero-token Apps Script background automations:

1. **Google Calendar 72-Hour Quorum Auditor:** A time-driven trigger inspecting guest RSVP statuses 72 hours before Saturday sessions, rescheduling if under the 3-player quorum, and populating Harptos calendar dates and weather conditions.
2. **Gemini Post-Session Promise Extractor:** A script triggered upon `table_notes.md` completion that calls Gemini 1.5 Flash via structured JSON schema to extract pending GM commitments and populates them directly into Google Tasks.

## User Stories

1. As a Game Master, I want an automated script to inspect attendee RSVPs 72 hours prior to scheduled sessions, so that the game is cancelled and shifted forward automatically if fewer than 3 players confirm.
2. As a Game Master, I want the Calendar event description to automatically reflect the current in-game Harptos date, planar alignment, and weather, so that players have immediate narrative context.
3. As a Game Master, I want saving `table_notes.md` to optionally trigger a Gemini 1.5 Flash task extraction, so that rulings, crafting deadlines, and NPC promises are appended to my Google Tasks list.
4. As a Game Master, I want extracted tasks to include source tags and session dates, so that I can easily trace obligations back to the session context.

## Implementation Decisions

- **Calendar Service:** Native Apps Script `CalendarApp.getGuestList()` and `.getGuestStatus()`.
- **Tasks Service:** Apps Script Advanced Service `Tasks.Tasks.insert()`.
- **AI Extraction Schema:** Gemini 1.5 Flash with `response_mime_type: "application/json"` defining `{ tasks: [{ title, notes, due, category }] }`.

## Testing Decisions

- **Server Tests:** Vitest node VM tests verifying RSVP quorum calculation logic, date shifting algorithms, and Gemini JSON schema validation.

## Out of Scope

- Synchronous automated sync to NotebookLM (awaiting official API).
- Multi-user write locks in Google Sheets.
