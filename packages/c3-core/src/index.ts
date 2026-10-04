/**
 * C3 language core — tokenizer, symbols, diagnostics, hover, goto.
 *
 * Traps grounded in c3m/c3fst history (rsm#27 §C3 surface):
 *   - `class` is NOT a keyword (use `struct`)
 *   - cross-module type needs an explicit `import`
 *   - param names may not be all-caps nor start capital
 *   - `extern fn` C strings must be `ZString`, not `char*`
 *   - array parameters are silently passed BY VALUE
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

export const C3_KEYWORDS = new Set([
  "alias", "asm", "assert", "attribute", "bitstruct", "break", "case",
  "catch", "const", "continue", "default", "defer", "do", "else", "enum",
  "export", "extern", "false", "fault", "fn", "foreach", "if", "import",
  "inline", "macro", "module", "nextcase", "null", "operator", "out",
  "private", "public", "return", "rstring", "struct", "switch", "tlocal",
  "true", "try", "typedef", "union", "var", "void", "while",
]);

export const C3_TYPES = new Set([
  "bool", "char", "ichar", "double", "float", "int", "isz", "long",
  "short", "uint", "ulong", "ushort", "usz", "void", "ZString", "String",
  "any", "anyfault", "typeid", "irexpr",
]);

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const push = (kind: Token["kind"], start: number, end: number) => {
    out.push({ kind, text: text.slice(start, end), range: { start, end } });
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const s = i;
      while (i < text.length && text[i] !== "\n") i++;
      push("comment", s, i);
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const s = i;
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i = Math.min(i + 2, text.length);
      push("comment", s, i);
      continue;
    }
    if (/\s/.test(c)) {
      const s = i;
      while (i < text.length && /\s/.test(text[i])) i++;
      push("whitespace", s, i);
      continue;
    }
    if (c === '"') {
      const s = i;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      i++;
      push("string", s, i);
      continue;
    }
    if (c === "'") {
      const s = i;
      i++;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === "\\") i++;
        i++;
      }
      i++;
      push("string", s, i);
      continue;
    }
    if (/[0-9]/.test(c)) {
      const s = i;
      while (i < text.length && /[0-9a-fA-FxX_]/.test(text[i])) i++;
      push("number", s, i);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const s = i;
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
      const word = text.slice(s, i);
      const kind: Token["kind"] = C3_KEYWORDS.has(word)
        ? "keyword"
        : C3_TYPES.has(word)
          ? "type"
          : "ident";
      push(kind, s, i);
      continue;
    }
    const ops = ["=>", "...", "::", "->", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", ".."];
    let matched = "";
    for (const o of ops) if (text.startsWith(o, i)) { matched = o; break; }
    if (matched) { push("operator", i, i + matched.length); i += matched.length; continue; }
    if ("{}[]();,.:?~!%^&*-+=|<>/".includes(c)) {
      push("punct", i, i + 1);
      i++;
      continue;
    }
    push("unknown", i, i + 1);
    i++;
  }
  return out;
}

export function analyse(uri: string, text: string): Analysis {
  const tokens = tokenize(text);
  const diagnostics: Diagnostic[] = [];
  const symbols: SymbolInfo[] = [];
  const references: Reference[] = [];
  const imports = new Set<string>();

  /** next non-whitespace index at or after i */
  const nw = (i: number) => {
    while (i < tokens.length && tokens[i].kind === "whitespace") i++;
    return i;
  };

  // collect imports and module
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "keyword" && t.text === "import") {
      const j = nw(i + 1);
      const next = tokens[j];
      if (next && (next.kind === "ident" || next.kind === "type")) {
        imports.add(next.text);
        const k = nw(j + 1);
        if (tokens[k]?.text === "::") {
          imports.add(next.text + "::" + (tokens[nw(k + 1)]?.text ?? ""));
        }
      }
    }
  }

  const pushDiag = (d: Diagnostic) => diagnostics.push(d);

  // declarations and traps
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // class used instead of struct
    if (t.kind === "ident" && t.text === "class") {
      pushDiag({
        range: t.range,
        message: "`class` is **not** a C3 keyword — use `struct`.",
        severity: "error",
        code: "c3/class-not-keyword",
      });
    }
    // extern fn  with char*  where ZString is required
    if (t.kind === "keyword" && t.text === "extern") {
      // look ahead for fn ... ( ... char*  ... )
      for (let j = i; j < Math.min(i + 80, tokens.length); j++) {
        const u = tokens[j];
        if (u.kind === "keyword" && u.text === "fn") {
          // signature until ')'
          for (let k = j; k < Math.min(j + 80, tokens.length); k++) {
            const v = tokens[k];
            if (v.kind === "type" && v.text === "char" && tokens[k + 1]?.text === "*") {
              pushDiag({
                range: { start: v.range.start, end: tokens[k + 1].range.end },
                message: "`extern fn` C string parameters must be **`ZString`**, not `char*` — the implicit cast is rejected; explicit `(ZString)` is required.",
                severity: "error",
                code: "c3/extern-char-ptr",
              });
            }
            if (v.text === ")" && k > j) break;
          }
          break;
        }
        if (t.kind === "keyword" && t.text === "import") break;
      }
    }
    // fn declarations
    if (t.kind === "keyword" && t.text === "fn") {
      const ret = tokens[i + 1];
      const name = tokens[i + 2] ?? tokens[i + 1];
      // crude: fn Type name (  or  fn name (
      let nameTok: Token | undefined;
      let parenIdx = -1;
      for (let j = i + 1; j < Math.min(i + 6, tokens.length); j++) {
        if (tokens[j].text === "(") { parenIdx = j; break; }
        if (tokens[j].kind === "ident" || tokens[j].kind === "type" || tokens[j].kind === "keyword") {
          nameTok = tokens[j];
        }
      }
      if (nameTok) {
        symbols.push({ name: nameTok.text, kind: "fn", range: nameTok.range });
        references.push({ name: nameTok.text, kind: "fn", range: nameTok.range, isDefinition: true });
      }
      // parameters
      if (parenIdx > 0) {
        // walk params:  type name , type name   (skip whitespace)
        let j = nw(parenIdx + 1);
        while (j < tokens.length && tokens[j].text !== ")") {
          const typeStart = j;
          // a type is: (type|keyword|ident) with * / [dims] suffixes.
          // Stop before the parameter name (the first bare ident after
          // the type head + suffixes).
          let sawHead = false;
          while (j < tokens.length) {
            const v = tokens[j];
            if (v.kind === "whitespace") { j++; continue; }
            if (!sawHead && (v.kind === "type" || v.kind === "keyword" || v.kind === "ident")) {
              sawHead = true;
              j++;
              continue;
            }
            if (sawHead && (v.text === "*" || v.text === "[" || v.text === "]" ||
              v.kind === "number" || v.kind === "keyword" || v.kind === "type")) {
              j++;
              continue;
            }
            break;
          }
          const typeEnd = j;
          const nameIdx = nw(j);
          const nameTok = tokens[nameIdx];
          if (nameTok && (nameTok.kind === "ident" || nameTok.kind === "type") && nameIdx >= typeEnd) {
            const nm = nameTok.text;
            if (/^[A-Z][A-Z0-9_]*$/.test(nm) || /^[A-Z]/.test(nm)) {
              pushDiag({
                range: nameTok.range,
                message: `Parameter name \`${nm}\` must not be all-caps and must not start with a capital (C3 naming rule).`,
                severity: "error",
                code: "c3/param-name",
              });
            }
            symbols.push({ name: nm, kind: "param", range: nameTok.range });
            const typeText = text.slice(tokens[typeStart].range.start, tokens[typeEnd - 1].range.end);
            if (typeText.includes("[")) {
              pushDiag({
                range: { start: tokens[typeStart].range.start, end: nameTok.range.end },
                message: `Array parameter \`${typeText} ${nm}\` is passed **by value** (silent copy) — prefer a pointer and \`&\`.`,
                severity: "warning",
                code: "c3/array-param",
              });
            }
            j = nw(nameIdx + 1);
          } else {
            j = typeEnd > j ? typeEnd : j + 1;
          }
          j = nw(j);
          if (tokens[j]?.text === ",") j = nw(j + 1);
        }
      }
      i = parenIdx > 0 ? parenIdx : i;
      continue;
    }
    // struct / enum / distinct type names
    if (t.kind === "keyword" && (t.text === "struct" || t.text === "enum" || t.text === "union")) {
      const name = tokens[i + 1];
      if (name && (name.kind === "ident" || name.kind === "type")) {
        symbols.push({ name: name.text, kind: "type", range: name.range });
        references.push({ name: name.text, kind: "type", range: name.range, isDefinition: true });
      }
      continue;
    }
    if (t.kind === "keyword" && t.text === "import") {
      const next = tokens[i + 1];
      if (next) references.push({ name: next.text, kind: "routine", range: next.range, isDefinition: true });
      continue;
    }
  }

  // cross-module type use without import: look for `mod::type`
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.text === "::" && t.kind === "operator" && i > 0 && i + 1 < tokens.length) {
      const mod = tokens[i - 1];
      const name = tokens[i + 1];
      if (mod && name && (mod.kind === "ident" || mod.kind === "type")) {
        // if this is not an import declaration line
        let isImport = false;
        for (let j = i; j >= 0 && i - j < 8; j--) {
          if (tokens[j].kind === "keyword" && tokens[j].text === "import") { isImport = true; break; }
          if (tokens[j].text === ";") break;
        }
        if (!isImport && !imports.has(mod.text) && !imports.has(mod.text + "::" + name.text)) {
          if (mod.text !== "std") {
            pushDiag({
              range: { start: mod.range.start, end: name.range.end },
              message: `Cross-module type \`${mod.text}::${name.text}\` needs an explicit \`import ${mod.text};\` — a link line is not enough.`,
              severity: "error",
              code: "c3/missing-import",
            });
          }
        }
      }
    }
  }

  const hover = (offset: number): HoverInfo | null => {
    for (const t of tokens) {
      if (offset < t.range.start || offset >= t.range.end) continue;
      if (t.kind === "type" && t.text === "ZString") {
        return {
          value: "**`ZString`** — C-compatible NUL-terminated string.\n\nRequired for `extern fn` C string parameters; `char*` is rejected (explicit `(ZString)` cast).",
          range: t.range,
        };
      }
      if (t.kind === "keyword" && t.text === "extern") {
        return {
          value: "**`extern fn`** — foreign function.\n\nC string parameters must be **`ZString`**, not `char*`. Hover the signature.",
          range: t.range,
        };
      }
      if (t.kind === "keyword" && t.text === "struct") {
        return {
          value: "**`struct`** — aggregate type.\n\n`class` is **not** a C3 keyword (c3m/c3fst trap).",
          range: t.range,
        };
      }
      if (t.kind === "ident" || t.kind === "type") {
        const s = symbols.find((s) => s.name === t.text && s.range.start === t.range.start);
        if (s) {
          return {
            value: `**${s.kind}** \`${s.name}\`${s.container ? ` in \`${s.container}\`` : ""}`,
            range: t.range,
          };
        }
        // parameter naming rule reminder
        if (/^[A-Z]/.test(t.text)) {
          return {
            value: `\`${t.text}\` — note C3 naming: parameter names may not be all-caps nor start capital; type names start uppercase.`,
            range: t.range,
          };
        }
      }
    }
    return null;
  };

  const definitions = (offset: number): Location[] => {
    for (const t of tokens) {
      if (offset < t.range.start || offset >= t.range.end) continue;
      if (t.kind !== "ident" && t.kind !== "type") continue;
      return symbols
        .filter((s) => s.name === t.text)
        .map((s) => ({ uri, range: s.range }));
    }
    return [];
  };

  return { tokens, symbols, references, diagnostics, hover, definitions };
}

export const c3Plugin: LanguagePlugin = {
  id: "c3",
  extensions: [".c3", ".c3i", ".c3t"],
  analyse,
};

export { c3LintOnlyDiagnostics, C3_LINT_CODES } from "./lint";
export type { C3LintOptions } from "./lint";
