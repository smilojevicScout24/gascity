#!/usr/bin/env bash
# Git integration fixtures for preserving fork source and rebuilding dist.
set -euo pipefail
script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync-upstream.sh"
root="$(mktemp -d "${TEST_TMPDIR:-${TMPDIR:-/tmp}}/sync-upstream.XXXXXX")"
trap 'rm -rf "$root"' EXIT
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
export GIT_AUTHOR_NAME=SyncTest GIT_AUTHOR_EMAIL=sync@example.invalid
export GIT_COMMITTER_NAME=SyncTest GIT_COMMITTER_EMAIL=sync@example.invalid
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
fixture() {
  case_dir="$root/$1"
  mkdir -p "$case_dir/upstream"
  git -C "$case_dir/upstream" init -q -b main
  (
    cd "$case_dir/upstream"
    mkdir -p internal/api/dashboardspa/dist/assets
    printf 'base\n' > source.txt
    printf 'extension\n' > fork.txt
    i=0; while (( i < 40 )); do printf 'generated base line %s\n' "$i"; i=$((i+1)); done > internal/api/dashboardspa/dist/assets/base.js
    printf 'dashboard-build-npm:\n\t@test ! -f fail-build\n\t@mkdir -p internal/api/dashboardspa/dist/assets\n\t@cat source.txt fork.txt > internal/api/dashboardspa/dist/assets/rebuilt.js\n' > Makefile
    git add .; git commit -qm base
  )
  git clone -q "$case_dir/upstream" "$case_dir/fork"
  git -C "$case_dir/fork" remote add upstream "$case_dir/upstream"
  (
    cd "$case_dir/fork"
    git mv internal/api/dashboardspa/dist/assets/base.js internal/api/dashboardspa/dist/assets/fork.js
    printf 'fork bundle\n' >> internal/api/dashboardspa/dist/assets/fork.js
    printf 'fork feature\n' > fork.txt
    if [[ "$1" == source-conflict ]]; then printf 'fork source\n' > source.txt; fi
    git add .; git commit -qm extension
  )
  (
    cd "$case_dir/upstream"
    git mv internal/api/dashboardspa/dist/assets/base.js internal/api/dashboardspa/dist/assets/upstream.js
    printf 'upstream bundle\n' >> internal/api/dashboardspa/dist/assets/upstream.js
    printf 'new upstream source\n' > source.txt
    printf 'intentional patch context whitespace \n' > upstream-fixture.patch
    git add .; git commit -qm update
  )
}
sync() { (cd "$case_dir/fork"; SYNC_UPSTREAM_MODE="${1:-sync}" bash "$script"); }
fixture generated
sync > "$root/generated.log" 2>&1 || { cat "$root/generated.log"; exit 1; }
git -C "$case_dir/fork" merge-base --is-ancestor upstream/main HEAD
test "$(cat "$case_dir/fork/internal/api/dashboardspa/dist/assets/rebuilt.js")" = $'new upstream source\nfork feature'
test -z "$(git -C "$case_dir/fork" status --porcelain)"
before="$(git -C "$case_dir/fork" rev-parse HEAD)"
touch "$case_dir/fork/fail-build"
sync > "$root/unchanged.log" 2>&1
test "$before" = "$(git -C "$case_dir/fork" rev-parse HEAD)"
fixture phases
sync prepare > "$root/prepare.log" 2>&1
test -f "$case_dir/fork/.git/MERGE_HEAD"
sync finish > "$root/finish.log" 2>&1
test ! -f "$case_dir/fork/.git/MERGE_HEAD"
fixture source-conflict
before="$(git -C "$case_dir/fork" rev-parse HEAD)"
if sync > "$root/conflict.log" 2>&1; then echo 'Source conflict was silently resolved' >&2; exit 1; fi
test "$before" = "$(git -C "$case_dir/fork" rev-parse HEAD)"
test -f "$case_dir/fork/.git/MERGE_HEAD"
git -C "$case_dir/fork" diff --name-only --diff-filter=U | grep -qx source.txt
fixture build-failure
touch "$case_dir/fork/fail-build"
before="$(git -C "$case_dir/fork" rev-parse HEAD)"
if sync > "$root/build-failure.log" 2>&1; then echo 'Failed build was committed' >&2; exit 1; fi
test "$before" = "$(git -C "$case_dir/fork" rev-parse HEAD)"
test -f "$case_dir/fork/.git/MERGE_HEAD"
rm "$case_dir/fork/fail-build"
sync finish > "$root/resume.log" 2>&1
fixture dirty
printf 'uncommitted\n' >> "$case_dir/fork/fork.txt"
if sync > "$root/dirty.log" 2>&1; then echo 'Dirty worktree was accepted' >&2; exit 1; fi
test ! -f "$case_dir/fork/.git/MERGE_HEAD"
echo 'Sync fixtures passed: generated conflicts, unchanged branch, staged phases, real source conflicts, failed build recovery, dirty worktree.'
