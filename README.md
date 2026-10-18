# m-lsp

Language server for **M** (MUMPS / Mlang / RSM dialect).
Rebuild of the deleted `~/_lsp-servers` (`mjandrews1/rsm#27`).

**Design first:** `docs/DESIGN.md`.

## Layout

```
packages/core/      LanguagePlugin interface
packages/m-core/    M tokenizer, diagnostics, hover, goto
packages/server/    LSP host (stdio)
packages/m-lint/    `m-lint` CLI (rsm#28) — reuses m-core rules
grammars/           m.tmLanguage.json
tests/              unit + FileMan + VistA fixtures
editors/            VS Code thin client (vscode-m)
```

## v1 acceptance

| capability | M |
|---|---|
| Diagnostics | unbalanced `IF`/`ELSE` · `QUIT` arg context · unknown intrinsic · empty post-conditional · invalid `^routine` |
| Hover | intrinsic signatures, `$DATA` 0/1/10/11, `$ORDER` empty subscript, `$T`/`$TEST`/`$TEXT`, ELSE/`$TEST` ISO 7.2.4 |
| Goto | `label^routine`, `$$fn` |
| Grammar | `grammars/m.tmLanguage.json` |
| Fixtures | `~/_fileman` (VA FileMan 22.2) + VistA FOIA |

## Build & test

```sh
bun install
bun test
bun run server    # LSP on stdio
```

## Non-goals (v1)

DAP debugger · refactors/code actions · VS Code marketplace packaging.

## m-lint (rsm#28)

```sh
bun run m-lint -- --dir ~/fileman
bun run m-lint -- --format json file.m
bun run m-lint -- --list-codes
```

Rules live in `packages/m-core` (shared with the LSP). Config:
`.mlintrc.json`. Exit codes: `0` clean · `1` diagnostics · `2` usage.

## VS Code client

Thin client over the shared host.

```sh
# development: open VS Code with the extension loaded
code --extensionDevelopmentPath=editors/vscode-m
```

Spawns `packages/server/src/main.ts` with `bun` over stdio.
Override with `mLsp.serverPath`.

## Workspace-wide goto

`definitions(offset, WorkspaceIndex)` resolves across files:

| M | `label^routine` → routine file + label · cursor on routine name → file · `$$fn` / `$$label^routine` |

The host indexes workspace files on `initialize` and keeps the index
live on `didOpen`/`didClose`.
