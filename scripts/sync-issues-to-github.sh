#!/usr/bin/env bash
#
# Syncs local markdown issues from .scratch/sof-campaign-automation/issues/ to GitHub.
# Uses the gh CLI and applies the canonical triage labels.

set -euo pipefail

SCRIPTPATH="$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(dirname "$SCRIPTPATH")"
ISSUES_DIR="$REPO_ROOT/.scratch/sof-campaign-automation/issues"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is not installed or not in PATH."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Please run 'gh auth login' first."
  exit 1
fi

echo "=================================================="
echo "🚀 Publishing Sea of Fortune Issues to GitHub"
echo "=================================================="

for issue_file in "$ISSUES_DIR"/*.md; do
  [ -f "$issue_file" ] || continue
  
  title=$(head -n 1 "$issue_file" | sed 's/^# //')
  echo "Creating issue: $title..."
  
  gh issue create \
    --title "$title" \
    --body-file "$issue_file" \
    --label "ready-for-agent"
done

echo "✨ All issues created successfully on GitHub!"
