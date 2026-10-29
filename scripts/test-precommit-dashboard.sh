#!/usr/bin/env bash
# Exercise dashboard engine selection through the real pre-commit hook.
set -euo pipefail
hook="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.githooks/pre-commit}"
hook="$(cd "$(dirname "$hook")" && pwd)/$(basename "$hook")"
root="$(mktemp -d "${TEST_TMPDIR:-${TMPDIR:-/tmp}}/precommit-dashboard.XXXXXX")"
trap 'rm -rf "$root"' EXIT
git_bin="$(command -v git)"
bash_bin="$(command -v bash)"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

check() {
  local name=$1 os=$2 bazel=$3 mode=$4 make_exit=$5 want_code=$6 want_make=$7
  local case_dir="$root/$name" status=0
  mkdir -p "$case_dir/repo/.githooks/lib" "$case_dir/bin" "$case_dir/home"
  cp -f "$hook" "$case_dir/repo/.githooks/pre-commit"
  printf '#!/bin/sh\nexit 0\n' > "$case_dir/repo/.githooks/lib/beads-chain.sh"
  chmod +x "$case_dir/repo/.githooks/lib/beads-chain.sh"
  ln -s "$git_bin" "$case_dir/bin/git"
  ln -s "$bash_bin" "$case_dir/bin/bash"
  printf '#!/bin/sh\nexit 0\n' > "$case_dir/bin/npm"
  printf '#!/bin/sh\nprintf "%%s\\n" "$TEST_OS"\n' > "$case_dir/bin/uname"
  cat > "$case_dir/bin/make" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$MAKE_RECORD"
exit "$MAKE_EXIT"
STUB
  if [[ "$bazel" == yes ]]; then
    printf '#!/bin/sh\nexit 0\n' > "$case_dir/bin/bazel"
    chmod +x "$case_dir/bin/bazel"
  fi
  chmod +x "$case_dir/bin/npm" "$case_dir/bin/uname" "$case_dir/bin/make"
  "$git_bin" -C "$case_dir/repo" init -q -b main
  mkdir -p "$case_dir/repo/internal/api/dashboardspa/web/frontend/src"
  mkdir -p "$case_dir/repo/internal/api/dashboardspa/dist"
  printf 'export {};\n' > "$case_dir/repo/internal/api/dashboardspa/web/frontend/src/fixture.tsx"
  printf 'bundle\n' > "$case_dir/repo/internal/api/dashboardspa/dist/index.html"
  "$git_bin" -C "$case_dir/repo" add .
  (
    cd "$case_dir/repo"
    env -i PATH="$case_dir/bin:/usr/bin:/bin" HOME="$case_dir/home" \
      GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
      TEST_OS="$os" MAKE_RECORD="$case_dir/make" MAKE_EXIT="$make_exit" \
      GC_PRECOMMIT_DASHBOARD="$mode" bash .githooks/pre-commit
  ) > "$case_dir/output" 2>&1 || status=$?
  local actual=""
  if [[ -f "$case_dir/make" ]]; then actual="$(cat "$case_dir/make")"; fi
  if [[ "$status" != "$want_code" || "$actual" != "$want_make" ]]; then
    printf '%s: exit %s (want %s), make %s (want %s)\n' "$name" "$status" "$want_code" "$actual" "$want_make" >&2
    cat "$case_dir/output" >&2
    exit 1
  fi
  if [[ "$want_make" == 'dashboard-check-npm dashboard-smoke' ]]; then
    grep -q 'CI still runs the full Bazel dashboard gate' "$case_dir/output"
  fi
}

check missing-bazel Linux no auto 0 0 'dashboard-check-npm dashboard-smoke'
check macos Darwin yes auto 0 0 'dashboard-check-npm dashboard-smoke'
check linux Linux yes auto 0 0 'dashboard-check dashboard-smoke'
check explicit-bazel Darwin yes bazel 0 0 'dashboard-check dashboard-smoke'
check explicit-npm Linux yes npm 0 0 'dashboard-check-npm dashboard-smoke'
check npm-failure Darwin no auto 7 7 'dashboard-check-npm dashboard-smoke'
check bazel-failure Linux yes bazel 7 7 'dashboard-check dashboard-smoke'
check invalid-mode Linux yes skip 0 2 ''
echo 'Pre-commit dashboard fixtures passed.'
