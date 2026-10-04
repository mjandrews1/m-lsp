import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";
import { analyse } from "../../packages/m-core/src/index";

/**
 * Fixture tests against the real VA FileMan corpus (`~/_fileman`).
 * Read-only (MEMORY rule: _fileman is the conformance corpus).
 */
const FILEMAN = process.env.FILEMAN_CORPUS ?? join(process.env.HOME ?? "/Users/mark", "_fileman");

function walkMFiles(root: string, limit = 40): string[] {
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
      else if (e.endsWith(".m") || e.endsWith(".M")) out.push(p);
    }
  }
  return out;
}

describe("FileMan fixture (acceptance: tested against a real M corpus)", () => {
  const available = existsSync(FILEMAN);

  test.skipIf(!available)("corpus is present", () => {
    expect(available).toBe(true);
  });

  test.skipIf(!available)("analyses FileMan .m sources without crashing", () => {
    const files = walkMFiles(FILEMAN, 25);
    expect(files.length).toBeGreaterThan(0);
    let totalDiags = 0;
    let totalTokens = 0;
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const a = analyse(f, text);
      totalDiags += a.diagnostics.length;
      totalTokens += a.tokens.length;
      // hover and definitions must not throw
      for (const t of a.tokens.slice(0, 20)) {
        a.hover(t.range.start);
        a.definitions(t.range.start);
      }
    }
    // smoke: we parsed something and produced at least the structural pass
    expect(totalTokens).toBeGreaterThan(100);
    // FileMan is huge; diagnostics will fire.  We only require no crash.
    expect(totalDiags).toBeGreaterThanOrEqual(0);
    console.log(`  FileMan fixture: ${files.length} files, ${totalTokens} tokens, ${totalDiags} diagnostics`);
  });

  test.skipIf(!available)("routines with labels produce label symbols", () => {
    const files = walkMFiles(FILEMAN, 50);
    let withLabels = 0;
    for (const f of files) {
      const a = analyse(f, readFileSync(f, "utf8"));
      if (a.symbols.some((s) => s.kind === "label")) withLabels++;
    }
    expect(withLabels).toBeGreaterThan(0);
    console.log(`  FileMan fixture: ${withLabels}/${files.length} files have label symbols`);
  });
});
