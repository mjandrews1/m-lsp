/**
 * Shared LSP host — language-agnostic.
 *
 * Speaks LSP over stdio; dispatches to a `LanguagePlugin` by file
 * extension.  Adding a language is a new plugin, not a new server.
 * Maintains a workspace symbol index so goto can cross files.
 */
import * as rpc from "vscode-languageserver/node";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Analysis, LanguagePlugin } from "../../core/src/index";
import { WorkspaceIndex } from "../../core/src/workspace";

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
  const wsIndex = new WorkspaceIndex();

  function pluginFor(uri: string): LanguagePlugin | undefined {
    const dot = uri.lastIndexOf(".");
    if (dot < 0) return undefined;
    const ext = uri.slice(dot).toLowerCase();
    const clean = ext.split("?")[0];
    return byExt.get(clean);
  }

  function refresh(uri: string, text: string) {
    const p = pluginFor(uri);
    if (!p) return;
    const analysis = p.analyse(uri, text);
    docs.set(uri, { uri, text, analysis });
    wsIndex.addFile(uri, analysis.symbols);
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

  /** Scan a directory for plugin-owned files and index their symbols. */
  function indexWorkspace(root: string, depth = 6): void {
    const exts = [...byExt.keys()];
    const walk = (dir: string, d: number) => {
      if (d < 0) return;
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const e of entries) {
        if (e === "node_modules" || e === ".git" || e === "dist") continue;
        const p = path.join(dir, e);
        let st: fs.Stats;
        try {
          st = fs.statSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(p, d - 1);
        else {
          const dot = e.lastIndexOf(".");
          const ext = dot >= 0 ? e.slice(dot).toLowerCase() : "";
          if (!exts.includes(ext)) continue;
          const uri = "file://" + p;
          if (docs.has(uri)) continue;
          try {
            const text = fs.readFileSync(p, "utf8");
            const plugin = pluginFor(uri);
            if (!plugin) continue;
            const analysis = plugin.analyse(uri, text);
            docs.set(uri, { uri, text, analysis });
            wsIndex.addFile(uri, analysis.symbols);
          } catch {
            /* skip unreadable */
          }
        }
      }
    };
    walk(root, depth);
  }

  connection.onInitialize((params) => {
    const folders = params.workspaceFolders ?? [];
    for (const f of folders) {
      try {
        indexWorkspace(fileURLToPath(f.uri));
      } catch {
        /* ignore */
      }
    }
    if (!folders.length && params.rootUri) {
      try {
        indexWorkspace(fileURLToPath(params.rootUri));
      } catch {
        /* ignore */
      }
    }
    return {
      capabilities: {
        textDocumentSync: rpc.TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
      },
    };
  });

  connection.onDidOpen((e) => {
    refresh(e.textDocument.uri, e.textDocument.text);
  });
  connection.onDidChangeContent((e) => {
    const st = docs.get(e.textDocument.uri);
    const text = e.textDocument.text ?? st?.text ?? "";
    refresh(e.textDocument.uri, text);
  });
  connection.onDidClose((e) => {
    docs.delete(e.textDocument.uri);
    wsIndex.removeFile(e.textDocument.uri);
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
    const defs = st.analysis.definitions(offset, wsIndex);
    return defs.map((d) => {
      const target = docs.get(d.uri);
      const text = target?.text ?? "";
      return {
        uri: d.uri,
        range: offsetRangeToLsp(text, d.range.start, d.range.end),
      };
    });
  });

  connection.onWorkspaceSymbol((e) => {
    const query = (e.query ?? "").toLowerCase();
    const out: rpc.SymbolInformation[] = [];
    // walk every indexed file's symbols
    for (const [uri, st] of docs) {
      for (const s of st.analysis.symbols) {
        if (query && !s.name.toLowerCase().includes(query)) continue;
        out.push({
          name: s.name,
          kind: mapSymbolKind(s.kind),
          location: {
            uri,
            range: offsetRangeToLsp(st.text, s.range.start, s.range.end),
          },
          containerName: s.container,
        });
        if (out.length > 500) return out;
      }
    }
    return out;
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

  return { connection, refresh, docs, wsIndex, indexWorkspace };
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
