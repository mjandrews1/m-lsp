/**
 * DO / FOR block context (m-lsp#1).
 *
 * M dotted-line blocks: a line starting with N dots lives at depth N.
 * An argless `DO` / `DO:pc` opens a block whose dotted body is at `openDepth+1`.
 * Every `FOR` (argless or `F var=…`) scopes the **rest of that line** as its
 * body — `QUIT expr` is legal there (ISO 8.1.2) even without dots.
 */
import type { Token } from "../../core/src/index";

export type BlockKind = "DO" | "FOR";

export interface BlockFrame {
  kind: BlockKind;
  /** dot depth of the opener line */
  openDepth: number;
  /** depth that dotted body lines must match (`openDepth + 1`), or same line */
  bodyDepth: number;
  /** dotted: persists across lines; inline: FOR body on the opener line only */
  scope: "dotted" | "inline";
  /** offset of the opener command token */
  openOffset: number;
}

export interface LineInfo {
  index: number;
  start: number;
  end: number;
  /** leading `.` count (block nesting depth) */
  depth: number;
  tokens: Token[];
}

/** Leading dot-count at `lineStart` (M block depth). */
export function leadingDots(text: string, lineStart: number): number {
  let n = 0;
  while (lineStart + n < text.length && text[lineStart + n] === ".") {
    const nxt = text[lineStart + n + 1];
    if (nxt !== undefined && /[0-9]/.test(nxt)) return n;
    n++;
  }
  return n;
}

/** Split token stream into lines (non-ws tokens retained). */
export function splitLines(text: string, tokens: Token[]): LineInfo[] {
  const lines: LineInfo[] = [];
  let cur: Token[] = [];
  let lineStart = 0;
  let index = 0;
  for (const t of tokens) {
    if (t.kind === "whitespace" && t.text.includes("\n")) {
      lines.push({
        index: index++,
        start: lineStart,
        end: t.range.start,
        depth: leadingDots(text, lineStart),
        tokens: cur,
      });
      cur = [];
      lineStart = t.range.end;
      continue;
    }
    if (t.kind !== "whitespace") cur.push(t);
  }
  lines.push({
    index: index++,
    start: lineStart,
    end: text.length,
    depth: leadingDots(text, lineStart),
    tokens: cur,
  });
  return lines;
}

/** Full command name from a known command word or abbreviation. */
export function fullCommand(text: string): string | null {
  const up = text.toUpperCase();
  const known = [
    "BREAK", "CLOSE", "DO", "ELSE", "FOR", "GOTO", "HALT", "HANG", "IF",
    "JOB", "KILL", "LOCK", "MERGE", "NEW", "OPEN", "QUIT", "READ", "SET",
    "USE", "VIEW", "WRITE", "XECUTE",
  ];
  if (known.includes(up)) return up;
  const abbr: Record<string, string> = {
    B: "BREAK", C: "CLOSE", D: "DO", E: "ELSE", F: "FOR", G: "GOTO",
    H: "HALT", I: "IF", J: "JOB", K: "KILL", L: "LOCK", M: "MERGE",
    N: "NEW", O: "OPEN", Q: "QUIT", R: "READ", S: "SET", U: "USE",
    V: "VIEW", W: "WRITE", X: "XECUTE",
  };
  return abbr[up] ?? null;
}

function skipPostcond(toks: Token[], i: number): number {
  if (toks[i]?.kind === "punct" && toks[i].text === ":") {
    i++;
    while (
      i < toks.length &&
      toks[i].kind !== "comment" &&
      !(toks[i].kind === "ident" && fullCommand(toks[i].text))
    ) {
      i++;
    }
  }
  return i;
}

/**
 * Classify a DO/FOR command at `idx`.
 * Returns the frame to push, or null if this is a call / non-block form.
 */
export function classifyBlockOpener(
  cmd: string,
  toks: Token[],
  idx: number,
  lineDepth: number,
  openOffset: number,
): BlockFrame | null {
  if (cmd !== "DO" && cmd !== "FOR") return null;
  let i = skipPostcond(toks, idx + 1);
  const next = toks[i];
  const eol = !next || next.kind === "comment" ||
    (next.kind === "ident" && fullCommand(next.text));

  if (cmd === "FOR") {
    // FOR body is the rest of this line (inline scope).
    return {
      kind: "FOR",
      openDepth: lineDepth,
      bodyDepth: lineDepth,
      scope: "inline",
      openOffset,
    };
  }

  // DO
  if (eol) {
    // argless DO / DO:pc → dotted block (and rest of line is inside it)
    return {
      kind: "DO",
      openDepth: lineDepth,
      bodyDepth: lineDepth + 1,
      scope: "dotted",
      openOffset,
    };
  }
  // DO tag / $$fn / @(x) / (args) — a call, not a block
  return null;
}

/**
 * Walk lines and build the open-block stack at the start of each line,
 * plus frames opened on that line (for same-line QUIT-context).
 */
export function blockContext(lines: LineInfo[]): {
  stackAtLine: BlockFrame[][];
  framesOpenedOnLine: BlockFrame[][];
} {
  const stackAtLine: BlockFrame[][] = [];
  const framesOpenedOnLine: BlockFrame[][] = [];
  let dotted: BlockFrame[] = [];

  for (const line of lines) {
    while (dotted.length && dotted[dotted.length - 1].bodyDepth > line.depth) {
      dotted = dotted.slice(0, -1);
    }
    const opened: BlockFrame[] = [];
    for (let i = 0; i < line.tokens.length; i++) {
      const t = line.tokens[i];
      if (t.kind !== "ident") continue;
      const cmd = fullCommand(t.text);
      if (!cmd) continue;
      const frame = classifyBlockOpener(cmd, line.tokens, i, line.depth, t.range.start);
      if (!frame) continue;
      opened.push(frame);
      if (frame.scope === "dotted") dotted = [...dotted, frame];
    }
    stackAtLine.push(dotted.map((f) => ({ ...f })));
    framesOpenedOnLine.push(opened);
  }
  return { stackAtLine, framesOpenedOnLine };
}

/** True if `QUIT` with an argument is legal at this stack. */
export function quitArgAllowed(stack: BlockFrame[]): boolean {
  return stack.some((f) => f.kind === "DO" || f.kind === "FOR");
}

/**
 * ISO 8.1.2: `QUIT expr` is legal in an **extrinsic function** (anywhere in
 * its body, including inside DO/FOR) and also to exit a DO/FOR when that
 * form is used as a return.  The governing case for real code is the
 * extrinsic: a top-level label with formal args.
 *
 * Returns true when the current top-level label opened an extrinsic.
 */
export function labelOpensExtrinsic(toks: Token[]): boolean {
  if (!toks.length) return false;
  const first = toks[0];
  if (first.kind !== "ident") return false;
  if (fullCommand(first.text)) return false;
  const second = toks[1];
  return second?.kind === "punct" && second.text === "(";
}

/**
 * For each line, whether we are inside an extrinsic (label with formal
 * parameters at depth 0 since the last top-level label).
 */
export function extrinsicAtLine(lines: LineInfo[]): boolean[] {
  const out: boolean[] = [];
  let inExtrinsic = false;
  for (const line of lines) {
    if (line.depth === 0 && labelOpensExtrinsic(line.tokens)) inExtrinsic = true;
    else if (line.depth === 0 && line.tokens.length &&
      line.tokens[0].kind === "ident" &&
      !fullCommand(line.tokens[0].text) &&
      !(line.tokens[1]?.kind === "punct" && line.tokens[1].text === "(")) {
      // new label without formals — not an extrinsic entry
      inExtrinsic = false;
    }
    out.push(inExtrinsic);
  }
  return out;
}

