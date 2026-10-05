# m-lsp — design note (before implementation)

**Ticket:** `mjandrews1/rsm#27` (Track R4)
**Date:** 2026-10-04 · **Status:** design locked; implementation follows this file
**Repo:** `~/m-lsp` (git from day one — the deleted `~/_lsp-servers` never was)

This note is required by the ticket *before* implementation. It names
the language surface, the v1 subset, and the architecture that avoids
the four-parallel-implementations mistake of the deleted monorepo.

---

## 1. What this is

Two language servers over one shared LSP host:

| language | why |
|---|---|
| **M** (MUMPS / Mlang / RSM dialect) | the language the project actually writes — FileMan corpus, RSM, the peer ports |
| **C3** | the language of C3Mumps and c3m/c3fst; the bug history there is the test set |

**Non-goals for v1:** DAP debugger, refactors/code actions beyond
diagnostics, C3 *runtime* coupling, VS Code marketplace packaging.

**Explicitly not recovered:** the deleted `~/_lsp-servers` source. This
is a rebuild from the design record in `rsm#27`, not a recovery.

---

## 2. Architecture — factor the language, not the implementation

The deleted monorepo had `c3-server` / `mumps-server` / `c3-debugger` /
`mumps-debugger` as near-identical copies. The rebuild inverts that:

```
              ┌─────────────────────────────┐
              │        language cores       │
              │   (m-core)      (c3-core)   │
              │  tokenize/parse/symbol      │
              └─────────────┬───────────────┘
                            │  LanguagePlugin interface
              ┌─────────────▼───────────────┐
              │      shared LSP host        │
              │  connection, documents,     │
              │  diagnostics, goto, hover   │
              └─────────────┬───────────────┘
                            │  stdio LSP
              ┌─────────────┴───────────────┐
              │                             │
        m editor ext                 c3 editor ext
        (thin client)                (thin client)
```

### `LanguagePlugin` (the seam)

Each core exports one object; the host is language-agnostic:

```ts
interface LanguagePlugin {
  id: "m" | "c3";
  // file extensions this plugin claims
  extensions: string[];
  // parse + analyse a document; pure, no LSP types
  analyse(uri: string, text: string): Analysis;
}

interface Analysis {
  tokens: Token[];
  symbols: Symbol[];           // labels, globals, fns, types
  references: Reference[];     // every identifier use, with its kind
  diagnostics: Diagnostic[];   // ranges + messages + severity
  // hover payload for a position, or null
  hover(pos: number): HoverInfo | null;
  // definitions for a position (0..n)
  definitions(pos: number): Location[];
}
```

The host owns: `textDocument/*` plumbing, position↔offset conversion,
publishing diagnostics, capability negotiation. Adding a language is
*only* a new core + an extension claim — no host changes.

---

## 3. Language surface

### 3.1 M

| area | examples | v1 |
|---|---|---|
| **routines & labels** | `label^routine`, `$$extrinsic(args)`, `$$label^routine(args)` | ✅ goto + diagnostics |
| **globals vs locals** | `^GLOBAL(sub,sub)`, sparse multi-dim | ✅ symbol kinds |
| **commands** | `SET WRITE IF ELSE FOR DO GOTO QUIT KILL NEW HALT HANG READ LOCK VIEW USE OPEN CLOSE MERGE` | ✅ known-command check |
| **post-conditionals** | `cmd:expr` | ✅ parse; diagnostic on empty expr |
| **special variables** | `$H $HOROLOG $T $P $C $R $J $IO $D $O $Q $NA $G $QL $QS $L $E $F $A $Z*` | ✅ hover |
| **intrinsics** | `$DATA $ORDER $QUERY $NAME $GET $PIECE $EXTRACT $FIND $LENGTH $ASCII $CHAR $RANDOM $HOROLOG $JOB $TEXT $JUSTIFY $REVERSE $TRANSLATE $INCREMENT $FNUMBER $STACK` | ✅ hover + unknown-intrinsic diagnostic |
| **syntax quirks** | `ELSE` binds last `IF`; `QUIT` arg vs argless; `$T` ambiguity; `FOR` specs; post-cond + argless `DO`/`GOTO` | ✅ as diagnostics / hovers |
| **DO/FOR block context** | dotted-line depth · argless `DO` opens block · `FOR` body is same-line · `QUIT expr` legal in extrinsic (`label(args)`) or DO/FOR | ✅ `packages/m-core/src/block.ts` (m-lsp#1) |
| **FOR arg-list** | `var=from:inc:to[:cmd]` · `var=a,b,c` · `0:0` · hover · `m/for-args` | ✅ `packages/m-core/src/forargs.ts` (m-lsp#2) |
| **Indirection `@`** | `@expr` hover · `m/empty-indirect` when operand missing | ✅ `forargs.ts` (m-lsp#2) |
| **entry points** | `D`/`DO`, `^routine`, `$$fn()` | ✅ |

**v1 diagnostics (M)** — at least:

1. **Unbalanced `IF`/`ELSE`** — `ELSE` with no preceding `IF` on the line/line-stack
2. **`QUIT` in a non-block context** — `QUIT` with argument at top level / outside `DO`/`FOR`
3. **Unknown intrinsic** — `$FOO` not in the known table
4. **Invalid `^routine` reference** — malformed routine name
5. **Unknown command** — not in the command table
6. **Post-conditional without expression** — `W:` then EOL

**v1 hover (M)** — intrinsic signatures + special-variable semantics,
*including the semantics that actually bit us*:

- `$DATA` returns **0 / 1 / 10 / 11** (no value / value / descendants / both)
- `$ORDER`'s empty subscript is the **before-first / after-last marker at any position** (rsm#14)
- `$TEST` vs `$T` vs `$TEXT` (the `$T` ambiguity)
- `ELSE` runs iff `$TEST` is 0 (ISO 7.2.4, rsm#12)
- comparison is numeric iff **both** sides are numeric strings (ISO 11756 §8.3, rsm#11)

**v1 goto (M)** — `label^routine` and `$$fn` / `$$label^routine` across
routine files in the workspace.

**Syntax highlighting:** `m.tmLanguage.json` — regenerate (the deleted
`mumps.tmLanguage.json` is gone). Scope: comments (`;`), strings (`"`),
commands (keyword lists), `$` intrinsics/specials, labels, `^globals`,
numbers, operators.

### 3.2 C3

| area | notes | v1 |
|---|---|---|
| **modules & imports** | `import <module>;` — cross-module type *requires* it | ✅ diagnostic |
| **declarations** | `fn`, `struct` (**`class` is NOT a keyword**), `enum`, `union`, `typedef`, `distinct X = type;` | ✅ |
| **naming rules** | types start uppercase; params may **not** be all-caps nor start capital | ✅ diagnostic |
| **types** | `int`, `usz`, `char`, `float`, `bool`, arrays, `char[]`, pointers, `ZString` | ✅ |
| **FFI** | `extern fn`; C strings must be `ZString`, not `char*` | ✅ diagnostic + hover |
| **control flow** | `if else for while do switch return break continue` | parse |
| **known traps** | arrays passed **BY VALUE**; no `fault`/`try`; no `sizeof`; no `static` locals | ✅ warning on array params |

**v1 diagnostics (C3)** — at least:

1. **Missing `import` for a cross-module type**
2. **`class` used instead of `struct`**
3. **Parameter name all-caps or starting capital**
4. **`char*` in `extern fn` where `ZString` is required**
5. **Array parameter** (warning, not error — silently copied)

**v1 hover (C3)** — `extern fn` shows the C signature *and* the
`ZString` requirement.

**v1 goto (C3)** — across `import <module>;` boundaries.

**Test corpus:** c3m / c3fst **source** (fixture only; no runtime
dependency). Their bug history is the test set.

---

## 4. Tooling

| choice | why |
|---|---|
| **TypeScript** | LSP ecosystem; `vscode-languageserver` is the reference impl |
| **Bun 1.4** (this Mac) | no Node on the box; Bun runs TS natively and installs npm deps |
| **stdlib LSP over stdio** | editor-agnostic; VS Code extension is a thin client |
| **vitest / bun test** | unit tests per language core |

Workspaces:

```
m-lsp/
├── docs/DESIGN.md          ← this file
├── packages/
│   ├── core/               LanguagePlugin interface + shared types
│   ├── m-core/             M tokenizer, parser, symbols, diagnostics
│   ├── c3-core/            C3 tokenizer, parser, symbols, diagnostics
│   └── server/             shared LSP host (stdio)
├── editors/
│   ├── vscode-m/           thin VS Code client (M)
│   └── vscode-c3/          thin VS Code client (C3)
├── grammars/
│   ├── m.tmLanguage.json
│   └── c3.tmLanguage.json
└── tests/
    ├── m/                  FileMan fixtures + unit tests
    └── c3/                 c3m/c3fst source fixtures + unit tests
```

---

## 5. Test plan

| level | what |
|---|---|
| **unit** | tokenizer / parser / diagnostic rules, per core |
| **fixture** | `~/_fileman` (VA FileMan 22.2, ~911 M) for M; `~/_c3m` + `~/_c3fst` source for C3 |
| **smoke** | launch server over stdio, `initialize` + `didOpen` + `publishDiagnostics` |
| **acceptance** | the v1 diagnostic + hover + goto bullets in §3 |

Fixture rule: **read-only**. `_fileman` is the conformance corpus
(MEMORY rule) — never write into it.

---

## 6. What we are deliberately not doing

- DAP (deleted `*-debug` projects) — language server first
- Reconstructing `validateLine` (known dead hook)
- Coupling to c3m/c3fst runtime (source as fixture only)
- Marketplace packaging / extension publish
- C3 `sizeof`/`fault` emulation

---

## 7. Sequencing

1. **This note** (done — acceptance criterion #1)
2. Scaffold repo + `LanguagePlugin` interface + LSP host
3. **M core** first (the original ask; FileMan corpus is ready)
4. **C3 core** second (same host, fixture = c3m/c3fst source)
5. Grammars
6. Fixture tests + smoke

M before C3 because the corpus and the semantic documentation
(`UPSTREAM-DIFF.md`, `MSemantics.dfy`, the port READMEs) are stronger
for M.
