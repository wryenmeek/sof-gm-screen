# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations. `gh` automatically resolves `{owner}/{repo}` from the current git repository.

## Commands

- **Create an issue**: `gh issue create --title "..." --body "..."` (use `--body-file` or heredoc for multi-line bodies).
- **Read an issue**: `GH_PAGER=cat gh issue view <number> --comments`
- **Batch-read open issues**:
  `gh issue list --state open --json number,title,body,labels,comments`
- **Get numeric database IDs for issue linking**:
  `gh api 'repos/{owner}/{repo}/issues?state=all' --jq '.[] | {number, id}'`
  _(Note: `gh issue list --json id` returns the GraphQL node ID; native sub-issue and dependency APIs require the numeric REST ID above)._
- **Comment / Edit / Close**:
  - `gh issue comment <number> --body "..."`
  - `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
  - `gh issue close <number> --comment "..."`

## Request Intake Surface

Use GitHub issues as the exclusive intake surface for work requests and specifications. GitHub shares a single number space across issues and PRs; if `#42` fails as an issue or PR, check the alternate type with `gh pr view <n>` or `gh issue view <n>`.

## Sub-Issue & Dependency Graph Operations

Used by `wayfinder`, `to-tickets`, and `implement-spec`:

- **Parent issue**: A single issue labelled `wayfinder:map` (for maps) or `ready-for-agent` (for feature specs).
- **Link child sub-issue**:
  `gh api --method POST repos/{owner}/{repo}/issues/<parent-number>/sub_issues -F sub_issue_id=<child-db-id>`
- **Link blocker dependency (`blocked_by`)**:
  `gh api --method POST repos/{owner}/{repo}/issues/<child-number>/dependencies/blocked_by -F issue_id=<blocker-db-id>`
- **Query unblocked frontier tickets**:
  Query the parent's sub-issues via the REST API to inspect `issue_dependencies_summary.blocked_by`:

  ```bash
  gh api repos/{owner}/{repo}/issues/<parent-number>/sub_issues \
    --jq '[.[] | select(.state == "open" and .issue_dependencies_summary.blocked_by == 0 and (.assignees | length) == 0)] | .[0]'
  ```

- **Claim ticket**: `gh issue edit <number> --add-assignee @me`
- **Resolve ticket**: Post resolution details with `gh issue comment <number> --body "..."` and close with `gh issue close <number>`.
