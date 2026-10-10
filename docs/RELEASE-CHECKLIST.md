# Release checklist

> Shared gate for JvMumps · mJVM · m-lsp · m-semantics · ydb-mesh · ydb-infra.
> Run from a clean tree with `gh` authenticated as an admin of `mjandrews1`.

## 1. CI required-check enforcement (do this first)

```bash
/Users/mark/m-semantics/tools/ci-block-probe.sh
```

- Opens a throwaway PR per repo that **fails** the required status check.
- Confirms `mergeStateStatus=BLOCKED` and `gh pr merge` is rejected.
- Closes probe PRs and deletes probe branches.
- **Must print `ALL PASS` and exit 0** before tagging or shipping.

| Repo | Required check |
|------|----------------|
| jvmumps | `smoke` |
| m-lsp | `test` |
| m-semantics | `dafny` |
| ydb-mesh | `test` |
| ydb-infra | `lint-scripts` |

Preview without touching remotes: `DRY_RUN=1 …/ci-block-probe.sh`

## 2. Green tip on every `main`

- [ ] jvmumps `smoke` green (includes native mJVM **MATCH=131 / ERR=0** gate)
- [ ] m-lsp `test` green
- [ ] m-semantics `dafny` green (MSemantics + MPattern)
- [ ] ydb-mesh `test` green (yottadb cases self-skip off-box)
- [ ] ydb-infra `lint-scripts` green

## 3. Working tree hygiene

- [ ] No leftover `ci-block-probe-*` branches on any remote
- [ ] No open probe PRs
- [ ] `git status` clean on the repos you are shipping

## 4. Ship

- [ ] Tag / publish only after §1 exits 0 and §2 is green
- [ ] Note the probe run date and SHAs in the release notes

---

Last verified end-to-end: **2026-10-10** — `ci-block-probe.sh` `ALL PASS` on all five repos.
