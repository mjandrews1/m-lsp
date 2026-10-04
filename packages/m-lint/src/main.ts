/**
 * m-lint — CLI linter for M / MUMPS / Mlang (rsm#28).
 *
 * Rules come from `@m-lsp/m-core` (shared with the LSP).  This file is
 * only the CLI: file walking, config, formatting, exit codes.
 *
 * Exit codes:
 *   0  clean (no diagnostics at or above --fail-on)
 *   1  diagnostics at or above --fail-on
 *   2  usage / IO error
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, resolve, relative, extname } from "path";
import { analyse, lintOnlyDiagnostics, LINT_CODES, type LintOptions } from "../../m-core/src/index";
import type { Diagnostic, Severity } from "../../core/src/index";

// ---------------------------------------------------------------- config

interface LintConfig {
  failOn: "error" | "warning" | "information";
  maxLineLength: number;
  severity: Record<string, Severity | "off">;
  ignore: string[];
}

const DEFAULT_CONFIG: LintConfig = {
  failOn: "error",
  maxLineLength: 256,
  severity: {},
  ignore: ["node_modules", ".git", "dist"],
};

function loadConfig(cwd: string, explicit?: string): LintConfig {
  const path = explicit ?? join(cwd, ".mlintrc.json");
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      failOn: raw.failOn ?? DEFAULT_CONFIG.failOn,
      maxLineLength: raw.maxLineLength ?? DEFAULT_CONFIG.maxLineLength,
      severity: raw.severity ?? {},
      ignore: raw.ignore ?? DEFAULT_CONFIG.ignore,
    };
  } catch (e) {
    console.error(`m-lint: cannot read ${path}: ${e}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- walking

const M_EXT = new Set([".m", ".M", ".mumps"]);

function walkMFiles(root: string, ignore: string[]): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (ignore.includes(e)) continue;
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(p);
      else if (M_EXT.has(extname(e))) out.push(p);
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------- lint

interface Finding {
  file: string;
  diag: Diagnostic;
}

function lintFile(path: string, text: string, cfg: LintConfig): Finding[] {
  const opts: LintOptions = {
    maxLineLength: cfg.maxLineLength,
    severity: cfg.severity,
  };
  const base = analyse(path, text).diagnostics;
  const extra = lintOnlyDiagnostics(text, opts);
  const all = [...base, ...extra];
  return all.map((diag) => ({ file: path, diag }));
}

// ---------------------------------------------------------------- format

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      last = i;
    }
  }
  return { line, col: offset - last };
}

function formatStylish(findings: Finding[], texts: Map<string, string>): string {
  const lines: string[] = [];
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }
  for (const [file, list] of [...byFile.entries()].sort()) {
    lines.push(file);
    for (const f of list.sort((a, b) => a.diag.range.start - b.diag.range.start)) {
      const text = texts.get(f.file) ?? "";
      const { line, col } = offsetToLineCol(text, f.diag.range.start);
      const sev = f.diag.severity.padEnd(11);
      lines.push(`  ${String(line).padStart(4)}:${String(col).padEnd(3)}  ${sev} ${f.diag.message}  ${f.diag.code}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatJson(findings: Finding[], texts: Map<string, string>): string {
  return JSON.stringify(
    findings.map((f) => {
      const text = texts.get(f.file) ?? "";
      const { line, col } = offsetToLineCol(text, f.diag.range.start);
      return {
        file: f.file,
        line,
        column: col,
        endLine: offsetToLineCol(text, f.diag.range.end).line,
        endColumn: offsetToLineCol(text, f.diag.range.end).col,
        severity: f.diag.severity,
        code: f.diag.code,
        message: f.diag.message,
      };
    }),
    null,
    2,
  );
}

function formatGithub(findings: Finding[], texts: Map<string, string>): string {
  const lines: string[] = [];
  for (const f of findings) {
    const text = texts.get(f.file) ?? "";
    const { line, col } = offsetToLineCol(text, f.diag.range.start);
    const cmd = f.diag.severity === "error" ? "error" : f.diag.severity === "warning" ? "warning" : "notice";
    const msg = f.diag.message.replace(/\n/g, " ");
    lines.push(`::${cmd} file=${f.file},line=${line},col=${col},title=${f.diag.code}::${msg}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- cli

function usage(): never {
  console.log(`m-lint — linter for M / MUMPS / Mlang (rsm#28)

Usage:
  m-lint FILE.m [FILE.m ...]
  m-lint --dir PATH
  m-lint [options] [paths...]

Options:
  --dir PATH          lint every .m file under PATH
  --format FMT        stylish | json | github   (default: stylish)
  --config PATH       config file (default: .mlintrc.json in cwd)
  --fail-on LEVEL     error | warning | information  (default: error)
  --max-warnings N    exit 1 if more than N warnings
  --max-line-length N override line-length rule
  --list-codes        print rule codes and exit
  --help              this help

Exit codes:
  0  clean
  1  diagnostics at or above --fail-on (or --max-warnings exceeded)
  2  usage / IO error

Rule codes:
${LINT_CODES.map((c) => "  " + c).join("\n")}
`);
  process.exit(0);
}

function main(argv: string[]): void {
  const files: string[] = [];
  let dir: string | null = null;
  let format: "stylish" | "json" | "github" = "stylish";
  let configPath: string | undefined;
  let failOn: LintConfig["failOn"] | null = null;
  let maxWarnings: number | null = null;
  let maxLine: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage();
    else if (a === "--list-codes") {
      for (const c of LINT_CODES) console.log(c);
      process.exit(0);
    } else if (a === "--dir") {
      dir = argv[++i];
      if (!dir) {
        console.error("m-lint: --dir needs a path");
        process.exit(2);
      }
    } else if (a === "--format") {
      const f = argv[++i];
      if (f !== "stylish" && f !== "json" && f !== "github") {
        console.error("m-lint: --format must be stylish|json|github");
        process.exit(2);
      }
      format = f;
    } else if (a === "--config") {
      configPath = argv[++i];
    } else if (a === "--fail-on") {
      const f = argv[++i];
      if (f !== "error" && f !== "warning" && f !== "information") {
        console.error("m-lint: --fail-on must be error|warning|information");
        process.exit(2);
      }
      failOn = f;
    } else if (a === "--max-warnings") {
      maxWarnings = Number(argv[++i]);
    } else if (a === "--max-line-length") {
      maxLine = Number(argv[++i]);
    } else if (a.startsWith("-")) {
      console.error(`m-lint: unknown option ${a}`);
      process.exit(2);
    } else {
      files.push(a);
    }
  }

  const cwd = process.cwd();
  const cfg = loadConfig(cwd, configPath);
  if (failOn) cfg.failOn = failOn;
  if (maxLine != null) cfg.maxLineLength = maxLine;

  let targets: string[] = [];
  if (dir) {
    targets = walkMFiles(resolve(dir), cfg.ignore);
    if (!targets.length) {
      console.error(`m-lint: no .m files under ${dir}`);
      process.exit(2);
    }
  }
  for (const f of files) {
    const p = resolve(f);
    if (!existsSync(p)) {
      console.error(`m-lint: no such file ${f}`);
      process.exit(2);
    }
    targets.push(p);
  }
  if (!targets.length) {
    console.error("m-lint: no input files (try --dir or pass FILE.m)");
    process.exit(2);
  }

  const texts = new Map<string, string>();
  const findings: Finding[] = [];
  for (const t of targets) {
    let text: string;
    try {
      text = readFileSync(t, "utf8");
    } catch (e) {
      console.error(`m-lint: cannot read ${t}: ${e}`);
      process.exit(2);
    }
    texts.set(t, text);
    findings.push(...lintFile(t, text, cfg));
  }

  // apply fail-on and max-warnings
  const rank: Record<string, number> = { information: 0, warning: 1, error: 2 };
  const threshold = rank[cfg.failOn];
  const blocking = findings.filter((f) => rank[f.diag.severity] >= threshold);
  const warnings = findings.filter((f) => f.diag.severity === "warning");

  if (format === "json") console.log(formatJson(findings, texts));
  else if (format === "github") {
    const g = formatGithub(findings, texts);
    if (g) console.log(g);
  } else {
    const s = formatStylish(findings, texts);
    if (s.trim()) console.log(s);
    const nErr = findings.filter((f) => f.diag.severity === "error").length;
    const nWarn = warnings.length;
    const nInfo = findings.filter((f) => f.diag.severity === "information").length;
    const summary = `${targets.length} file(s) — ${nErr} error(s), ${nWarn} warning(s), ${nInfo} note(s)`;
    if (format === "stylish") console.log(summary);
  }

  let exit = 0;
  if (blocking.length > 0) exit = 1;
  if (maxWarnings != null && warnings.length > maxWarnings) exit = 1;
  process.exit(exit);
}

main(process.argv.slice(2));
