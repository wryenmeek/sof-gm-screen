# 08: Mobile Push-to-Talk (PTT) Rules Sniffer & Feedback Sheet Logger

**What to build:** On-demand Push-to-Talk button using `webkitSpeechRecognition` for 3–4 second voice queries on player phones, displaying matching rule cards from the campaign glossary and logging crowdsourced votes to Google Sheets.

**Blocked by:** 07: Universal Mobile Responsive Viewport & Player HUD

**Status:** completed

- [x] PTT button ("🎙️ Tap to Ask Rule") activates a single-shot, 4-second `webkitSpeechRecognition` listening window.
- [x] Audio remains 100% muted on player devices to prevent table acoustic feedback.
- [x] Recognized phrases match against in-memory campaign markdown glossaries using fuzzy string matching.
- [x] Matching cards display title, source, and rule summary with a 30-second auto-dismiss decay timer.
- [x] "👍 Helpful" and "👎 Irrelevant" buttons call `google.script.run.logRuleFeedback()` to append a row to `Rules_Helper_Feedback` in the campaign Google Sheet.
- [x] Vitest client test verifies PTT timer cleanup and feedback payload structure.
