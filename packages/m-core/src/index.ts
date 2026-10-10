/**
 * M language core — tokenizer, symbol pass, diagnostics, hover, goto.
 *
 * Semantics grounded in RSM (`rsm-upstream` ad679d0) and our ISO-fix
 * record (`_rsm/UPSTREAM-DIFF.md`).  Surface named in docs/DESIGN.md §3.1.
 */
import type {
  Analysis,
  Diagnostic,
  HoverInfo,
  LanguagePlugin,
  Location,
  Reference,
  SymbolInfo,
  Token,
} from "../../core/src/index";
import { blockContext, extrinsicAtLine, fullCommand, quitArgAllowed, splitLines } from "./block";
import {
  emptyIndirectDiagnostics,
  forArgListStart,
  forArgsHover,
  indirectHover,
  parseForArgs,
} from "./forargs";

// ---------------------------------------------------------------- tables

/** Commands recognised in direct mode and routines (ISO / RSM). */
export const COMMANDS = new Set([
  "BREAK", "B",
  "CLOSE", "C",
  "DO", "D",
  "ELSE", "E",
  "FOR", "F",
  "GOTO", "G",
  "HALT", "H",
  "HANG", "H",
  "IF", "I",
  "JOB", "J",
  "KILL", "K",
  "LOCK", "L",
  "MERGE", "M",
  "NEW", "N",
  "OPEN", "O",
  "QUIT", "Q",
  "READ", "R",
  "SET", "S",
  "USE", "U",
  "VIEW", "V",
  "WRITE", "W",
  "XECUTE", "X",
]);

/** Full names of abbreviations that collide (`H` is HALT or HANG). */
const CMD_FULL = new Map<string, string>([
  ["B", "BREAK"], ["C", "CLOSE"], ["D", "DO"], ["E", "ELSE"], ["F", "FOR"],
  ["G", "GOTO"], ["H", "HALT"], ["I", "IF"], ["J", "JOB"], ["K", "KILL"],
  ["L", "LOCK"], ["M", "MERGE"], ["N", "NEW"], ["O", "OPEN"], ["Q", "QUIT"],
  ["R", "READ"], ["S", "SET"], ["U", "USE"], ["V", "VIEW"], ["W", "WRITE"],
  ["X", "XECUTE"],
]);

/** Intrinsic functions — unambiguous abbreviations map to full names. */
export const INTRINSICS: Record<string, { args: string; doc: string }> = {
  ASCII: { args: "(expr[,pos])", doc: "Character code of `expr` at `pos` (default 1). Out of range → **-1**." },
  CHAR: { args: "(n1[,...])", doc: "String of chars for codes 0–255. Out-of-range args contribute nothing." },
  DATA: { args: "(ref)", doc: "Node state: **0** undefined · **1** value only · **10** descendants only · **11** both. Takes the reference **unevaluated**." },
  EXTRACT: { args: "(expr[,from[,to]])", doc: "Substring by 1-based character positions." },
  FIND: { args: "(expr,substr[,start])", doc: "1-based position **after** `substr` in `expr`, else **0**. Empty `substr` → `start`." },
  FNUMBER: { args: "(num,code[,rnd])", doc: "Format `num`. Codes: `,` groups · `+` leading plus · `-` suppress sign · `T` trailing sign · `P` parentheses." },
  GET: { args: "(ref[,default])", doc: "Value of `ref`, or `default` (or empty) if undefined. **Never errors** on undefined. First arg unevaluated." },
  H: { args: "", doc: "`$HOROLOG` — days,seconds since 1840-12-31. Alias of `$HOROLOG`." },
  HOROLOG: { args: "", doc: "days,seconds since 1840-12-31. Writes as `0,0` in our ports' stub." },
  INCREMENT: { args: "(ref[,delta])", doc: "Add `delta` (default 1) to `ref`, store, return the **new** value. Undefined counts as 0." },
  J: { args: " / (expr,size[,rnd])", doc: "`$J` alone is **$JOB**. `$J(expr,size[,rnd])` is **$JUSTIFY** — right-justify / round." },
  JOB: { args: "", doc: "Job number of this process." },
  JUSTIFY: { args: "(expr,size[,rnd])", doc: "Right-justify `expr` in `size`. 3-arg form rounds `num` to `rnd` decimals." },
  LENGTH: { args: "(expr[,delim])", doc: "Character count, or piece count when `delim` is given." },
  NAME: { args: "(ref[,n])", doc: "Canonical name of `ref`, optionally truncated to `n` subscripts. String subscripts are quoted." },
  ORDER: { args: "(ref[,dir])", doc: "Next (`dir=1`) / previous (`dir=-1`) sibling subscript. **Empty subscript is the before-first / after-last marker at any position** (rsm#14, ISO 9.9). First arg unevaluated." },
  PIECE: { args: "(expr,delim[,from[,to]])", doc: "Piece(s) of `expr` delimited by `delim`." },
  Q: { args: "(ref[,dir])", doc: "`$QUERY` — next/previous node in tree-walk order (parent, children, next sibling)." },
  QLENGTH: { args: "(name)", doc: "Number of subscripts in a closed name string like `^A(1,2)`." },
  QUERY: { args: "(ref[,dir])", doc: "Next/previous node in preorder tree walk. First arg unevaluated." },
  QSUBSCRIPT: { args: "(name,n)", doc: "Subscript `n` of a closed name string. `n=0` is the naked name." },
  RANDOM: { args: "(n)", doc: "Random integer in `0 .. n-1`." },
  REVERSE: { args: "(expr)", doc: "Reverse `expr`." },
  RE: { args: "(expr)", doc: "`$REVERSE`." },
  STACK: { args: "", doc: "Current stack depth. 0 in direct mode." },
  ST: { args: "(n[,code])", doc: "Stack level info. Level 0 = `RUN`/`JOB`; `PLACE` / `MCODE` / `ECODE` codes." },
  T: { args: "", doc: "**`$TEST`** — 1 if the last `IF` was true (or a `SET $TEST` ran). Not `$TEXT`." },
  TEST: { args: "", doc: "1 if the last `IF` was true. ISO 7.2.4: `ELSE` runs iff `$TEST` is 0 (rsm#12)." },
  TEXT: { args: "(ref)", doc: "Source line of a routine ref (`tag^routine`, `+n^routine`). Empty when no routine is loaded. **Bare `$TEXT` is not a special variable** (M8)." },
  TRANSLATE: { args: "(expr,map[,new])", doc: "Map chars of `expr` through `map`→`new`. Unmapped-of-`new` chars are **deleted**." },
  TR: { args: "(expr,map[,new])", doc: "`$TRANSLATE` when parenthesised; bare `$TR` is `$TRESTART`." },
  TLEVEL: { args: "", doc: "Transaction level. **0** outside a transaction (rsm#15, ISO 6.3.20). Upstream RSM raises M8 — our ports report 0." },
  TRESTART: { args: "", doc: "Transaction restart count. **0** outside a transaction (rsm#15)." },
  SELECT: { args: "(cond:expr,...)", doc: "First true `cond`'s `expr`; errors if none." },
  CASE: { args: "(expr,c1:v1,...[,dflt])", doc: "Value for matching case, else `dflt`." },
  EVENT: { args: "", doc: "Last event (impl-specific; Cache/InterSystems)." },
  VIEW: { args: "…", doc: "Implementation-defined `VIEW` args (ISO allows any)." },
  WINDOW: { args: "(expr[,cursor])", doc: "Window-related (impl-specific)." },
  ROUTINE: { args: "", doc: "Routine name of the current stack frame (impl-specific)." },
  EREF: { args: "", doc: "Error reference (impl-specific)." },
  Z: { args: "", doc: "Implementation-specific `$Z*` set. Hover a concrete `$ZNAME` for its meaning." },
};

/** Abbreviation → intrinsic full name (unambiguous only). */
export const INTR_ABBR_PUBLIC: Record<string, string> = {
  ES: "STACK",
  ET: "ETRAP",
  EC: "ECODE",
  SY: "SYSTEM",
  PD: "PRINCIPAL",
  DI: "DEVICE",
  A: "ASCII", C: "CHAR", D: "DATA", E: "EXTRACT", F: "FIND", FN: "FNUMBER",
  G: "GET", I: "INCREMENT", J: "J", L: "LENGTH", N: "NAME", NA: "NAME",
  O: "ORDER", P: "PIECE", Q: "QUERY", QL: "QLENGTH", QS: "QSUBSCRIPT",
  R: "RANDOM", RE: "REVERSE", S: "STACK", ST: "ST", T: "TEST",
  TR: "TR", TL: "TLEVEL",
};

/** Special variables that are not functions. */
export const SPECIALS: Record<string, string> = {
  H: "`$HOROLOG` — days,seconds since 1840-12-31.",
  HOROLOG: "days,seconds since 1840-12-31.",
  IO: "Current device.",
  J: "Job number (`$JOB`).",
  JOB: "Job number of this process.",
  P: "`$PIECE` default delimiter (space).",
  Q: "`$QUIT` — 1 if a `QUIT` can return a value.",
  S: "`$REFERENCE` naked indicator path is `$S`? No — `$S` is `$STACK`.",
  STACK: "Current stack depth (0 in direct mode).",
  T: "**`$TEST`** — 1 if the last `IF` was true. Not `$TEXT`.",
  TEST: "1 if the last `IF` was true. `ELSE` runs iff this is 0 (ISO 7.2.4, rsm#12).",
  TL: "`$TLEVEL`.",
  TLEVEL: "**0** outside a transaction (rsm#15).",
  TR: "`$TRESTART`.",
  TRESTART: "**0** outside a transaction (rsm#15).",
  X: "`$X` — cursor column.",
  Y: "`$Y` — cursor row.",
  ECODE: "`$ECODE` — error code string (empty when no error).",
  ETRAP: "`$ETRAP` — error-trap command string.",
  ZTRAP: "`$ZTRAP` — Z error-trap string (implementation-specific).",
  ZEOF: "`$ZEOF` — end-of-file flag on the current device.",
  ZVERSION: "Implementation version string.",
  ZJOB: "Job number (impl-specific).",
  ZLEVEL: "Stack level (impl-specific).",
  ZSYSTEM: "System id string.",
  DEVICE: "Current device name (impl-specific).",
  KEY: "Key of the last READ.",
  REFERENCE: "Last global reference (naked path).",
  ESTACK: "Error stack depth.",
  ET: "`$ETRAP`.",
  ETRAP: "`$ETRAP` — error-trap command string.",
  EC: "`$ECODE`.",
  ECODE: "`$ECODE` — error code string.",
  QUIT: "`$QUIT`.",
  CASE: "`$CASE` — case function.",
  SELECT: "`$SELECT`.",
  EVENT: "`$EVENT` (impl-specific).",
  V: "`$VIEW` / impl-specific `$V`.",
  VIEW: "Implementation-defined `VIEW`.",
  W: "`$WINDOW` (impl-specific).",
  WINDOW: "Impl-specific window special.",
  PD: "`$PRINCIPAL`.",
  PRINCIPAL: "Principal device.",
  DI: "`$DEVICE`.",
  DEVICE: "Current device name.",
  SY: "`$SYSTEM`.",
  SYSTEM: "System string.",
  EREF: "Error reference (impl-specific).",
  ROUTINE: "Current routine name (impl-specific).",
  ZEOF: "`$ZEOF`.",
  ZTRAP: "`$ZTRAP`.",
  ZJOB: "Impl-specific job number.",
  ZLEVEL: "Impl-specific stack level.",
  ZSYSTEM: "Impl-specific system string.",
  ZVERSION: "Impl-specific version.",
  STORAGE: "Storage available (impl-specific).",
  SYSTEM: "System string.",
  PRINCIPAL: "Principal device.",
  IO: "Current device.",
};

// ---------------------------------------------------------------- lexer

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const push = (kind: Token["kind"], start: number, end: number) => {
    out.push({ kind, text: text.slice(start, end), range: { start, end } });
  };
  while (i < text.length) {
    const c = text[i];
    // comment to EOL
    if (c === ";") {
      const s = i;
      while (i < text.length && text[i] !== "\n") i++;
      push("comment", s, i);
      continue;
    }
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      const s = i;
      while (i < text.length && " \t\n\r".includes(text[i])) i++;
      push("whitespace", s, i);
      continue;
    }
    // string
    if (c === '"') {
      const s = i;
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      push("string", s, i);
      continue;
    }
    // global
    if (c === "^") {
      const s = i;
      i++;
      while (i < text.length && /[A-Za-z%0-9]/.test(text[i])) i++;
      push("global", s, i);
      continue;
    }
    // intrinsic / special  ($NAME)
    if (c === "$") {
      const s = i;
      i++;
      if (text[i] === "$") i++; // extrinsic $$foo
      while (i < text.length && /[A-Za-z%0-9]/.test(text[i])) i++;
      push("intrinsic", s, i);
      continue;
    }
    // number
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      const s = i;
      while (i < text.length && /[0-9]/.test(text[i])) i++;
      if (text[i] === ".") { i++; while (i < text.length && /[0-9]/.test(text[i])) i++; }
      if (text[i] === "e" || text[i] === "E") {
        const save = i;
        i++;
        if (text[i] === "+" || text[i] === "-") i++;
        if (/[0-9]/.test(text[i] ?? "")) {
          while (i < text.length && /[0-9]/.test(text[i])) i++;
        } else i = save;
      }
      push("number", s, i);
      continue;
    }
    // operators (longest first)
    const ops = ["**", "'", ">=", "<=", "<>", "'=", "'<", "'>", "'&", "'!", "'[", "']", "']]",
      "]]", "_", "=", "<", ">", "+", "-", "*", "/", "\\", "#", "&", "!", "[", "]", "?", "@"];
    let matched = "";
    for (const o of ops) {
      if (text.startsWith(o, i)) { matched = o; break; }
    }
    if (matched) {
      push("operator", i, i + matched.length);
      i += matched.length;
      continue;
    }
    // punct
    if ("(),:".includes(c)) {
      push("punct", i, i + 1);
      i++;
      continue;
    }
    // identifier (label, command, local)
    if (/[A-Za-z%]/.test(c)) {
      const s = i;
      while (i < text.length && /[A-Za-z0-9%]/.test(text[i])) i++;
      push("ident", s, i);
      continue;
    }
    push("unknown", i, i + 1);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- analysis

function resolveIntrinsic(raw: string): string | null {
  // raw is like "$DATA" or "$D" or "$$foo"
  if (raw.startsWith("$$")) return null; // extrinsic call, not an intrinsic
  const name = raw.slice(1).toUpperCase();
  if (INTRINSICS[name]) return name;
  if (INTR_ABBR_PUBLIC[name] && INTRINSICS[INTR_ABBR_PUBLIC[name]]) return INTR_ABBR_PUBLIC[name];
  // Special variables are valid `S $X=…` / `W $Y` forms (M8 / W8)
  if (SPECIALS[name]) return name;
  // $Z* family — treat as known specials
  if (name.startsWith("Z")) return name;
  return null;
}

function isIntrinsicName(raw: string): boolean {
  return raw.startsWith("$") && !raw.startsWith("$$") && raw.length > 1;
}

export function analyse(uri: string, text: string): Analysis {
  const tokens = tokenize(text);
  const diagnostics: Diagnostic[] = [];
  const symbols: SymbolInfo[] = [];
  const references: Reference[] = [];

  // Split into lines for IF/ELSE, command structure, and DO/FOR blocks.
  const lines = splitLines(text, tokens);
  const { stackAtLine, framesOpenedOnLine } = blockContext(lines);
  const inExtrinsic = extrinsicAtLine(lines);

  // Label at start of line:  LABEL  or  LABEL(args)  or  label^routine
  for (const line of lines) {
    const first = line.tokens[0];
    if (!first) continue;
    if (first.kind === "ident") {
      const second = line.tokens[1];
      if (second && second.kind === "operator" && second.text === "^") {
        // not a label — this is a routine-ref expression
      } else if (second && second.kind === "punct" && second.text === "(") {
        symbols.push({ name: first.text, kind: "label", range: first.range });
        references.push({ name: first.text, kind: "label", range: first.range, isDefinition: true });
      } else {
        // A leading known command is not a label (`F I=…`, `D FOO`).
        const isCmd = COMMANDS.has(first.text.toUpperCase());
        if (!isCmd) {
          symbols.push({ name: first.text, kind: "label", range: first.range });
          references.push({ name: first.text, kind: "label", range: first.range, isDefinition: true });
        }
      }
    }
  }

  // Walk tokens: commands, post-conditionals, refs, intrinsics.
  let sawIf = 0; // depth of IFs awaiting possible ELSE on this / recent lines
  let ifStack: number[] = []; // per-line IF counts for ELSE binding
  let lineHasIf = 0;

  const pushDiag = (d: Diagnostic) => diagnostics.push(d);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    lineHasIf = 0;
    const toks = line.tokens;
    for (const d of emptyIndirectDiagnostics(toks)) pushDiag(d);
    let idx = 0;
    // skip label — but never skip a leading known command (`F I=…`, `D FOO`).
    // A label is `NAME` or `NAME(args)`; `NAME(args)` wins even if NAME is a
    // command word (rare entry point).
    if (toks[0] && toks[0].kind === "ident") {
      const second = toks[1];
      const isFormals = second && second.kind === "punct" && second.text === "(";
      const firstIsCmd = COMMANDS.has(toks[0].text.toUpperCase());
      if (isFormals || !firstIsCmd) {
        const looksLabel =
          isFormals ||
          !second ||
          (second && second.kind === "ident" && COMMANDS.has(second.text.toUpperCase())) ||
          (second && second.kind === "operator" && second.text !== "^");
        if (looksLabel && !(second && second.kind === "operator" && second.text === "^")) {
          idx = 1;
        }
      }
    }

    while (idx < toks.length) {
      const t = toks[idx];
      // command word
      if (t.kind === "ident" && COMMANDS.has(t.text.toUpperCase())) {
        const up = t.text.toUpperCase();
        const full = CMD_FULL.get(t.text.toUpperCase()) ?? up;
        // H is HALT or HANG — disambiguate is not required for v1 diagnostics
        t.kind = "command";
        references.push({ name: full, kind: "label", range: t.range, isDefinition: false });

        if (full === "IF") lineHasIf++;
        if (full === "FOR") {
          // `F(` is a variable named F, not FOR (FileMan DIFROM/XUPC991)
          const after = toks[idx + 1];
          const fParen = !!after && after.kind === "punct" && after.text === "(";
          if (!fParen) {
          const argStart = forArgListStart(toks, idx);
          const info = parseForArgs(toks, argStart, t.range.end, text);
          // Exclusive list (`F I=1,2,3`), `0:0`, and argumentless FOR are legal.
          // `F  CMD args` is argumentless FOR + body (legal).
          // Only flag a *spec* that has `=` but failed to parse as `var=…`.
          const raw = info?.raw ?? "";
          const hasEq = /=/.test(raw);
          const head = raw.trim()[0] ?? "";
          // Number-leading spec (`F 1:1:3`) is malformed; ident-leading
          // without `=` is argumentless FOR + body (ZGETPAGE / CS).
          const trimmed = raw.trim();
          // `F .` / `F .cmd` — argumentless FOR + dotted body (legal)
          const dottedFor = trimmed === "." || /^\.\s*\S/.test(trimmed);
          const numberSpec = /^[0-9.+-]/.test(trimmed) && !dottedFor;
          if (info && raw.trim() && !info.variable && !info.bareSpec && !info.hasList
              && !dottedFor && (hasEq || numberSpec)) {
            pushDiag({
              range: info.range,
              message: "`FOR` argument list looks malformed — expected `var=from[:inc:to[:cmd]]`, `var=a,b,c`, `0:0`, or argumentless `FOR`.",
              severity: "warning",
              code: "m/for-args",
            });
          }
          }
        }
        if (full === "ELSE") {
          if (lineHasIf === 0 && sawIf === 0) {
            pushDiag({
              range: t.range,
              message: "`ELSE` with no preceding `IF` — ISO 7.2.4 binds ELSE to the nearest IF (rsm#12).",
              severity: "error",
              code: "m/unbalanced-else",
            });
          } else if (lineHasIf > 0) {
            lineHasIf--;
          } else {
            sawIf--;
          }
        }
        if (full === "QUIT") {
          // Dotted stack at line start + FOR/DO frames opened earlier on this line.
          const stack = [
            ...stackAtLine[lineIdx],
            ...framesOpenedOnLine[lineIdx].filter((f) => f.openOffset < t.range.start),
          ];
          const next = toks[idx + 1];
          if (next && (next.kind === "number" || next.kind === "string" ||
            (next.kind === "ident" && !COMMANDS.has(next.text.toUpperCase())) ||
            (next.kind === "intrinsic") || (next.kind === "global") ||
            (next.kind === "operator" && (next.text === "-" || next.text === "+" || next.text === "$" || next.text === "(")))) {
            // argless QUIT is `Q` alone or `Q:` postcond then EOL / next cmd
            const allowed = quitArgAllowed(stack) || inExtrinsic[lineIdx];
            if (!(next.kind === "punct" && next.text === ":") && !allowed) {
              pushDiag({
                range: t.range,
                message: "`QUIT` with an argument is only valid inside a `DO` block or `FOR` body. Argumentless `QUIT` is the top-level form (ISO 8.1.2).",
                severity: "warning",
                code: "m/quit-arg-context",
              });
            }
          }
        }
        idx++;
        // post-conditional `:` immediately after command
        if (toks[idx] && toks[idx].kind === "punct" && toks[idx].text === ":") {
          const colon = toks[idx];
          const exprStart = toks[idx + 1];
          // ISO 7.1.3: postcond is always an expression when a token follows.
          // `!` is $TEST; command words (X, I, Q, L, …) are valid *variable*
          // names in expressions (`Q:X=2`, `S:X="@"`). Only `:` / `:;comment`
          // is empty.
          const isExpr = !!exprStart && exprStart.kind !== "comment";
          if (!isExpr) {
            pushDiag({
              range: colon.range,
              message: "Post-conditional `:` with no expression.",
              severity: "error",
              code: "m/empty-postcond",
            });
          } else {
            // severity-split: valid ISO postcond is INFORMATION only;
            // empty `:` is m/empty-postcond (error). Never mix the two.
            pushDiag({
              range: { start: colon.range.start, end: exprStart.range.end },
              message: "Post-conditional — the command runs only when this expression is true (ISO 7.1.3).",
              severity: "information",
              code: "m/postcond",
            });
          }
          idx++;
        }
        continue;
      }
      // also allow a lone ident that looks like a command abbreviation already handled
      if (t.kind === "ident" && idx === 0 && COMMANDS.has(t.text.toUpperCase())) {
        idx++;
        continue;
      }
      // intrinsic
      if (t.kind === "intrinsic") {
        const resolved = resolveIntrinsic(t.text);
        if (isIntrinsicName(t.text) && !resolved) {
          pushDiag({
            range: t.range,
            message: `Unknown intrinsic \`${t.text}\` — see docs/DESIGN.md §3.1 for the v1 table.`,
            severity: "error",
            code: "m/unknown-intrinsic",
          });
        } else if (resolved) {
          references.push({ name: "$" + resolved, kind: "fn", range: t.range, isDefinition: false });
        } else if (t.text.startsWith("$$")) {
          // extrinsic
          const name = t.text.slice(2);
          references.push({ name, kind: "fn", range: t.range, isDefinition: false });
        }
        idx++;
        continue;
      }
      // global / local refs
      if (t.kind === "global") {
        const name = t.text.slice(1);
        references.push({ name: t.text, kind: "global", range: t.range, isDefinition: false });
        symbols.push({ name: t.text, kind: "global", range: t.range });
        idx++;
        continue;
      }
      if (t.kind === "ident") {
        // local variable or routine ref:  label^routine  is lexed as
        // ident + global (`^routine` is one token).
        const next = toks[idx + 1];
        if (next && next.kind === "global") {
          // label^routine
          const routine = next.text.slice(1);
          references.push({ name: t.text, kind: "label", range: t.range, isDefinition: false });
          references.push({ name: next.text, kind: "routine", range: next.range, isDefinition: false });
          symbols.push({ name: next.text, kind: "routine", range: next.range });
          // `$T(@T^@R)`, `G @("A^"_DNM)`, `^(0)`, `^UTILITY(…)` — indirection
          // and naked globals are not routine names.
          // `^(0)` / `^UTILITY(…)` / `$T(@T^@R)` are not routine names;
          // `FOO^` (empty name) still is invalid.
          const naked = routine.startsWith("(");
          const indirect = routine.includes("@") || (idx >= 1 && toks[idx-1]?.text === "@");
          if (!naked && !indirect && !/^[A-Za-z%][A-Za-z0-9]*$/.test(routine)) {
            pushDiag({
              range: next.range,
              message: `Invalid routine name \`${routine}\`.`,
              severity: "warning",
              code: "m/invalid-routine",
            });
          }
          idx += 2;
          continue;
        }
        if (!COMMANDS.has(t.text.toUpperCase())) {
          references.push({ name: t.text, kind: "local", range: t.range, isDefinition: false });
        }
        idx++;
        continue;
      }
      idx++;
    }
    if (lineHasIf > 0) sawIf += lineHasIf;
  }

  // IF with no ELSE anywhere is fine; we only flag stray ELSE.

  const hover = (offset: number): HoverInfo | null => {
    for (const t of tokens) {
      if (offset < t.range.start || offset >= t.range.end) continue;
      if (t.kind === "intrinsic") {
        const resolved = resolveIntrinsic(t.text);
        if (!resolved) {
          if (t.text.startsWith("$$")) {
            return { value: `**extrinsic function** \`${t.text.slice(2)}\`\n\nDefined in a routine; \`goto\` jumps to its label.`, range: t.range };
          }
          return { value: `unknown intrinsic \`${t.text}\``, range: t.range };
        }
        const info = INTRINSICS[resolved];
        if (!info) {
          return { value: `\`${t.text}\` — \`$${resolved}\` (implementation-specific)`, range: t.range };
        }
        return {
          value: `**\`$${resolved}\`${info.args}**\n\n${info.doc}`,
          range: t.range,
        };
      }
      if (t.kind === "command") {
        const full = CMD_FULL.get(t.text.toUpperCase()) ?? t.text.toUpperCase();
        const base = `**\`${full}\`** command${t.text.length < full.length ? ` (abbreviation \`${t.text}\`)` : ""}`;
        if (full === "FOR") {
          const line = lines.find((ln) => offset >= ln.start && offset < ln.end);
          if (line) {
            const li = line.tokens.findIndex((x) => x.range.start === t.range.start);
            if (li >= 0) {
              const info = parseForArgs(line.tokens, forArgListStart(line.tokens, li), t.range.end, text);
              if (info) return { value: forArgsHover(info), range: t.range };
            }
          }
        }
        return { value: base, range: t.range };
      }
      if (t.kind === "operator" && t.text === "@") {
        return indirectHover(t);
      }
      if (t.kind === "global") {
        return {
          value: `**global** \`${t.text}\`\n\nSparse multi-dimensional array. \`$DATA\` on a node returns **0/1/10/11**.`,
          range: t.range,
        };
      }
    }
    return null;
  };

  const definitions = (
    offset: number,
    ws?: import("../../core/src/workspace").WorkspaceIndex,
  ): Location[] => {
    for (const t of tokens) {
      if (offset < t.range.start || offset >= t.range.end) continue;

      // --- $$extrinsic or $$label^routine -------------------------------
      if (t.kind === "intrinsic" && t.text.startsWith("$$")) {
        const rest = t.text.slice(2);
        const caret = rest.indexOf("^");
        let label = rest;
        let routine: string | null = null;
        if (caret >= 0) {
          label = rest.slice(0, caret);
          routine = rest.slice(caret + 1);
        }
        // same document first
        const local = symbols
          .filter((s) => s.name === label && s.kind === "label")
          .map((s) => ({ uri, range: s.range }));
        if (local.length && !routine) return local;
        if (ws) {
          if (routine) {
            const out: Location[] = [];
            for (const file of ws.filesForBase(routine)) {
              out.push(...ws.labelInFile(file, label));
            }
            if (out.length) return out;
          }
          const cross = ws.lookupKind(label, "label");
          if (cross.length) return cross;
        }
        return local;
      }

      // --- label^routine  (lexed as ident + global) ----------------------
      if (t.kind === "ident") {
        const next = tokens[tokens.indexOf(t) + 1];
        if (next && next.kind === "global") {
          const routine = next.text.slice(1);
          if (offset >= next.range.start && offset < next.range.end) {
            // cursor on the routine name: jump to its file
            if (ws) {
              const files = ws.filesForBase(routine);
              if (files.length) return files.map((f) => ({ uri: f, range: { start: 0, end: 0 } }));
            }
            return [];
          }
          // cursor on the label
          const local = symbols
            .filter((s) => s.name === t.text && s.kind === "label")
            .map((s) => ({ uri, range: s.range }));
          if (ws) {
            const out: Location[] = [];
            for (const file of ws.filesForBase(routine)) {
              out.push(...ws.labelInFile(file, t.text));
            }
            if (out.length) return out;
            const cross = ws.lookupKind(t.text, ["label", "routine"]);
            if (cross.length) return cross;
          }
          return local;
        }
        // plain ident: label / local / routine name
        const local = symbols
          .filter((s) => s.name === t.text)
          .map((s) => ({ uri, range: s.range }));
        if (local.length) return local;
        if (ws) {
          const cross = ws.lookupKind(t.text, ["label", "routine", "fn"]);
          if (cross.length) return cross;
        }
        return local;
      }

      // --- global --------------------------------------------------------
      if (t.kind === "global") {
        // `label^routine` — the `^routine` is one global token.  If the
        // previous token is an ident, this is a routine reference.
        const idx = tokens.indexOf(t);
        const prev = idx > 0 ? tokens[idx - 1] : undefined;
        if (prev && prev.kind === "ident") {
          const routine = t.text.slice(1);
          if (ws) {
            const files = ws.filesForBase(routine);
            if (files.length) return files.map((f) => ({ uri: f, range: { start: 0, end: 0 } }));
          }
          return [];
        }
        const local = symbols
          .filter((s) => s.name === t.text)
          .map((s) => ({ uri, range: s.range }));
        if (ws) {
          const cross = ws.lookup(t.text);
          if (cross.length) return cross;
        }
        return local;
      }
    }
    return [];
  };

  return { tokens, symbols, references, diagnostics, hover, definitions };
}

export const mPlugin: LanguagePlugin = {
  id: "m",
  extensions: [".m", ".M", ".mumps"],
  analyse,
};

export { lintOnlyDiagnostics, LINT_CODES, INFO_CODES, DEPRECATED_INTRINSICS } from "./lint";
export type { LintOptions } from "./lint";
