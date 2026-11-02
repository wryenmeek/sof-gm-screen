# 09: Standalone 72-Hour Calendar Attendance Quorum Auditor

**What to build:** Time-driven Google Apps Script background trigger that audits attendee RSVP status 72 hours prior to alternate-Saturday sessions, automatically rescheduling if under the 3-player quorum and injecting Harptos calendar/weather info.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] Apps Script function `auditCalendarQuorum()` inspects attendee RSVP status via `CalendarApp.getGuestList()`.
- [x] If confirmed attendees (`GuestStatus.YES`) are fewer than 3, the session is cancelled and moved forward to the next alternate Saturday.
- [x] Cancellation and reschedule notices are dispatched via automated email notification.
- [x] If quorum is met, event description updates with the current in-game Harptos date, planar alignment, and prevailing weather forecast.
- [x] Apps Script time-driven trigger configured to run every Wednesday at 12:00 PM (72h prior to Saturday game time).
- [x] Node VM unit test verifies quorum calculation logic and date math.
