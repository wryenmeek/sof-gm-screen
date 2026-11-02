# Engineering Workflow

End-to-end flow for taking work from idea to merged PR in this repository. Several workflow skills in `.agents/skills/` set `disable-model-invocation: true` (omitting them from the system skill list); read the linked `SKILL.md` directly before running that phase.

Router & phase-boundary reference:

- [`.agents/skills/ask-matt/SKILL.md`](../../.agents/skills/ask-matt/SKILL.md)
- [`.agents/skills/ask-matt/PHASE-BOUNDARIES.md`](../../.agents/skills/ask-matt/PHASE-BOUNDARIES.md)

## Tracker & artifact locations

All maps, specs, and implementation tickets live as **GitHub issues** operated via `gh` ([`docs/agents/issue-tracker.md`](issue-tracker.md)):

| Artifact | Location | Label |
| --- | --- | --- |
| Wayfinder map | GitHub issue (`gh issue create`) | `wayfinder:map` |
| Wayfinder decision ticket | GitHub sub-issue of the map | `wayfinder:research` \| `prototype` \| `grilling` \| `task` |
| Feature spec | GitHub issue (`gh issue create`) | `ready-for-agent` |
| Implementation ticket | GitHub sub-issue of the spec with native `blocked_by` edges | `ready-for-agent` |
| Domain vocabulary & ADRs | [`GLOSSARY.md`](../../GLOSSARY.md) and [`docs/adr/`](../adr/) | — |

## Main flow: idea → ship

Keep steps 1–3 in **one unbroken context window** so domain terms, spec, and tickets share the same primary source. Start a fresh context window (or isolated subagent worktree) for step 4.

### 1. Sharpen the domain and design (`grill-with-docs`)

Read [`.agents/skills/grill-with-docs/SKILL.md`](../../.agents/skills/grill-with-docs/SKILL.md), [`.agents/skills/grilling/SKILL.md`](../../.agents/skills/grilling/SKILL.md), and [`.agents/skills/domain-modeling/SKILL.md`](../../.agents/skills/domain-modeling/SKILL.md).

- Interview the user to resolve design decisions and domain language.
- Record every new or sharpened domain term in [`GLOSSARY.md`](../../GLOSSARY.md) and every hard-to-reverse architectural choice as a numbered ADR in [`docs/adr/`](../adr/).
- If a design question requires runnable code to settle, detour via [`.agents/skills/handoff/SKILL.md`](../../.agents/skills/handoff/SKILL.md) and [`.agents/skills/prototype/SKILL.md`](../../.agents/skills/prototype/SKILL.md) on a `prototype/<name>` branch.
- **Completion criterion:** Every open design decision is answered by the user, and `GLOSSARY.md` / `docs/adr/` reflect all agreed terms and architectural constraints.

### 2. Synthesize the spec (`to-spec`)

Read [`.agents/skills/to-spec/SKILL.md`](../../.agents/skills/to-spec/SKILL.md).

- Propose the highest-level testing seams (`test/client.test.ts`, `test/server.test.ts`) and confirm them with the user.
- Write the spec using the template in `to-spec/SKILL.md` (`Problem Statement`, `Solution`, `User Stories`, `Implementation Decisions`, `Testing Decisions`, `Out of Scope`), using `GLOSSARY.md` terms and omitting file paths or code snippets.
- Publish the spec as a GitHub issue via `gh issue create --label "ready-for-agent"`.
- **Completion criterion:** User confirms the testing seams, and the spec is published as a GitHub issue with its issue number recorded.

### 3. Slice into tracer-bullet tickets (`to-tickets`)

Read [`.agents/skills/to-tickets/SKILL.md`](../../.agents/skills/to-tickets/SKILL.md).

- Draft vertical **tracer-bullet** slices that each cut end-to-end through schema/API/UI/tests, are verifiable alone, and fit in a single context window.
- Declare `Blocked by` edges for each ticket.
- **Quiz the user** on ticket granularity and blocking edges; iterate until approved.
- Publish approved tickets as GitHub issues (`gh issue create --label "ready-for-agent"`) in dependency order (blockers first), linked as sub-issues of the spec issue with native GitHub `blocked_by` dependencies per [`docs/agents/issue-tracker.md`](issue-tracker.md).
- **Completion criterion:** User approves the breakdown, and all tickets are published as GitHub sub-issues with blocking edges wired.

### 4. Implement tickets (`implement` or `implement-spec`)

Choose single-ticket or orchestrated execution:

- **Single ticket (`implement`):** Read [`.agents/skills/implement/SKILL.md`](../../.agents/skills/implement/SKILL.md) and [`.agents/skills/tdd/SKILL.md`](../../.agents/skills/tdd/SKILL.md). Fetch the unblocked ticket via `gh issue view <n> --comments`, build via red-green-refactor vertical slices, run `npm run check` (`lint`, `typecheck`, `test`, `validate`), run `code-review`, and commit.
- **Full spec task graph (`implement-spec`):** Read [`.agents/skills/implement-spec/SKILL.md`](../../.agents/skills/implement-spec/SKILL.md).
  1. Create an integration branch off `main`.
  2. For each unblocked frontier ticket, launch a fresh implementer subagent in an isolated git worktree on its own branch driving `tdd`.
  3. Merge completed ticket branches into the integration branch via a merger subagent, advancing the frontier.
  4. Run `code-review` across the integration branch and remediate all findings in a fresh implementer subagent.
- **Completion criterion:** Every acceptance criterion on the ticket(s) is genuinely implemented (no stubbed acceptance criteria), `npm run check` passes 100%, and `code-review` reports zero unresolved violations.

### 5. Review, PR, and retrospective (`code-review` → `pr` → `retro`)

- **Two-axis review (`code-review`):** Read [`.agents/skills/code-review/SKILL.md`](../../.agents/skills/code-review/SKILL.md). Spawn two parallel subagents (**Standards** + **Spec**) against `git diff <base>...HEAD` and aggregate their reports side by side.
- **Pull request (`pr`):** Read [`.agents/skills/pr/SKILL.md`](../../.agents/skills/pr/SKILL.md) when opening or updating a PR.
- **Retrospective (`retro`):** Read [`.agents/skills/retro/SKILL.md`](../../.agents/skills/retro/SKILL.md) after a build to turn mechanical mistakes into deterministic checks (`npm run check`) and judgement calls into documented standards.

## On-ramps onto the main flow

- **Large, foggy initiative (`wayfinder`):** Read [`.agents/skills/wayfinder/SKILL.md`](../../.agents/skills/wayfinder/SKILL.md).
  - Charts a single GitHub issue labelled `wayfinder:map` and child **decision tickets** (`## Question`) labelled `wayfinder:research | prototype | grilling | task`.
  - **Plan, don't do:** Wayfinder resolves decisions (one HITL ticket per session, plus parallel AFK `research` subagents on `research/<name>` branches). Once the fog clears, hand off to `to-spec` on the main flow.
- **Incoming bug reports or untriaged issues (`triage`):** Read [`.agents/skills/triage/SKILL.md`](../../.agents/skills/triage/SKILL.md) to move raw issues to `ready-for-agent`.
- **Broken or regressing behaviour (`diagnosing-bugs`):** Read [`.agents/skills/diagnosing-bugs/SKILL.md`](../../.agents/skills/diagnosing-bugs/SKILL.md) to establish a single red command before fixing with a regression test.
- **Architecture deepening (`improve-codebase-architecture`):** Read [`.agents/skills/improve-codebase-architecture/SKILL.md`](../../.agents/skills/improve-codebase-architecture/SKILL.md) and [`.agents/skills/codebase-design/SKILL.md`](../../.agents/skills/codebase-design/SKILL.md).
