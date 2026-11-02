# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc or `--body-file` for multi-line bodies.
- **Read a single issue**: `GH_PAGER=cat gh issue view <number> --comments`.
- **Batch-read multiple issues (preferred over `gh issue view` loops)**:
  `gh issue list --state all --limit 50 --json number,id,title,body,state,labels,comments`
  Use a single `--json` call whenever reading multiple specs/tickets or looking up numeric database IDs (`.id`) for `sub_issues` and `blocked_by` wiring.
- **List open issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `GH_PAGER=cat gh issue view <number> --comments` (or batch-fetch via `gh issue list --state all --json ...` when inspecting multiple tickets).

## Wayfinding & Spec Sub-Issue Operations

Used by `/wayfinder` and `/to-tickets`.

- **Parent issue**: a single issue labelled `wayfinder:map` (for maps) or `ready-for-agent` (for feature specs).
- **Child ticket**: an issue linked to the parent as a GitHub sub-issue:
  `gh api --method POST repos/<owner>/<repo>/issues/<parent-number>/sub_issues -F sub_issue_id=<child-db-id>`
- **Blocking**: GitHub's **native issue dependencies**. Add an edge with:
  `gh api --method POST repos/<owner>/<repo>/issues/<child-number>/dependencies/blocked_by -F issue_id=<blocker-db-id>`
  where `<blocker-db-id>` is the blocker's numeric **database id** (`gh issue list --state all --json number,id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the parent's open children, drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`) or an assignee; first in order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the parent's Decisions-so-far.
