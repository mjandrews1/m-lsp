/**
 * Workspace symbol index — shared by the LSP host so goto can cross
 * files.  Built from `Analysis.symbols` of every open/workspace doc.
 */
import type { Location, SymbolInfo } from "./index";

export class WorkspaceIndex {
  /** name -> definition locations (any kind) */
  private byName = new Map<string, { kind: string; loc: Location; container?: string }[]>();
  /** uri -> symbols declared in that file */
  private byUri = new Map<string, SymbolInfo[]>();
  /** basename (lower, no ext) -> uris */
  private byBase = new Map<string, string[]>();

  addFile(uri: string, symbols: SymbolInfo[]): void {
    this.removeFile(uri);
    this.byUri.set(uri, symbols);
    const base = basename(uri);
    const list = this.byBase.get(base) ?? [];
    if (!list.includes(uri)) list.push(uri);
    this.byBase.set(base, list);
    for (const s of symbols) {
      const key = s.name;
      const loc: Location = { uri, range: s.range };
      const arr = this.byName.get(key) ?? [];
      arr.push({ kind: s.kind, loc, container: s.container });
      this.byName.set(key, arr);
    }
  }

  removeFile(uri: string): void {
    const symbols = this.byUri.get(uri);
    if (!symbols) return;
    this.byUri.delete(uri);
    for (const s of symbols) {
      const arr = this.byName.get(s.name);
      if (!arr) continue;
      const rest = arr.filter((e) => e.loc.uri !== uri);
      if (rest.length) this.byName.set(s.name, rest);
      else this.byName.delete(s.name);
    }
    const base = basename(uri);
    const list = (this.byBase.get(base) ?? []).filter((u) => u !== uri);
    if (list.length) this.byBase.set(base, list);
    else this.byBase.delete(base);
  }

  /** All definition locations for a bare name. */
  lookup(name: string): Location[] {
    return (this.byName.get(name) ?? []).map((e) => e.loc);
  }

  /** Filtered lookup. */
  lookupKind(name: string, kind: SymbolInfo["kind"] | SymbolInfo["kind"][]): Location[] {
    const kinds = Array.isArray(kind) ? kind : [kind];
    return (this.byName.get(name) ?? [])
      .filter((e) => kinds.includes(e.kind as SymbolInfo["kind"]))
      .map((e) => e.loc);
  }

  /** URIs whose file basename matches `name` (routine lookup). */
  filesForBase(name: string): string[] {
    return this.byBase.get(name.toLowerCase()) ?? [];
  }

  /** Symbols declared in a file. */
  symbolsIn(uri: string): SymbolInfo[] {
    return this.byUri.get(uri) ?? [];
  }

  /** Convenience: find a label inside a specific routine file. */
  labelInFile(uri: string, label: string): Location[] {
    return this.symbolsIn(uri)
      .filter((s) => s.name === label && s.kind === "label")
      .map((s) => ({ uri, range: s.range }));
  }

  get size(): number {
    return this.byUri.size;
  }
}

function basename(uri: string): string {
  const clean = uri.split("?")[0];
  const i = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  const name = i >= 0 ? clean.slice(i + 1) : clean;
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}
