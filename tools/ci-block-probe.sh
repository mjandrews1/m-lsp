#!/usr/bin/env bash
# ci-block-probe — prove each repo's required status check actually blocks merges.
#
# For every repo: push a branch that fails the required check, open a PR,
# wait for CI, attempt a merge (must be rejected), then clean up.
# Exit 0 only if every repo blocks. Intended as a release gate.
#
# Usage:
#   tools/ci-block-probe.sh
#   tools/ci-block-probe.sh jvmumps m-lsp
#   ORG=myuser tools/ci-block-probe.sh
#   DRY_RUN=1 tools/ci-block-probe.sh
#
# Requirements: gh (authenticated), git, network to GitHub.
set -euo pipefail

ORG="${ORG:-mjandrews1}"
WORKDIR="${WORKDIR:-$(mktemp -d /tmp/ci-block-probe.XXXXXX)}"
TIMEOUT_SECS="${TIMEOUT_SECS:-180}"
DRY_RUN="${DRY_RUN:-0}"

# repo|required-check|break-spec
# break-spec is a key handled by make_break()
DEFAULT_MATRIX=(
  "jvmumps|smoke|bad-java"
  "m-lsp|test|bad-bun-test"
  "m-semantics|dafny|bad-dafny"
  "ydb-mesh|test|bad-pytest-script"
  "ydb-infra|lint-scripts|bad-python"
)

log() { printf '%s\n' "$*" >&2; }
die() { log "FATAL: $*"; exit 2; }

require() {
  command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"
}

# Write a file that makes the named required check fail.
make_break() {
  local spec="$1" root="$2"
  case "$spec" in
    bad-java)
      mkdir -p "$root/src/test/java/jvmumps"
      cat > "$root/src/test/java/jvmumps/CiProbeBroken.java" <<'EOF'
package jvmumps;
public class CiProbeBroken {
  this is not valid java;;;
}
EOF
      echo "src/test/java/jvmumps/CiProbeBroken.java"
      ;;
    bad-bun-test)
      mkdir -p "$root/tests"
      cat > "$root/tests/ci-probe-fail.test.ts" <<'EOF'
import { test, expect } from "bun:test";
test("ci-probe must fail", () => {
  expect(1).toBe(2);
});
EOF
      echo "tests/ci-probe-fail.test.ts"
      ;;
    bad-dafny)
      # Must land in a file the workflow actually verifies (MSemantics.dfy / MPattern.dfy).
      printf '\n// ci-probe: unprovable postcondition\nlemma CiProbeBroken()\n  ensures 1 == 2\n{\n}\n' \
        >> "$root/MPattern.dfy"
      echo "MPattern.dfy"
      ;;
    bad-pytest-script)
      mkdir -p "$root/tests"
      cat > "$root/tests/test_ci_probe_fail.py" <<'EOF'
if __name__ == "__main__":
    raise SystemExit("probe: required check test must fail")
EOF
      echo "tests/test_ci_probe_fail.py"
      ;;
    bad-python)
      mkdir -p "$root/common"
      printf 'def broken(:\n' > "$root/common/ci_probe_broken.py"
      echo "common/ci_probe_broken.py"
      ;;
    *)
      die "unknown break spec: $spec"
      ;;
  esac
}

wait_for_check() {
  local check="$1" deadline=$((SECONDS + TIMEOUT_SECS))
  local concl=""
  while (( SECONDS < deadline )); do
    concl=$(gh pr checks 2>/dev/null | awk -v c="$check" '$1==c {print $2; exit}') || true
    case "$concl" in
      pass|fail|pending|skipped|cancelled|error|"") ;;
    esac
    if [ -n "$concl" ] && [ "$concl" != "pending" ]; then
      printf '%s' "$concl"
      return 0
    fi
    sleep 8
  done
  printf 'timeout'
  return 0
}

probe_repo() {
  local repo="$1" check="$2" spec="$3"
  local dir="$WORKDIR/$repo"
  local branch="ci-block-probe-$(date -u +%Y%m%d%H%M%S)"
  local url pr_num merge_out state

  log ""
  log "======== $ORG/$repo  required=$check  break=$spec ========"

  if [ "$DRY_RUN" = "1" ]; then
    log "DRY_RUN: would clone, break $spec, open PR, require merge block on $check"
    return 0
  fi

  rm -rf "$dir"
  git clone --quiet "https://github.com/$ORG/$repo.git" "$dir"
  cd "$dir"

  git config user.name "${GIT_AUTHOR_NAME:-ci-block-probe}"
  git config user.email "${GIT_AUTHOR_EMAIL:-ci-block-probe@localhost}"
  git checkout -q -B "$branch" origin/main

  local file
  file=$(make_break "$spec" "$dir")
  git add -A
  git commit -q -m "ci-block-probe: force $check to fail"
  git push -q -u origin "$branch"

  # gh pr create prints the PR URL on success (no --json on older gh).
  url=$(gh pr create --base main --head "$branch" \
    --title "ci-block-probe: $check must block merge" \
    --body "Automated release-gate probe. Required check $check must fail and block merge." \
    | tail -n1)
  case "$url" in
    https://github.com/*/pull/*) ;;
    *) die "gh pr create did not return a PR URL: $url" ;;
  esac
  pr_num=${url##*/}
  log "PR $url"

  local concl
  concl=$(wait_for_check "$check")
  log "check $check => $concl"
  if [ "$concl" != "fail" ] && [ "$concl" != "error" ] && [ "$concl" != "cancelled" ]; then
    log "UNEXPECTED: required check did not fail (got '$concl')"
    gh pr close "$pr_num" --comment "ci-block-probe: check did not fail ($concl); closing." --delete-branch || true
    git checkout -q main || true
    git push origin --delete "$branch" >/dev/null 2>&1 || true
    return 1
  fi

  set +e
  merge_out=$(gh pr merge "$pr_num" --merge --delete-branch=false 2>&1)
  local merge_rc=$?
  set -e
  log "merge attempt rc=$merge_rc"
  log "$merge_out"

  state=$(gh pr view "$pr_num" --json mergeStateStatus -q .mergeStateStatus)
  log "mergeStateStatus=$state"

  local ok=1
  if [ "$state" = "BLOCKED" ]; then
    log "PASS $repo: merge blocked while $check is red"
  elif echo "$merge_out" | grep -qi "prohibits the merge\|not mergeable\|blocked"; then
    log "PASS $repo: merge rejected by policy"
    ok=0
  else
    log "FAIL $repo: merge was not blocked (state=$state)"
    ok=1
    # Best-effort: undo if it merged.
    if [ "$state" = "CLEAN" ] || [ "$state" = "UNSTABLE" ] || [ "$state" = "BEHIND" ]; then
      log "WARNING: probe may have merged; inspect $url"
    fi
    gh pr close "$pr_num" --comment "ci-block-probe: merge was not blocked; closing." --delete-branch || true
    git checkout -q main || true
    git push origin --delete "$branch" >/dev/null 2>&1 || true
    return 1
  fi

  gh pr close "$pr_num" --comment "ci-block-probe: verified $check blocks merge. Closing." --delete-branch=false || true
  git checkout -q main || true
  git push origin --delete "$branch" >/dev/null 2>&1 || true
  return 0
}

main() {
  require gh
  require git

  local matrix=()
  if [ "$#" -gt 0 ]; then
    local want r
    for want in "$@"; do
      for r in "${DEFAULT_MATRIX[@]}"; do
        if [ "${r%%|*}" = "$want" ]; then
          matrix+=("$r")
        fi
      done
      found=0
      for r in "${DEFAULT_MATRIX[@]}"; do
        [ "${r%%|*}" = "$want" ] && found=1
      done
      [ "$found" -eq 1 ] || die "no matrix entry for '$want'"
    done
  else
    matrix=("${DEFAULT_MATRIX[@]}")
  fi

  log "ci-block-probe org=$ORG workdir=$WORKDIR dry_run=$DRY_RUN"
  gh auth status >&2 || true

  local failed=0 entry repo check spec
  for entry in "${matrix[@]}"; do
    IFS='|' read -r repo check spec <<<"$entry"
    if ! probe_repo "$repo" "$check" "$spec"; then
      failed=$((failed + 1))
    fi
  done

  log ""
  if [ "$failed" -eq 0 ]; then
    log "ALL PASS: every required check blocks merge."
    return 0
  fi
  log "FAILED: $failed repo(s) did not block. See log above."
  return 1
}

main "$@"
