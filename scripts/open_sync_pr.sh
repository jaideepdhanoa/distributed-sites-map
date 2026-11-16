#!/usr/bin/env bash
# Publish the current commit and open or update its pull request.
#
# An open workbook-sync pull request whose commits since main are all by
# github-actions[bot] is updated in place, including when its branch name is
# an earlier day. That keeps a 15-minute schedule from opening a new pull
# request every run. Set SYNC_DISCOVER_PR=1 to look the branch up with gh.
# Tests can pass SYNC_REUSE_BRANCH instead.
#
# SYNC_UPDATE_ONLY=1 updates that pull request and does not open a new one.
# The data-check and universe-row failures use it. A run whose publish did
# not happen leaves it unset, so the first export still opens a pull request.
#
# A branch that already exists is updated with --force-with-lease only when
# every commit on it since main was authored by github-actions[bot]. If any
# commit was authored by someone else, this script does not force-push. It
# leaves that branch alone. Unless SYNC_UPDATE_ONLY is set, it then publishes
# this export on the next free name: workbook-sync-YYYY-MM-DD-2, then -3, and
# so on. The new pull request is this export on top of main.
#
# actions/checkout only tracks main, so a bare --force-with-lease has no lease
# and is rejected with "stale info" when the branch already exists. Fetch
# that ref and lease against its SHA.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "preview" ] || [ "${VERCEL_ENV:-}" = "development" ]; then
  echo "Refusing to open a pull request from a Vercel preview."
  exit 1
fi

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

is_sync_branch() {
  [[ "$1" =~ ^workbook-sync-[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$ ]]
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

# One branch name per line, newest open pull request first.
list_reuse_candidates() {
  if [ -n "${SYNC_REUSE_BRANCH:-}" ]; then
    printf '%s\n' "$SYNC_REUSE_BRANCH"
    return 0
  fi
  if [ -z "${SYNC_DISCOVER_PR:-}" ]; then
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh is not available, so this run cannot look up an open sync pull request." >&2
    return 0
  fi
  gh pr list --base main --state open --limit 50 \
    --json number,headRefName,updatedAt \
    --jq '[.[] | select(.headRefName | test("^workbook-sync-[0-9]"))] | sort_by(.updatedAt) | reverse | .[].headRefName'
}

: > "$NOTE_FILE"
if ! candidates="$(list_reuse_candidates)"; then
  echo "Could not list open sync pull requests." >&2
  exit 1
fi
CHOSEN=""
while IFS= read -r candidate; do
  [ -n "$candidate" ] || continue
  is_sync_branch "$candidate" || continue
  if ! fetch_branch "$candidate"; then
    continue
  fi
  if has_non_bot "$candidate"; then
    printf '%s\n' "Kept ${candidate} because it has commits that were not made by github-actions[bot]." >> "$NOTE_FILE"
    continue
  fi
  CHOSEN="$candidate"
  break
done <<< "$candidates"

if [ -n "$CHOSEN" ]; then
  BRANCH="$CHOSEN"
elif [ -n "${SYNC_UPDATE_ONLY:-}" ]; then
  echo "No open bot-only sync pull request to update." >&2
  if [ -n "${SYNC_PUSH_DRY_RUN:-}" ]; then
    printf 'skip\n'
  fi
  exit 0
else
  BRANCH="$(choose_branch)"
  if [ "$BRANCH" != "$DESIRED" ] && ! grep -F -q "$DESIRED" "$NOTE_FILE"; then
    printf '%s\n' "Kept ${DESIRED} because it has commits that were not made by github-actions[bot]. This export is on ${BRANCH}. The earlier branch was not force-pushed." >> "$NOTE_FILE"
  fi
fi

printf '%s\n' "$BRANCH" > "$BRANCH_FILE"

LEASE=""
if fetch_branch "$BRANCH"; then
  LEASE="$(git rev-parse "$(tracking_for "$BRANCH")")"
fi

SAME_TREE=0
if [ -n "$LEASE" ] && [ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse "${LEASE}^{tree}")" ]; then
  SAME_TREE=1
fi

if [ -n "${SYNC_PUSH_DRY_RUN:-}" ]; then
  if [ "$SAME_TREE" -eq 1 ]; then
    printf 'unchanged %s\n' "$BRANCH"
  elif [ "$BRANCH" != "$DESIRED" ] && [ -z "$CHOSEN" ]; then
    printf 'fresh %s\n' "$BRANCH"
  elif [ -n "$LEASE" ]; then
    printf 'lease %s %s\n' "$BRANCH" "$LEASE"
  else
    printf 'create %s\n' "$BRANCH"
  fi
  exit 0
fi

if [ "$SAME_TREE" -eq 1 ]; then
  echo "The open sync branch already has this data."
elif [ -n "$LEASE" ]; then
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
  if [ -n "${SYNC_UPDATE_ONLY:-}" ]; then
    echo "No open pull request for ${BRANCH}." >&2
    exit 0
  fi
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
