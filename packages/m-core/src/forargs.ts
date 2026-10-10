/**
 * FOR argument lists and indirection `@` (m-lsp#2 / m-lsp#3).
 *
 * ISO FOR argument forms:
 *   F  rest                 argumentless (body = rest of line)
 *   F i=1,2,3               exclusive list
 *   F i=from                exclusive list (single value)
 *   F i=1:2                 from:increment (to omitted)
 *   F i=1:1:10              from:inc:to
 *   F i=1:1:10:cmds         from:inc:to:command
 *   F i=1,2,3:cmds          exclusive list + command
 *   F 0:0 rest              argumented forever (no var)
 *   F 0:0:cmds              forever + command
 *
 * m-lsp#3: raw text preserves spaces; `$fn(...)` / `(…)` stay in the
 * `from` expression; `:cmds` is only after a list or a full `from:inc:to`
 * (not after a single `from:` or `from:inc` — those leave the rest of the
 * line as the FOR *body*).
 */
import type { Diagnostic, HoverInfo, Token } from "../../core/src/index";
import { fullCommand } from "./block";

export interface ForArgInfo {
  /** variable name, or null for `0:0` / malformed */
  variable: string | null;
  /** argument-list text as written (spaces preserved when `text` is given) */
  raw: string;
  /** `:` count inside the var/bare spec, excluding a trailing `:cmds` */
  specColons: number;
  /** comma-separated exclusive list */
  hasList: boolean;
  hasCommandInArgs: boolean;
  /** true for `0:0` style (no var=) */
  bareSpec: boolean;
  /** spec missing a piece (e.g. `1:1:`) */
  incomplete: boolean;
  range: { start: number; end: number };
}

function isCommandTok(t: Token | undefined): boolean {
  return (
    !!t &&
    (t.kind === "ident" || t.kind === "command") &&
    fullCommand(t.text) !== null
  );
}

function isExprStart(t: Token | undefined): boolean {
  return (
    !!t &&
    (t.kind === "number" || t.kind === "ident" || t.kind === "intrinsic" ||
      t.kind === "string" || t.kind === "global" ||
      (t.kind === "punct" && (t.text === "(" || t.text === "-")))
  );
}

function isWs(t: Token | undefined): boolean {
  return !!t && t.kind === "whitespace";
}

function nextTok(toks: Token[], i: number): number {
  while (i < toks.length && isWs(toks[i])) i++;
  return i;
}

/** Consume one FROM/expression: numbers, idents, `$f(…)`, `(…)`, `^g`, strings. */
function readExprTokens(toks: Token[], i: number): number {
  let depth = 0;
  i = nextTok(toks, i);
  while (i < toks.length && toks[i].kind !== "comment") {
    const t = toks[i];
    if (isWs(t)) {
      i++;
      continue;
    }
    if (t.kind === "punct") {
      if (t.text === "(") depth++;
      else if (t.text === ")") {
        if (depth === 0) return i;
        depth--;
      } else if (t.text === "," && depth === 0) return i;
      else if (t.text === ":" && depth === 0) return i;
      i++;
      continue;
    }
    if (depth === 0 && t.kind === "operator" && t.text !== "^" && t.text !== "'") {
      i++;
      continue;
    }
    if (depth === 0 && isCommandTok(t) && !isExprStart(t)) return i;
    i++;
    i = nextTok(toks, i);
  }
  return i;
}

/** Token after `FOR`[`:pc`] is where the argument list starts. */
export function forArgListStart(toks: Token[], forIdx: number): number {
  let i = nextTok(toks, forIdx + 1);
  if (toks[i]?.kind === "punct" && toks[i].text === ":") {
    i = nextTok(toks, i + 1);
    while (i < toks.length && !isCommandTok(toks[i]) && toks[i].kind !== "comment") {
      i = nextTok(toks, i + 1);
    }
  }
  return i;
}

/**
 * Parse a FOR argument list starting at `start`.
 * `text` (optional) is the source line so `raw` keeps original spacing.
 */
export function parseForArgs(
  toks: Token[],
  start: number,
  forEnd: number,
  text?: string,
): ForArgInfo | null {
  let i = nextTok(toks, start);
  if (i >= toks.length || toks[i].kind === "comment") return null;

  const t0 = toks[i];
  const t1 = toks[nextTok(toks, i + 1)];
  const nextIsVar =
    !!t0 &&
    (t0.kind === "ident" || t0.kind === "command") &&
    t1?.kind === "operator" &&
    t1.text === "=";
  // Not a FOR spec: junk heads from other commands' continuation (C65-style)
  const junkHead =
    !!t0 &&
    ((t0.kind === "punct" && (t0.text === ")" || t0.text === "," || t0.text === ":")) ||
      (t0.kind === "operator" && t0.text !== "@") ||
      (t0.kind === "string" && !nextIsVar));
  if (junkHead) {
    return {
      variable: null,
      raw: "",
      specColons: 0,
      hasList: false,
      hasCommandInArgs: false,
      bareSpec: false,
      incomplete: false,
      range: { start: forEnd, end: forEnd },
    };
  }
  if (!nextIsVar && (i >= toks.length || toks[i].kind === "comment" || isCommandTok(toks[i]))) {
    return {
      variable: null,
      raw: "",
      specColons: 0,
      hasList: false,
      hasCommandInArgs: false,
      bareSpec: false,
      incomplete: false,
      range: { start: forEnd, end: forEnd },
    };
  }

  const argStart = toks[i].range.start;
  let variable: string | null = null;
  let hasList = false;
  let hasCommandInArgs = false;
  let bareSpec = false;
  let incomplete = false;
  let specColons = 0;

  // `0:0` forever form
  if (
    toks[i].kind === "number" &&
    toks[i].text === "0" &&
    toks[nextTok(toks, i + 1)]?.kind === "punct" &&
    toks[nextTok(toks, i + 1)]?.text === ":"
  ) {
    bareSpec = true;
    specColons = 1;
    i = nextTok(toks, i + 1) + 1;
    i = nextTok(toks, i);
    if (i < toks.length && toks[i].kind === "number") i = nextTok(toks, i + 1);
  } else if (nextIsVar) {
    variable = toks[i].text;
    i = nextTok(toks, i + 2);
    i = readExprTokens(toks, i);
    i = nextTok(toks, i);
    while (i < toks.length && toks[i].kind === "punct" && toks[i].text === ",") {
      hasList = true;
      i = readExprTokens(toks, nextTok(toks, i + 1));
      i = nextTok(toks, i);
    }
  } else {
    // malformed
  }

  // colon tail (:inc/:to/:cmds) — runs for var= and 0:0
  while (i < toks.length && toks[i].kind === "punct" && toks[i].text === ":") {
    i = nextTok(toks, i + 1);
    const atEnd =
      i >= toks.length ||
      toks[i].kind === "comment" ||
      (toks[i].kind === "punct" && (toks[i].text === ":" || toks[i].text === ","));
    if (atEnd && !hasList) {
      incomplete = true;
      specColons++;
      continue;
    }
    if (isCommandTok(toks[i]) && (hasList || bareSpec || specColons >= 2)) {
      hasCommandInArgs = true;
      i = toks.length;
      break;
    }
    // `F I=1: S body` — one colon then a command is the FOR *body*, not `:cmds`
    if (isCommandTok(toks[i]) && !hasList && !bareSpec && specColons < 2) {
      break;
    }
    if (hasList) {
      hasCommandInArgs = true;
      i = toks.length;
      break;
    }
    specColons++;
    i = readExprTokens(toks, i);
    i = nextTok(toks, i);
    if (specColons > 3) {
      hasCommandInArgs = true;
      i = toks.length;
      break;
    }
  }

  if (!hasCommandInArgs) {
    while (i < toks.length && toks[i].kind !== "comment") {
      if (!isWs(toks[i]) && isCommandTok(toks[i])) break;
      i++;
    }
  }

  let end = i > 0 ? toks[Math.min(i, toks.length) - 1].range.end : forEnd;
  // trim trailing whitespace from the raw span
  if (text != null) {
    while (end > argStart && /\s/.test(text[end - 1] ?? "")) end--;
  }
  const rawStart = argStart;
  const rawEnd = Math.max(end, argStart);
  const raw =
    text != null
      ? text.slice(rawStart, rawEnd)
      : toks.slice(start, i).map((t) => t.text).join("");

  return {
    variable,
    raw,
    specColons,
    hasList,
    hasCommandInArgs,
    bareSpec,
    incomplete,
    range: { start: rawStart, end: rawEnd },
  };
}

/**
 * `@` with no following expression token.
 * Only flag a missing operand — `@X` is valid indirection even when `X`
 * collides with a command abbreviation (`X`=XECUTE, `I`=IF, …).
 */
export function emptyIndirectDiagnostics(toks: Token[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== "operator" || t.text !== "@") continue;
    const next = toks[i + 1];
    const empty = !next || next.kind === "comment";
    if (empty) {
      out.push({
        range: t.range,
        message: "Indirection `@` with no expression — the next argument is evaluated as a name or command.",
        severity: "error",
        code: "m/empty-indirect",
      });
    }
  }
  return out;
}

export function indirectHover(t: Token): HoverInfo {
  return {
    value: "**indirection `@`**\n\nThe following argument is evaluated as a name (SET/GET/KILL) or as a command / label (DO/GOTO). LSP cannot resolve the target statically.",
    range: t.range,
  };
}

function specShape(info: ForArgInfo): string {
  if (info.bareSpec) {
    return info.hasCommandInArgs
      ? "`0:0` + trailing command in the argument list"
      : "`0:0` — argumented forever form";
  }
  const v = info.variable ?? "?";
  if (info.hasList) {
    return info.hasCommandInArgs
      ? `exclusive list \`${v}=from,from,…\` with trailing command`
      : `exclusive list \`${v}=from,from,…\``;
  }
  if (info.specColons === 0) {
    return `\`${v}=from\``;
  }
  if (info.specColons === 1) {
    return `\`${v}=from:increment\`${info.incomplete ? " (incomplete)" : ""}`;
  }
  if (info.specColons >= 2) {
    const base = `\`${v}=from:increment:to\`${info.incomplete ? " (incomplete)" : ""}`;
    return info.hasCommandInArgs ? `${base} with trailing command` : base;
  }
  return `\`${v}=…\``;
}

export function forArgsHover(info: ForArgInfo): string {
  if (!info.raw) {
    return "**`FOR`** — argumentless; commands on this line repeat until `QUIT`.";
  }
  const shape = specShape(info);
  const body = info.hasCommandInArgs
    ? "Command lives in the argument list; the rest of this line follows it."
    : "Body is the rest of this line.";
  return `**\`FOR ${info.raw.trim()}\`**\n\n${shape}. ${body}`;
}
