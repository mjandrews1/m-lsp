/**
 * C3 lint-only rules (rsm#29).  Companions to `analyse()` in index.ts.
 *
 * Shared rules (`c3/class-not-keyword`, `c3/param-name`,
 * `c3/extern-char-ptr`, `c3/missing-import`, `c3/array-param`) come
 * from `analyse()` so the LSP and the CLI agree.  These extras are
 * CI-oriented and grounded in the c3m/c3fst bug history.
 */
import type { Diagnostic, Token } from "../../core/src/index";
import { tokenize } from "./index";

export interface C3LintOptions {
  /** max function body lines for `c3/long-function`; default 60 */
  maxFunctionLines?: number;
  /** severity overrides by rule code */
  severity?: Record<string, "error" | "warning" | "information" | "off">;
}

/** Words that mean "this is a supported keyword" vs compiler gaps. */
const UNSUPPORTED = new Map<string, string>([
  ["sizeof", "c3/sizeof-trap"],
  ["fault", "c3/fault-try"],
  ["try", "c3/fault-try"],
]);

function nw(toks: Token[], i: number): number {
  while (i < toks.length && toks[i].kind === "whitespace") i++;
  return i;
}

function findLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function offsetToLine(starts: number[], off: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Linter-only diagnostics for a C3 source.
 */
export function c3LintOnlyDiagnostics(
  text: string,
  opts: C3LintOptions = {},
  tokens?: Token[],
): Diagnostic[] {
  const maxFn = opts.maxFunctionLines ?? 60;
  const toks = tokens ?? tokenize(text);
  const out: Diagnostic[] = [];
  const push = (d: Diagnostic) => {
    const sev = opts.severity?.[d.code];
    if (sev === "off") return;
    out.push(sev ? { ...d, severity: sev } : d);
  };
  const lineStarts = findLineStarts(text);

  // --- c3/sizeof-trap, c3/fault-try, c3/static-local -------------------
  for (const t of toks) {
    if (t.kind !== "ident" && t.kind !== "keyword") continue;
    const code = UNSUPPORTED.get(t.text);
    if (code) {
      push({
        range: t.range,
        message:
          code === "c3/sizeof-trap"
            ? "`sizeof` is **not available** in this C3 (known compiler gap) — copy ABI sizes from the header."
            : `\`${t.text}\` is **not available** in this C3 (no \`fault\`/\`try\`) — handle errors with return codes.`,
        severity: "error",
        code,
      });
    }
    if (t.text === "static") {
      // `static` locals are unsupported
      const j = nw(toks, toks.indexOf(t) + 1);
      const next = toks[j];
      if (next && (next.kind === "type" || next.kind === "keyword" || next.kind === "ident")) {
        // heuristic: `static` before a type/ident inside a function body
        push({
          range: t.range,
          message: "`static` locals are not supported in this C3 — use a module-level variable or pass state explicitly.",
          severity: "error",
          code: "c3/static-local",
        });
      }
    }
  }

  // --- c3/abi-magic + c3/array-out-param + c3/long-function ------------
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];

    // detect `extern fn` and walk its signature
    if (t.kind === "keyword" && t.text === "extern") {
      const fnIdx = nw(toks, i + 1);
      if (toks[fnIdx]?.kind === "keyword" && toks[fnIdx].text === "fn") {
        // signature is until the first `;` or `{`
        let j = fnIdx + 1;
        let depth = 0;
        let sigEnd = j;
        for (; j < toks.length; j++) {
          const u = toks[j];
          if (u.text === "(") depth++;
          if (u.text === ")") depth--;
          if (depth === 0 && (u.text === ";" || u.text === "{")) {
            sigEnd = j;
            break;
          }
        }
        // ABI magic: bare numeric literals inside the extern signature
        for (let k = fnIdx; k < sigEnd; k++) {
          const u = toks[k];
          if (u.kind === "number") {
            push({
              range: u.range,
              message: `ABI constant \`${u.text}\` in an \`extern fn\` signature — copy ABI constants from the header, never guess.`,
              severity: "warning",
              code: "c3/abi-magic",
            });
          }
        }
      }
    }

    // fn body length (non-extern)
    if (t.kind === "keyword" && t.text === "fn") {
      // find the opening brace of the body
      let j = i + 1;
      let sawExtern = false;
      for (let k = Math.max(0, i - 4); k < i; k++) {
        if (toks[k].kind === "keyword" && toks[k].text === "extern") sawExtern = true;
      }
      for (; j < toks.length; j++) {
        if (toks[j].text === "{") break;
        if (toks[j].text === ";") break;
      }
      if (!sawExtern && toks[j]?.text === "{") {
        // find matching close
        let depth = 0;
        let end = j;
        for (; end < toks.length; end++) {
          if (toks[end].text === "{") depth++;
          else if (toks[end].text === "}") {
            depth--;
            if (depth === 0) break;
          }
        }
        const startLine = offsetToLine(lineStarts, toks[j].range.start);
        const endLine = offsetToLine(lineStarts, toks[end]?.range.end ?? toks[j].range.end);
        const nLines = endLine - startLine + 1;
        if (nLines > maxFn) {
          // name: last ident before `(`
          let name = "function";
          for (let k = i + 1; k < j; k++) {
            if (toks[k].kind === "ident" || (toks[k].kind === "type" && toks[k + 1]?.text === "(")) {
              if (toks[k + 1]?.text === "(" || toks[k + 2]?.text === "(") name = toks[k].text;
            }
          }
          push({
            range: { start: toks[j].range.start, end: toks[j].range.end },
            message: `Function \`${name}\` is ${nLines} lines (max ${maxFn}) — the project standard is "a single sheet of paper" (~60 lines).`,
            severity: "warning",
            code: "c3/long-function",
          });
        }
      }
    }
    i++;
  }

  // --- c3/array-out-param ------------------------------------------------
  // `out Type[N] name` or `Type[N] name` written through — we flag any
  // parameter whose type contains `[` and which appears in an `out` slot.
  {
    let k = 0;
    while (k < toks.length) {
      const t = toks[k];
      if (t.kind === "keyword" && t.text === "fn") {
        // walk params
        let j = nw(toks, k + 1);
        // skip to '('
        while (j < toks.length && toks[j].text !== "(" && toks[j].text !== ";") j++;
        if (toks[j]?.text !== "(") { k++; continue; }
        j++;
        let isOut = false;
        while (j < toks.length && toks[j].text !== ")") {
          const u = toks[j];
          if (u.kind === "whitespace") { j++; continue; }
          if (u.kind === "keyword" && u.text === "out") {
            isOut = true;
            j++;
            continue;
          }
          if (u.text === ",") {
            isOut = false;
            j++;
            continue;
          }
          // type span: type head + * / [dims] suffixes, stop before the name
          const typeStart = j;
          let sawHead = false;
          while (j < toks.length) {
            const v = toks[j];
            if (v.kind === "whitespace") { j++; continue; }
            if (!sawHead && (v.kind === "type" || v.kind === "keyword" || v.kind === "ident")) {
              sawHead = true;
              j++;
              continue;
            }
            if (sawHead && (v.text === "*" || v.text === "[" || v.text === "]" ||
              v.kind === "number" || v.kind === "type" || (v.kind === "keyword" && v.text !== "out"))) {
              j++;
              continue;
            }
            break;
          }
          const typeEnd = j;
          const typeText = text.slice(
            toks[typeStart].range.start,
            toks[Math.max(typeStart, typeEnd - 1)].range.end,
          );
          let nameIdx = j;
          while (nameIdx < toks.length && toks[nameIdx].kind === "whitespace") nameIdx++;
          const nameTok = toks[nameIdx];
          if (typeText.includes("[") && nameTok && (nameTok.kind === "ident" || nameTok.kind === "type")) {
            if (isOut) {
              push({
                range: { start: toks[typeStart].range.start, end: nameTok.range.end },
                message: `Array parameter \`${typeText} ${nameTok.text}\` is copied by value — write-through needs an explicit pointer (\`${typeText.replace(/\[.*\]/, "")}*\`).`,
                severity: "warning",
                code: "c3/array-out-param",
              });
            }
          }
          j = nameTok ? nameIdx + 1 : typeEnd + 1;
        }
      }
      k++;
    }
  }

  // --- c3/dup-include ---------------------------------------------------
  {
    const seen = new Map<string, number>();
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.kind !== "keyword" || t.text !== "import") continue;
      const j = nw(toks, k + 1);
      const name = toks[j];
      if (!name) continue;
      let full = name.text;
      const k2 = nw(toks, j + 1);
      if (toks[k2]?.text === "::") {
        full = `${name.text}::${toks[nw(toks, k2 + 1)]?.text ?? ""}`;
      }
      const prev = seen.get(full);
      if (prev != null) {
        push({
          range: { start: t.range.start, end: name.range.end },
          message: `Duplicate \`import ${full};\` (first at offset ${prev}).`,
          severity: "information",
          code: "c3/dup-include",
        });
      } else {
        seen.set(full, t.range.start);
      }
    }
  }

  return out;
}

/** All lint codes, for `--help` and tests. */
export const C3_LINT_CODES = [
  // shared with the LSP (produced by analyse())
  "c3/class-not-keyword",
  "c3/param-name",
  "c3/extern-char-ptr",
  "c3/missing-import",
  "c3/array-param",
  // lint-only
  "c3/array-out-param",
  "c3/abi-magic",
  "c3/sizeof-trap",
  "c3/fault-try",
  "c3/static-local",
  "c3/long-function",
  "c3/dup-include",
] as const;
