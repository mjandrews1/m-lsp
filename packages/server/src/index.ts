/**
 * Shared LSP host — language-agnostic.
 *
 * Speaks LSP over stdio; dispatches to a `LanguagePlugin` by file
 * extension.  Adding a language is a new plugin, not a new server.
 */
import * as rpc from "vscode-languageserver/node";
import type { Analysis, LanguagePlugin } from "../../core/src/index";

export interface HostOptions {
  plugins: LanguagePlugin[];
  name: string;
  version: string;
}

interface DocState {
  uri: string;
  text: string;
  analysis: Analysis;
}

export function createHost(opts: HostOptions) {
  const byExt = new Map<string, LanguagePlugin>();
  for (const p of opts.plugins) {
    for (const e of p.extensions) byExt.set(e.toLowerCase(), p);
  }

  const connection = rpc.createConnection(rpc.ProposedFeatures.all);
  const docs = new Map<string, DocState>();

  function pluginFor(uri: string): LanguagePlugin | undefined {
    const dot = uri.lastIndexOf(".");
    if (dot < 0) return undefined;
    const ext = uri.slice(dot).toLowerCase();
    // strip query strings
    const clean = ext.split("?")[0];
    return byExt.get(clean);
  }

  function refresh(uri: string, text: string) {
    const p = pluginFor(uri);
    if (!p) return;
    const analysis = p.analyse(uri, text);
    docs.set(uri, { uri, text, analysis });
    connection.sendDiagnostics({
      uri,
      diagnostics: analysis.diagnostics.map((d) => ({
        range: offsetRangeToLsp(text, d.range.start, d.range.end),
        message: d.message,
        severity:
          d.severity === "error"
            ? rpc.DiagnosticSeverity.Error
            : d.severity === "warning"
              ? rpc.DiagnosticSeverity.Warning
              : rpc.DiagnosticSeverity.Information,
        code: d.code,
        source: opts.name,
      })),
    });
  }

  connection.onInitialize((_params) => ({
    capabilities: {
      textDocumentSync: rpc.TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
    },
  }));

  connection.onDidOpen((e) => {
    refresh(e.textDocument.uri, e.textDocument.text);
  });
  connection.onDidChangeContent((e) => {
    // full-text for v1 simplicity; Incremental can be layered later
    const st = docs.get(e.textDocument.uri);
    const text = e.textDocument.text ?? st?.text ?? "";
    refresh(e.textDocument.uri, text);
  });
  connection.onDidClose((e) => {
    docs.delete(e.textDocument.uri);
    connection.sendDiagnostics({ uri: e.textDocument.uri, diagnostics: [] });
  });

  connection.onHover((e) => {
    const st = docs.get(e.textDocument.uri);
    if (!st) return null;
    const offset = lspToOffset(st.text, e.textDocument.uri, e.position);
    const h = st.analysis.hover(offset);
    if (!h) return null;
    return {
      contents: { kind: "markdown", value: h.value },
      range: h.range
        ? offsetRangeToLsp(st.text, h.range.start, h.range.end)
        : undefined,
    };
  });

  connection.onDefinition((e) => {
    const st = docs.get(e.textDocument.uri);
    if (!st) return null;
    const offset = lspToOffset(st.text, e.textDocument.uri, e.position);
    const defs = st.analysis.definitions(offset);
    return defs.map((d) => ({
      uri: d.uri,
      range: offsetRangeToLsp(st.text, d.range.start, d.range.end),
    }));
  });

  connection.onDocumentSymbol((e) => {
    const st = docs.get(e.textDocument.uri);
    if (!st) return [];
    return st.analysis.symbols.map((s) => ({
      name: s.name,
      kind: mapSymbolKind(s.kind),
      range: offsetRangeToLsp(st.text, s.range.start, s.range.end),
      selectionRange: offsetRangeToLsp(st.text, s.range.start, s.range.end),
    }));
  });

  function offsetRangeToLsp(text: string, start: number, end: number) {
    return {
      start: offsetToPosition(text, start),
      end: offsetToPosition(text, end),
    };
  }

  return { connection, refresh, docs };
}

function offsetToPosition(text: string, offset: number): rpc.Position {
  let line = 0;
  let lastBreak = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lastBreak = i;
    }
  }
  return { line, character: offset - lastBreak - 1 };
}

function lspToOffset(text: string, _uri: string, pos: rpc.Position): number {
  let line = 0;
  let i = 0;
  while (i < text.length && line < pos.line) {
    if (text[i] === "\n") line++;
    i++;
  }
  return i + pos.character;
}

function mapSymbolKind(kind: string): rpc.SymbolKind {
  switch (kind) {
    case "label": return rpc.SymbolKind.Function;
    case "global": return rpc.SymbolKind.Object;
    case "local": return rpc.SymbolKind.Variable;
    case "routine": return rpc.SymbolKind.File;
    case "fn": return rpc.SymbolKind.Function;
    case "type": return rpc.SymbolKind.Struct;
    case "param": return rpc.SymbolKind.Field;
    default: return rpc.SymbolKind.Variable;
  }
}

/** Launch on stdio. */
export function listen(opts: HostOptions) {
  const host = createHost(opts);
  host.connection.listen();
  return host;
}
