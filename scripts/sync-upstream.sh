#!/usr/bin/env bash
# Merge the selected upstream branch into the current local branch. No push.
set -euo pipefail
remote="${UPSTREAM_REMOTE:-upstream}"
branch="${UPSTREAM_BRANCH:-main}"
git check-ref-format "refs/heads/$branch" >/dev/null
if ! git symbolic-ref --quiet --short HEAD >/dev/null; then
  echo 'Check out the fork branch to update before running sync-upstream.' >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'Commit or stash tracked changes before running sync-upstream.' >&2
  exit 1
fi
for operation in MERGE_HEAD CHERRY_PICK_HEAD rebase-merge rebase-apply; do
  if [[ -e "$(git rev-parse --git-path "$operation")" ]]; then
    echo "Finish or abort the current Git operation before syncing ($operation)." >&2
    exit 1
  fi
done
git remote get-url "$remote" >/dev/null
git fetch --no-tags "$remote" "refs/heads/$branch:refs/remotes/$remote/$branch"
git merge --no-edit "refs/remotes/$remote/$branch"
