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
grammars/           m.tmLanguage.json, c3.tmLanguage.json
tests/              unit + FileMan + c3m/c3fst fixtures
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
