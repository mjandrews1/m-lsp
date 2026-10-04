import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { writeFileSync, mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI = join(import.meta.dir, "../../packages/c3-lint/src/main.ts");
const bun = "bun";

function run(args: string[]) {
  const r = spawnSync(bun, [CLI, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("c3-lint CLI (rsm#29 acceptance)", () => {
  const dir = mkdtempSync(join(tmpdir(), "c3lint-"));
  const dirty = join(dir, "dirty.c3");
  const clean = join(dir, "clean.c3");
  writeFileSync(dirty, "class Foo { int x; }\nfn void f() { int y = sizeof(int); }\n");
  writeFileSync(clean, "fn void ok(int n) { }\n");

  test("--list-codes prints every rule", () => {
    const r = run(["--list-codes"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("c3/class-not-keyword");
    expect(r.out).toContain("c3/abi-magic");
    expect(r.out).toContain("c3/long-function");
  });

  test("--help documents exit codes", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Exit codes:");
    expect(r.out).toContain("0  clean");
  });

  test("stylish format + exit 1 on dirty file", () => {
    const r = run([dirty]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("c3/class-not-keyword");
    expect(r.out).toContain("c3/sizeof-trap");
    expect(r.out).toContain("file(s)");
  });

  test("clean file exits 0", () => {
    const r = run([clean]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("0 error(s)");
  });

  test("json format is parseable", () => {
    const r = run(["--format", "json", dirty]);
    const data = JSON.parse(r.out);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].code).toBeTruthy();
  });

  test("github format emits workflow commands", () => {
    const r = run(["--format", "github", dirty]);
    expect(r.out).toMatch(/^::(error|warning|notice) /m);
  });

  test("--dir walks a tree", () => {
    const r = run(["--dir", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("dirty.c3");
    expect(r.out).toContain("2 file(s)");
  });

  test("missing file exits 2", () => {
    const r = run([join(dir, "nope.c3")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("no such file");
  });

  test("no input exits 2", () => {
    const r = run([]);
    expect(r.code).toBe(2);
  });
});

describe("c3-lint against real source (acceptance fixtures)", () => {
  const roots = [
    join(process.env.HOME ?? "/Users/mark", "c3mumps", "src"),
    join(process.env.HOME ?? "/Users/mark", "_c3m", "src"),
    join(process.env.HOME ?? "/Users/mark", "_c3fst", "src"),
  ].filter(existsSync);

  test.skipIf(roots.length === 0)("c3mumps / c3m / c3fst sources lint without crashing", () => {
    for (const r of roots) {
      const res = run(["--dir", r, "--format", "json"]);
      // exit 0 (clean) or 1 (findings) are both fine — must not be 2
      expect(res.code === 0 || res.code === 1).toBe(true);
      // json must parse
      const data = JSON.parse(res.out || "[]");
      expect(Array.isArray(data)).toBe(true);
      console.log(`  ${r}: exit ${res.code}, ${data.length} findings`);
    }
  });
});
