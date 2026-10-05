/**
 * FOR argument lists and indirection `@` (m-lsp#2).
 *
 * ISO FOR argument forms:
 *   F  rest                 argumentless (body = rest of line)
 *   F i=1,2,3               exclusive list
 *   F i=1:1:10              from:inc:to
 *   F i=1:1:10:cmds         from:inc:to:command
 *   F 0:0 rest              argumented forever (no var)
 */
import type { Diagnostic, HoverInfo, Token } from "../../core/src/index";
import { fullCommand } from "./block";

export interface ForArgInfo {
  /** variable name, or null for `0:0` */
  variable: string | null;
  /** raw argument-list text (tokens between FOR and first command atom) */
  raw: string;
  hasColonSpec: boolean;
  hasCommandInArgs: boolean;
  /** true for `0:0` style (no var=) */
  bareSpec: boolean;
  range: { start: number; end: number };
}

function isCommandTok(t: Token | undefined): boolean {
  // after analyse() walks the line, command tokens are kind "command"
  return (
    !!t &&
    (t.kind === "ident" || t.kind === "command") &&
    fullCommand(t.text) !== null
  );
}

/** Token after `FOR`[`:pc`] is where the argument list starts. */
export function forArgListStart(toks: Token[], forIdx: number): number {
  let i = forIdx + 1;
  if (toks[i]?.kind === "punct" && toks[i].text === ":") {
    i++;
    while (i < toks.length && !isCommandTok(toks[i]) && toks[i].kind !== "comment") i++;
  }
  return i;
}

/**
 * Parse a FOR argument list starting at `start`.
 * Stops at the first command atom that is not clearly part of `var=…:cmd`.
 */
export function parseForArgs(toks: Token[], start: number, forEnd: number): ForArgInfo | null {
  let i = start;
  if (i >= toks.length || toks[i].kind === "comment") return null;

  // argumentless FOR: next token is a command (or empty / comment).
  // `F I=…` / `F D=…` — variable names that collide with command
  // abbreviations are variables when followed by `=`.
  // (After analyse(), those abbreviations may already be kind "command".)
  const nextIsVar =
    !!toks[i] &&
    (toks[i].kind === "ident" || toks[i].kind === "command") &&
    toks[i + 1]?.kind === "operator" &&
    toks[i + 1].text === "=";
  if (!nextIsVar && (i >= toks.length || toks[i].kind === "comment" || isCommandTok(toks[i]))) {
    return {
      variable: null,
      raw: "",
      hasColonSpec: false,
      hasCommandInArgs: false,
      bareSpec: false,
      range: { start: forEnd, end: forEnd },
    };
  }

  const argStart = toks[i].range.start;
  let variable: string | null = null;
  let hasColon = false;
  let hasCommandInArgs = false;
  let bareSpec = false;

  // `0:0` — exactly 0 then colon (no var=)
  if (
    toks[i].kind === "number" &&
    toks[i].text === "0" &&
    toks[i + 1]?.kind === "punct" &&
    toks[i + 1].text === ":"
  ) {
    bareSpec = true;
    hasColon = true;
    i += 2;
  } else if (
    (toks[i].kind === "ident" || toks[i].kind === "command") &&
    toks[i + 1]?.kind === "operator" &&
    toks[i + 1].text === "="
  ) {
    // `F I=…` — `I` is a variable even though `I` is also IF
    variable = toks[i].text;
    i += 2;
    if (toks[i]?.kind === "punct" && toks[i].text === ":") hasColon = true;
  } else {
    // not argumentless, not var=, not 0:0 → malformed
  }

  // consume argument tokens until we hit a command that starts the body
  // (unless we are inside `:command` after a 3-colon spec)
  let colons = 0;
  while (i < toks.length && toks[i].kind !== "comment") {
    const t = toks[i];
    if (isCommandTok(t) && !(hasColon && colons >= 3 && hasCommandInArgs)) {
      // after `var=from:inc:to` a further `:cmd` may start with a command name
      // that is actually the FOR command-argument; detect `:` just before
      const prev = toks[i - 1];
      const afterColon =
        prev?.kind === "punct" && prev.text === ":";
      if (afterColon && hasColon) {
        hasCommandInArgs = true;
        i++;
        continue;
      }
      break;
    }
    if (t.kind === "punct" && t.text === ":") {
      hasColon = true;
      colons++;
    }
    i++;
  }

  const argEnd = i > start ? toks[i - 1].range.end : forEnd;
  return {
    variable,
    raw: toks.slice(start, i).map((t) => t.text).join(""),
    hasColonSpec: hasColon,
    hasCommandInArgs,
    bareSpec,
    range: { start: argStart, end: argEnd },
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

export function forArgsHover(info: ForArgInfo): string {
  if (!info.raw) {
    return "**`FOR`** — argumentless; commands on this line repeat until `QUIT`.";
  }
  if (info.bareSpec) {
    return "**`FOR 0:0`** — argumented forever form; body repeats until `QUIT`.";
  }
  const v = info.variable ?? "?";
  if (info.hasColonSpec) {
    const tail = info.hasCommandInArgs ? " with trailing command in the argument list" : "";
    return `**\`FOR ${info.raw}\`**\n\n\`${v}=from:increment:to\`${tail}. Body is the rest of this line.`;
  }
  return `**\`FOR ${info.raw}\`**\n\nExclusive list for \`${v}\`. Body is the rest of this line.`;
}
