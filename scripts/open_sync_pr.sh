#!/usr/bin/env bash
# Publish the current commit on the dated sync branch and open or update its pull request.
# actions/checkout only tracks main, so a bare --force-with-lease has no lease and is rejected
# with "stale info" when today's branch already exists. Fetch that ref and lease against its SHA.
set -euo pipefail

BRANCH="${1:?sync branch name}"
REMOTE="${SYNC_REMOTE:-origin}"
TRACKING="refs/remotes/${REMOTE}/${BRANCH}"

LEASE=""
if git fetch "$REMOTE" "refs/heads/${BRANCH}:${TRACKING}" >/dev/null 2>&1; then
  LEASE=$(git rev-parse "$TRACKING")
fi

if [ -n "${SYNC_PUSH_DRY_RUN:-}" ]; then
  if [ -n "$LEASE" ]; then
    printf 'lease %s %s\n' "$BRANCH" "$LEASE"
  else
    printf 'create %s\n' "$BRANCH"
  fi
  exit 0
fi

if [ -n "$LEASE" ]; then
  git push --force-with-lease="refs/heads/${BRANCH}:${LEASE}" -u "$REMOTE" "HEAD:refs/heads/${BRANCH}"
else
  git push -u "$REMOTE" "HEAD:refs/heads/${BRANCH}"
fi

if [ -n "${SYNC_SKIP_PR:-}" ]; then
  exit 0
fi

TITLE="${SYNC_PR_TITLE:-Workbook sync}"
BODY="${SYNC_PR_BODY:-Automatic read-only export of the Pipeline workbook. Not merged.}"
EXISTING=$(gh pr list --base main --head "$BRANCH" --state open --json number --jq '.[0].number // empty')
if [ -z "$EXISTING" ]; then
  gh pr create --base main --head "$BRANCH" --title "$TITLE" --body "$BODY"
  EXISTING=$(gh pr list --base main --head "$BRANCH" --state open --json number --jq '.[0].number // empty')
else
  gh pr edit "$EXISTING" --title "$TITLE" --body "$BODY"
fi
if [ -z "$EXISTING" ]; then
  echo "The sync pull request was not created." >&2
  exit 1
fi
printf '%s\n' "$EXISTING" > /tmp/sync-pr-number
