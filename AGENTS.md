# Agent Guidelines

## Agent skills

### Engineering workflow

End-to-end flow for charting foggy initiatives (`wayfinder`), grilling designs (`grill-with-docs`), publishing specs (`to-spec`) and tracer-bullet tickets (`to-tickets`), implementing via TDD worktrees (`implement`, `implement-spec`), and running two-axis reviews (`code-review`). Read `docs/agents/workflow.md` before planning, speccing, ticketing, or implementing work.

### Issue tracker

Issues and specs for this repo live as GitHub issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles mapped 1:1 (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs & coding standards

Single-context layout (`GLOSSARY.md`, `CODING_STANDARDS.md`, and `docs/adr/` at repo root). See `docs/agents/domain.md` and `CODING_STANDARDS.md`.

### Quality gate & local CI verification

Run `npm run check` before committing or opening a PR; `.githooks/pre-commit` enforces this automatically (`bun install` sets `core.hooksPath`). To verify `.github/workflows/ci.yml` locally in Docker with `act`, run `bash scripts/act/install-act.sh` (if missing) and `bash scripts/act/run-act.sh "push -j check"`.
