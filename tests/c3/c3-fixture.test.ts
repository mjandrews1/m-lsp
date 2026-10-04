import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";
import { analyse } from "../../packages/c3-core/src/index";

/**
 * Fixture tests against c3m / c3fst **source** (read-only).
 * The bug history in these trees is the C3 LSP test set (rsm#27).
 */
const roots = [
  join(process.env.HOME ?? "/Users/mark", "_c3m", "src"),
  join(process.env.HOME ?? "/Users/mark", "_c3fst", "src"),
  join(process.env.HOME ?? "/Users/mark", "c3mumps", "src"),
].filter(existsSync);

function walkC3Files(root: string, limit = 30): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) stack.push(p);
      else if (e.endsWith(".c3")) out.push(p);
    }
  }
  return out;
}

describe("C3 source fixture (c3m / c3fst / c3mumps)", () => {
  test.skipIf(roots.length === 0)("no crash on real C3 sources", () => {
    let files: string[] = [];
    for (const r of roots) files = files.concat(walkC3Files(r));
    expect(files.length).toBeGreaterThan(0);
    let diags = 0;
    let tokens = 0;
    for (const f of files) {
      const a = analyse(f, readFileSync(f, "utf8"));
      diags += a.diagnostics.length;
      tokens += a.tokens.length;
      for (const t of a.tokens.slice(0, 15)) {
        a.hover(t.range.start);
        a.definitions(t.range.start);
      }
    }
    expect(tokens).toBeGreaterThan(100);
    console.log(`  C3 fixture: ${files.length} files, ${tokens} tokens, ${diags} diagnostics`);
    console.log(`  roots: ${roots.join(", ")}`);
  });

  test.skipIf(roots.length === 0)("finds fn symbols in c3mumps", () => {
    const dir = join(process.env.HOME ?? "/Users/mark", "c3mumps", "src");
    if (!existsSync(dir)) return;
    const files = walkC3Files(dir, 20);
    let fns = 0;
    for (const f of files) {
      const a = analyse(f, readFileSync(f, "utf8"));
      fns += a.symbols.filter((s) => s.kind === "fn").length;
    }
    expect(fns).toBeGreaterThan(5);
    console.log(`  C3 fixture: ${fns} fn symbols in c3mumps/src`);
  });
});
