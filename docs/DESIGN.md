# m-lsp — design note

**Ticket:** `mjandrews1/rsm#27` (Track R4)
**Date:** 2026-10-04 · **Status:** design locked; C3 removed 2026-10-17
**Repo:** `~/m-lsp`

---

## 1. What this is

Language server for **M** (MUMPS / Mlang / RSM dialect).

**Non-goals for v1:** DAP debugger, refactors/code actions beyond
diagnostics, VS Code marketplace packaging.

---

## 2. Architecture

```
              ┌─────────────────────────────┐
              │        language core        │
              │         (m-core)            │
              │  tokenize/parse/symbol      │
              └─────────────┬───────────────┘
                            │  LanguagePlugin interface
              ┌─────────────▼───────────────┐
              │         LSP host            │
              │  connection, documents,     │
              │  diagnostics, goto, hover   │
              └─────────────┬───────────────┘
                            │  stdio LSP
              ┌─────────────▼───────────────┐
              │       m editor ext          │
              │        (thin client)        │
              └─────────────────────────────┘
```

### `LanguagePlugin` (the seam)

```ts
interface LanguagePlugin {
  id: "m";
  extensions: string[];
  analyse(uri: string, text: string): Analysis;
}
```

---

## 3. M language surface

| area | examples | v1 |
|---|---|---|
| **routines & labels** | `label^routine`, `$$extrinsic(args)`, `$$label^routine(args)` | ✅ goto + diagnostics |
| **globals vs locals** | `^GLOBAL(sub,sub)`, sparse multi-dim | ✅ symbol kinds |
| **commands** | `SET WRITE IF ELSE FOR DO GOTO QUIT KILL NEW HALT HANG READ LOCK VIEW USE OPEN CLOSE MERGE` | ✅ known-command check |
| **post-conditionals** | `cmd:expr` | ✅ parse; diagnostic on empty expr |
| **special variables** | `$H $HOROLOG $T $P $C $R $J $IO $D $O $Q $NA $G $QL $QS $L $E $F $A $Z*` | ✅ hover |
| **intrinsics** | `$DATA $ORDER $QUERY $NAME $GET $PIECE $EXTRACT $FIND $LENGTH $ASCII $CHAR $RANDOM $HOROLOG $JOB $TEXT $JUSTIFY $REVERSE $TRANSLATE $INCREMENT $FNUMBER $STACK` | ✅ hover + unknown-intrinsic diagnostic |
| **syntax quirks** | `ELSE` binds last `IF`; `QUIT` arg vs argless; `$T` ambiguity; `FOR` specs; post-cond + argless `DO`/`GOTO` | ✅ as diagnostics / hovers |
| **DO/FOR block context** | dotted-line depth · argless `DO` opens block · `FOR` body is same-line · `QUIT expr` legal in extrinsic or DO/FOR | ✅ `block.ts` |
| **FOR arg-list** | `var=from:inc:to[:cmd]` · `var=a,b,c` · `0:0` | ✅ `forargs.ts` |
| **Indirection `@`** | `@expr` hover · `m/empty-indirect` | ✅ `forargs.ts` |
| **entry points** | `D`/`DO`, `^routine`, `$$fn()` | ✅ |

### Diagnostics

1. Unbalanced `IF`/`ELSE`
2. `QUIT` in non-block context
3. Unknown intrinsic
4. Invalid `^routine` reference
5. Unknown command
6. Post-conditional without expression

### Hover

- `$DATA` returns 0/1/10/11
- `$ORDER` empty subscript semantics
- `$TEST` vs `$T` vs `$TEXT`
- `ELSE` runs iff `$TEST` is 0 (ISO 7.2.4)
- Comparison numeric iff both sides numeric (ISO 11756 §8.3)

### Goto

`label^routine` and `$$fn` / `$$label^routine` across routine files.

### Grammar

`m.tmLanguage.json` — comments (`;`), strings (`"`), commands, `$` intrinsics, labels, `^globals`, numbers, operators.

---

## 4. Tooling

| choice | why |
|---|---|
| TypeScript | LSP ecosystem |
| Bun 1.4 | no Node; runs TS natively |
| stdlib LSP over stdio | editor-agnostic |
| bun test | unit tests |

---

## 5. Test plan

| level | what |
|---|---|
| unit | tokenizer / parser / diagnostic rules |
| fixture | `~/_fileman` (VA FileMan 22.2) + VistA FOIA |
| smoke | server over stdio |
| acceptance | diagnostics + hover + goto |

Fixture rule: **read-only**.

---

## 6. Sequencing

1. Design note (done)
2. Scaffold + `LanguagePlugin` + LSP host
3. M core
4. Grammars
5. Fixture tests + smoke
