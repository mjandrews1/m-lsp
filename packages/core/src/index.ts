/**
 * Shared language-core types.  The LSP host depends only on this file;
 * each language core implements `LanguagePlugin`.
 */

export type Severity = "error" | "warning" | "information";

export interface Range {
  /** UTF-16 code-unit offset into the document text */
  start: number;
  end: number;
}

export interface Token {
  kind:
    | "command"
    | "postcond"
    | "intrinsic"
    | "special"
    | "label"
    | "routine"
    | "global"
    | "local"
    | "number"
    | "string"
    | "operator"
    | "punct"
    | "comment"
    | "whitespace"
    | "keyword"
    | "type"
    | "ident"
    | "unknown";
  text: string;
  range: Range;
}

export interface SymbolInfo {
  name: string;
  kind: "label" | "global" | "local" | "routine" | "fn" | "type" | "var" | "param";
  range: Range;
  /** enclosing routine / module name, if any */
  container?: string;
}

export interface Reference {
  name: string;
  kind: SymbolInfo["kind"] | "unknown";
  range: Range;
  /** true if this use is a definition site */
  isDefinition: boolean;
}

export interface Diagnostic {
  range: Range;
  message: string;
  severity: Severity;
  /** short machine-readable id, e.g. "m/unbalanced-else" */
  code: string;
}

export interface HoverInfo {
  /** markdown body */
  value: string;
  range?: Range;
}

export interface Location {
  /** document uri (same doc is fine) */
  uri: string;
  range: Range;
}

export interface Analysis {
  tokens: Token[];
  symbols: SymbolInfo[];
  references: Reference[];
  diagnostics: Diagnostic[];
  hover(offset: number): HoverInfo | null;
  /**
   * Definitions at `offset`.  When `ws` is supplied the plugin may
   * resolve across files (`label^routine`, `$$fn`, `import`ed types);
   * without it the answer is same-document only.
   */
  definitions(offset: number, ws?: import("./workspace").WorkspaceIndex): Location[];
}

export interface LanguagePlugin {
  id: "m" | "c3";
  extensions: string[];
  analyse(uri: string, text: string): Analysis;
}

export { WorkspaceIndex } from "./workspace";
