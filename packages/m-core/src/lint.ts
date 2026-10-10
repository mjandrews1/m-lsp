/**
 * M lint-only rules (rsm#28).  Companions to `analyse()` in index.ts.
 *
 * These are CI-oriented — trailing whitespace and line length would
 * flood the editor, so the LSP does not publish them.  Same `m/…`
 * code namespace so editor and CLI agree on the shared subset.
 */
import type { Diagnostic, Token } from "../../core/src/index";
import { tokenize, INTRINSICS, INTR_ABBR_PUBLIC } from "./index";

export interface LintOptions {
  /** max line length for `m/long-line`; default 256 */
  maxLineLength?: number;
  /** severity overrides by rule code */
  severity?: Record<string, "error" | "warning" | "information" | "off">;
}

const DEFAULTS: Required<Pick<LintOptions, "maxLineLength">> = {
  maxLineLength: 256,
};

/** Intrinsics that are non-portable / deprecated in ISO M or our notes. */
export const DEPRECATED_INTRINSICS: Record<string, string> = {
  NEXT: "Use `$ORDER`. `$NEXT` is obsolete (MDC MUMPS 1995).",
  ZNEXT: "Use `$ORDER`. `$ZNEXT` is obsolete.",
  V: "Use `$VIEW` only where the M implementation documents it — not portable.",
  VIEW: "`$VIEW` is implementation-specific; prefer `$GET`/`$DATA` for portable code.",
  Z: "A bare `$Z` is not an intrinsic; name a concrete `$Zxxx`.",
};

function resolveIntrinsicName(raw: string): string | null {
  if (raw.startsWith("$$")) return null;
  const name = raw.slice(1).toUpperCase();
  if (INTRINSICS[name]) return name;
  if (INTR_ABBR_PUBLIC[name]) return INTR_ABBR_PUBLIC[name];
  return null;
}

/**
 * Linter-only diagnostics.  `text` is the document; `tokens` may be
 * passed in to avoid re-lexing.
 */
export function lintOnlyDiagnostics(
  text: string,
  opts: LintOptions = {},
  tokens?: Token[],
): Diagnostic[] {
  const maxLine = opts.maxLineLength ?? DEFAULTS.maxLineLength;
  const toks = tokens ?? tokenize(text);
  const out: Diagnostic[] = [];
  const push = (d: Diagnostic) => {
    const sev = opts.severity?.[d.code];
    if (sev === "off") return;
    out.push(sev ? { ...d, severity: sev } : d);
  };

  // line starts (offset of each line)
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  const offsetToLine = (off: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  for (const t of toks) {
    // m/deprecated-intrinsic
    if (t.kind === "intrinsic" && !t.text.startsWith("$$")) {
      const raw = t.text.slice(1).toUpperCase();
      const resolved = resolveIntrinsicName(t.text) ?? raw;
      const why = DEPRECATED_INTRINSICS[resolved] ?? DEPRECATED_INTRINSICS[raw];
      if (why) {
        push({
          range: t.range,
          message: `\`${t.text}\` — ${why}`,
          severity: "warning",
          code: "m/deprecated-intrinsic",
        });
      }
    }

    // m/ncopy-compare — relational op where the operands look like the
    // rsm#11 bug class: a quoted numeric string compared to a number or
    // another quoted numeric string (`"007"=7`, `"7.0"="7"`).
    if (t.kind === "operator" && ["=", "<", ">", "<=", ">=", "'=", "'<", "'>"].includes(t.text)) {
      const line = offsetToLine(t.range.start);
      const before = text.slice(lineStarts[line], t.range.start);
      const after = text.slice(t.range.end, lineStarts[line + 1] ?? text.length);
      // quoted numeric string: "007" / "7.0" / "1E2"
      const hasQuotedNum = (s: string) => /"[+-]?[0-9]+(\.[0-9]*)?([eE][+-]?[0-9]+)?"/.test(s);
      const hasBareNum = (s: string) => /(^|[^A-Za-z0-9_"'])[+-]?[0-9]/.test(s);
      const leftNum = hasQuotedNum(before);
      const rightNum = hasQuotedNum(after) || hasBareNum(after);
      if (leftNum && rightNum) {
        push({
          range: t.range,
          message: `Relational operator involving a quoted numeric string — comparison is numeric iff **both** sides are numeric strings (ISO 11756 §8.3, rsm#11). Verify this is intended.`,
          severity: "warning",
          code: "m/ncopy-compare",
        });
      }
    }
  }

  // m/empty-subscript-order — $ORDER / $QUERY with a bare name or ""
  for (const t of toks) {
    if (t.kind !== "intrinsic") continue;
    const resolved = resolveIntrinsicName(t.text);
    if (resolved !== "ORDER" && resolved !== "QUERY") continue;
    // look at the next few non-ws tokens for `("`
    let i = toks.indexOf(t) + 1;
    while (i < toks.length && toks[i].kind === "whitespace") i++;
    if (toks[i]?.text !== "(") continue;
    i++;
    while (i < toks.length && toks[i].kind === "whitespace") i++;
    // empty string first arg, or the ref's last subscript is ""
    const arg = toks[i];
    if (arg && arg.kind === "string" && arg.text === '""') {
      push({
        range: t.range,
        message: `\`${t.text}\` on an empty subscript — this is the before-first / after-last sentinel (rsm#14). Ensure that is intended.`,
        severity: "information",
        code: "m/empty-subscript-order",
      });
    }
  }

  // m/long-line + m/trailing-whitespace (per line)
  {
    let off = 0;
    for (let li = 0; li < lineStarts.length; li++) {
      const start = lineStarts[li];
      const end = li + 1 < lineStarts.length ? lineStarts[li + 1] - 1 : text.length;
      const lineText = text.slice(start, end);
      if (lineText.length > maxLine) {
        push({
          range: { start: start + maxLine, end: Math.min(end, start + maxLine + 8) },
          message: `Line is ${lineText.length} characters (max ${maxLine}).`,
          severity: "information",
          code: "m/long-line",
        });
      }
      const tw = lineText.match(/[ \t]+$/);
      if (tw) {
        const twStart = start + lineText.length - tw[0].length;
        push({
          range: { start: twStart, end: start + lineText.length },
          message: "Trailing whitespace.",
          severity: "information",
          code: "m/trailing-whitespace",
        });
      }
      off = end;
    }
    void off;
  }

  // m/unknown-command — ident at command position that is not a command
  // (analyse() already flags unknown intrinsics and invalid routines)
  {
    // walk each line: skip label, then first ident must be a command
    const COMMANDS_LOCAL = new Set([
      "BREAK", "B", "CLOSE", "C", "DO", "D", "ELSE", "E", "FOR", "F",
      "GOTO", "G", "HALT", "H", "HANG", "H", "IF", "I", "JOB", "J",
      "KILL", "K", "LOCK", "L", "MERGE", "M", "NEW", "N", "OPEN", "O",
      "QUIT", "Q", "READ", "R", "SET", "S", "USE", "U", "VIEW", "V",
      "WRITE", "W", "XECUTE", "X",
    ]);
    let i = 0;
    while (i < toks.length) {
      // find line start
      while (i < toks.length && toks[i].kind === "whitespace") {
        if (toks[i].text.includes("\n")) break;
        i++;
      }
      if (i >= toks.length) break;
      // skip to first non-ws on the line
      const lineToks: Token[] = [];
      while (i < toks.length) {
        const t = toks[i];
        if (t.kind === "whitespace" && t.text.includes("\n")) break;
        if (t.kind !== "whitespace") lineToks.push(t);
        i++;
      }
      i++; // consume the newline
      if (!lineToks.length) continue;
      let idx = 0;
      // label?
      if (lineToks[0].kind === "ident") {
        const second = lineToks[1];
        const isLabel =
          (second && second.kind === "ident" && COMMANDS_LOCAL.has(second.text.toUpperCase())) ||
          (second && second.kind === "punct" && second.text === "(") ||
          !second;
        if (isLabel && !COMMANDS_LOCAL.has(lineToks[0].text.toUpperCase())) idx = 1;
        else if (isLabel && COMMANDS_LOCAL.has(lineToks[0].text.toUpperCase()) && second && second.kind === "ident") idx = 1;
      }
      const cmd = lineToks[idx];
      if (cmd && cmd.kind === "ident" && !COMMANDS_LOCAL.has(cmd.text.toUpperCase())) {
        push({
          range: cmd.range,
          message: `Unknown command \`${cmd.text}\`.`,
          severity: "warning",
          code: "m/unknown-command",
        });
      }
    }
  }

  return out;
}

/** All lint codes, for `--help` and tests. */
export const LINT_CODES = [
  "m/unbalanced-else",
  "m/quit-arg-context",
  "m/unknown-intrinsic",
  "m/empty-postcond",
  "m/invalid-routine",
  "m/unknown-command",
  "m/deprecated-intrinsic",
  "m/ncopy-compare",
  "m/empty-subscript-order",
  "m/long-line",
  "m/trailing-whitespace",
] as const;

/** Informational codes (severity-split from error/warning lints). */
export const INFO_CODES = [
  "m/postcond",
  "m/for-args",
] as const;
