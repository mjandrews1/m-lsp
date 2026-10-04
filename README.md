# m-lsp

Language servers for **M** (MUMPS / Mlang / RSM dialect) and **C3**,
over one shared LSP host. Rebuild of the deleted `~/_lsp-servers`
(`mjandrews1/rsm#27`).

**Design first:** `docs/DESIGN.md` — read it before changing anything.

- One `LanguagePlugin` interface; language cores do tokenize/parse/symbol.
- The host is language-agnostic (diagnostics, goto, hover).
- DAP is out of scope for v1.

## Build

```sh
bun install
bun run test
```
