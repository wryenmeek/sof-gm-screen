# Agent Guidelines

## Engineering Workflow

Follow the end-to-end flow from initiative to merged PR in [`docs/agents/workflow.md`](docs/agents/workflow.md) before planning, speccing, ticketing, or implementing work.

## Issue Tracker & Dependencies

Read [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) when creating, reading, querying, or linking specs, tickets, sub-issues, and native GitHub `blocked_by` dependencies via `gh`.

## Repository Labels

Consult [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md) for canonical triage and workflow labels.

## Domain Architecture & Coding Standards

Consult [`GLOSSARY.md`](GLOSSARY.md) for canonical vocabulary and [`CODING_STANDARDS.md`](CODING_STANDARDS.md) for active ADRs (`docs/adr/`) and cross-boundary rules. See [`docs/agents/domain.md`](docs/agents/domain.md) for domain documentation conventions.

## Quality Gate & Local Verification

Run `npm run check` before committing changes or opening a PR; `.githooks/pre-commit` enforces this automatically. To verify the full `.github/workflows/ci.yml` pipeline locally in Docker, run `bash scripts/act/install-act.sh` (if `act` is missing) and `bash scripts/act/run-act.sh "push -j check"`.
