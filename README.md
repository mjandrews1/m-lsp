# m-lsp

Language servers for **M** (MUMPS / Mlang / RSM dialect) and **C3**,
over one shared LSP host. Rebuild of the deleted `~/_lsp-servers`
(`mjandrews1/rsm#27`).

**Design first:** `docs/DESIGN.md`.

## Layout

```
packages/core/      LanguagePlugin interface
packages/m-core/    M tokenizer, diagnostics, hover, goto
packages/c3-core/   C3 tokenizer, diagnostics, hover, goto
packages/server/    shared LSP host (stdio)
packages/m-lint/    `m-lint` CLI (rsm#28) — reuses m-core rules
packages/c3-lint/   `c3-lint` CLI (rsm#29) — reuses c3-core rules
grammars/           m.tmLanguage.json, c3.tmLanguage.json
tests/              unit + FileMan + c3m/c3fst fixtures
editors/            VS Code thin clients (vscode-m, vscode-c3)
```

## v1 acceptance (rsm#27)

| capability | M | C3 |
|---|---|---|
| Diagnostics | unbalanced `IF`/`ELSE` · `QUIT` arg context · unknown intrinsic · empty post-conditional · invalid `^routine` | missing `import` · `class` not a keyword · param naming · `char*` vs `ZString` · array-by-value warning |
| Hover | intrinsic signatures, `$DATA` 0/1/10/11, `$ORDER` empty subscript, `$T`/`$TEST`/`$TEXT`, ELSE/`$TEST` ISO 7.2.4 | `ZString` / `extern fn` rule |
| Goto | `label^routine`, `$$fn` | across `import` |
| Grammar | `grammars/m.tmLanguage.json` | `grammars/c3.tmLanguage.json` |
| Fixtures | `~/_fileman` (VA FileMan 22.2) | `_c3m` / `_c3fst` / `c3mumps` source |

## Build & test

```sh
bun install
bun test
bun run server    # LSP on stdio
```

## Non-goals (v1)

DAP debugger · refactors/code actions · VS Code marketplace packaging ·
C3 runtime coupling.


## m-lint (rsm#28)

```sh
bun run m-lint -- --dir ~/fileman
bun run m-lint -- --format json file.m
bun run m-lint -- --list-codes
```

Rules live in `packages/m-core` (shared with the LSP). Config:
`.mlintrc.json`. Exit codes: `0` clean · `1` diagnostics · `2` usage.


## c3-lint (rsm#29)

```sh
bun run c3-lint -- --dir ~/c3mumps/src
bun run c3-lint -- --format json file.c3
bun run c3-lint -- --list-codes
```

Rules live in `packages/c3-core` (shared with the LSP). Config:
`.c3lintrc.json`. Exit codes: `0` clean · `1` diagnostics · `2` usage.


## VS Code clients (rsm#27)

Thin clients over the one shared host — not four parallel servers.

```sh
# development: open VS Code with the extension loaded
code --extensionDevelopmentPath=editors/vscode-m
code --extensionDevelopmentPath=editors/vscode-c3
```

Both spawn `packages/server/src/main.ts` with `bun` over stdio.
Override with `mLsp.serverPath` / `c3Lsp.serverPath`.

## Workspace-wide goto

`definitions(offset, WorkspaceIndex)` resolves across files:

| M | `label^routine` → routine file + label · cursor on routine name → file · `$$fn` / `$$label^routine` |
| C3 | `fn` / `type` across files · cursor on `mod::` module prefix → module file |

The host indexes workspace files on `initialize` and keeps the index
live on `didOpen`/`didClose`.
