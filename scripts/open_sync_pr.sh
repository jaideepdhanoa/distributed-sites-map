#!/usr/bin/env bash
# Publish the current commit and open or update its pull request.
#
# A branch that already exists is updated with --force-with-lease only when
# every commit on it since main was authored by github-actions[bot]. That
# replaces the day's bot snapshot. If any commit was authored by someone else
# (a person or another agent), this script does not force-push. It leaves that
# branch alone and publishes this export on the next free name:
# workbook-sync-YYYY-MM-DD-2, then -3, and so on. The new pull request is this
# export on top of main. The earlier branch, and the commits on it, stay.
#
# actions/checkout only tracks main, so a bare --force-with-lease has no lease
# and is rejected with "stale info" when today's branch already exists. Fetch
# that ref and lease against its SHA.
set -euo pipefail

DESIRED="${1:?sync branch name}"
REMOTE="${SYNC_REMOTE:-origin}"
BOT_NAME="github-actions[bot]"
BOT_EMAIL="github-actions[bot]@users.noreply.github.com"
BRANCH_FILE="${SYNC_BRANCH_FILE:-/tmp/sync-branch}"
NOTE_FILE="${SYNC_BRANCH_NOTE_FILE:-/tmp/sync-branch-note}"

tracking_for() {
  printf 'refs/remotes/%s/%s' "$REMOTE" "$1"
}

fetch_branch() {
  local branch="$1"
  git fetch "$REMOTE" "refs/heads/${branch}:$(tracking_for "$branch")" >/dev/null 2>&1
}

is_bot() {
  local name="$1"
  local email="$2"
  if [ "$name" = "$BOT_NAME" ]; then
    return 0
  fi
  case "$email" in
    "$BOT_EMAIL"|*"github-actions[bot]@users.noreply.github.com") return 0 ;;
  esac
  return 1
}

# A missing branch is not protected. History that does not connect to main is
# protected, because a force-push there could drop commits we cannot see.
has_non_bot() {
  local tracking
  tracking="$(tracking_for "$1")"
  if ! git rev-parse --verify --quiet "$tracking" >/dev/null; then
    return 1
  fi
  if ! git merge-base --is-ancestor main "$tracking" >/dev/null 2>&1; then
    return 0
  fi
  local name email
  while IFS=$'\t' read -r name email; do
    [ -n "${name}${email}" ] || continue
    if ! is_bot "$name" "$email"; then
      return 0
    fi
  done < <(git log --format='%an%x09%ae' "main..${tracking}")
  return 1
}

choose_branch() {
  local candidate="$DESIRED"
  local n=2
  while fetch_branch "$candidate" && has_non_bot "$candidate"; do
    candidate="${DESIRED}-${n}"
    n=$((n + 1))
    if [ "$n" -gt 20 ]; then
      echo "No free sync branch name after ${DESIRED}-20." >&2
      exit 1
    fi
  done
  printf '%s\n' "$candidate"
}

BRANCH="$(choose_branch)"
printf '%s\n' "$BRANCH" > "$BRANCH_FILE"
: > "$NOTE_FILE"

LEASE=""
if fetch_branch "$BRANCH"; then
  LEASE="$(git rev-parse "$(tracking_for "$BRANCH")")"
fi

if [ "$BRANCH" != "$DESIRED" ]; then
  printf '%s\n' "Kept ${DESIRED} because it has commits that were not made by github-actions[bot]. This export is on ${BRANCH}. The earlier branch was not force-pushed." > "$NOTE_FILE"
fi

if [ -n "${SYNC_PUSH_DRY_RUN:-}" ]; then
  if [ "$BRANCH" != "$DESIRED" ]; then
    printf 'fresh %s\n' "$BRANCH"
  elif [ -n "$LEASE" ]; then
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
if [ -s "$NOTE_FILE" ]; then
  BODY="${BODY}

$(cat "$NOTE_FILE")"
fi
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
