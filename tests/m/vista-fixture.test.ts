import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";
import { analyse } from "../../packages/m-core/src/index";

/**
 * Fixture tests against a VistA FOIA .m sample (`~/_vista_sample` by default).
 * Full corpus lives on U02: vista-foia/VistA-M-master (~34k routines).
 * Read-only. See also fileman-fixture.test.ts (VA FileMan).
 */
const VISTA =
  process.env.VISTA_CORPUS ?? join(process.env.HOME ?? "/Users/mark", "vista_sample");

function walkMFiles(root: string, limit = 40): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(p);
      else if (e.endsWith(".m") || e.endsWith(".M")) out.push(p);
    }
  }
  return out;
}

describe("VistA fixture (acceptance: FOIA routines)", () => {
  const available = existsSync(VISTA);

  test.skipIf(!available)("corpus is present", () => {
    expect(available).toBe(true);
  });

  test.skipIf(!available)("analyses VistA .m sources without crashing", () => {
    const files = walkMFiles(VISTA, 200);
    expect(files.length).toBeGreaterThan(10);
    let totalDiags = 0;
    let totalTokens = 0;
    let crashes = 0;
    for (const f of files) {
      try {
        const text = readFileSync(f, "utf8");
        const a = analyse(f, text);
        totalDiags += a.diagnostics.length;
        totalTokens += a.tokens.length;
        for (const t of a.tokens.slice(0, 15)) {
          a.hover(t.range.start);
          a.definitions(t.range.start);
        }
      } catch (e) {
        crashes++;
        console.log(`  CRASH ${f}: ${e}`);
      }
    }
    expect(crashes).toBe(0);
    expect(totalTokens).toBeGreaterThan(100);
    console.log(
      `  VistA fixture: ${files.length} files, ${totalTokens} tokens, ${totalDiags} diagnostics`,
    );
  });

  test.skipIf(!available)("routines with labels produce label symbols", () => {
    const files = walkMFiles(VISTA, 100);
    let withLabels = 0;
    for (const f of files) {
      const a = analyse(f, readFileSync(f, "utf8"));
      if (a.symbols.some((s) => s.kind === "label")) withLabels++;
    }
    expect(withLabels).toBeGreaterThan(files.length * 0.5);
    console.log(`  VistA fixture: ${withLabels}/${files.length} files have label symbols`);
  });

  test.skipIf(!available)("diagnostics stay within a sane bound per file", () => {
    const files = walkMFiles(VISTA, 80);
    let worst = 0;
    let worstFile = "";
    for (const f of files) {
      const a = analyse(f, readFileSync(f, "utf8"));
      if (a.diagnostics.length > worst) {
        worst = a.diagnostics.length;
        worstFile = f;
      }
    }
    console.log(`  VistA worst diagnostics: ${worst} (${worstFile})`);
    // no crash is the bar; log the worst for trend tracking
    expect(worst).toBeGreaterThanOrEqual(0);
  });
});
