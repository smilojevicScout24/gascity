#!/usr/bin/env bash
# Merge upstream source and regenerate the fork's embedded dashboard. No push.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
remote="${UPSTREAM_REMOTE:-upstream}"
branch="${UPSTREAM_BRANCH:-main}"
mode="${SYNC_UPSTREAM_MODE:-sync}"
dist=internal/api/dashboardspa/dist
case "$mode" in sync|prepare|finish) ;; *) echo 'SYNC_UPSTREAM_MODE must be sync, prepare, or finish.' >&2; exit 1 ;; esac
git check-ref-format "refs/heads/$branch" >/dev/null
if ! git symbolic-ref --quiet --short HEAD >/dev/null; then
  echo 'Check out the fork branch to update before running sync-upstream.' >&2
  exit 1
fi
reject_source_conflicts() {
  local path failed=false
  while IFS= read -r -d '' path; do
    case "$path" in
      "$dist"/*) ;;
      *) printf 'Source conflict requires review: %s\n' "$path" >&2; failed=true ;;
    esac
  done < <(git diff --name-only --diff-filter=U -z)
  if [[ "$failed" == true ]]; then
    echo 'Merge left open. Resolve source conflicts, or use git merge --abort. No push was made.' >&2
    return 1
  fi
}
if [[ "$mode" == finish ]]; then
  if [[ ! -f "$(git rev-parse --git-path MERGE_HEAD)" ]]; then
    echo 'No prepared upstream merge to finish.' >&2
    exit 1
  fi
else
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
  git fetch --quiet --no-tags "$remote" "refs/heads/$branch:refs/remotes/$remote/$branch"
  ref="refs/remotes/$remote/$branch"
  if git merge-base --is-ancestor "$ref" HEAD; then
    echo 'Fork already includes the selected upstream branch; no build or commit needed.'
    exit 0
  fi
  log="$(mktemp)"
  trap 'rm -f "$log"' EXIT
  # Do not commit generated files from either side: they must be rebuilt from
  # the combined source. Leave genuine source conflicts for human review.
  if ! git merge --quiet --no-commit --no-ff "$ref" >"$log" 2>&1; then
    if [[ ! -f "$(git rev-parse --git-path MERGE_HEAD)" ]]; then
      cat "$log" >&2
      exit 1
    fi
  fi
  reject_source_conflicts
  echo 'Upstream source merged; generated dashboard files will be rebuilt.'
  if [[ "$mode" == prepare ]]; then exit 0; fi
fi
reject_source_conflicts
# Only this generated directory is removed, including stale hashed bundles and
# their conflict stages. Fork source and all other merge results are preserved.
git rm -r -q -f --ignore-unmatch -- "$dist"
make dashboard-build-npm
git add -A -- "$dist"
git diff --cached --check
git commit --no-edit
echo 'Upstream merged and embedded dashboard rebuilt. No push was made.'
