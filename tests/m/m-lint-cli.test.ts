import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI = join(import.meta.dir, "../../packages/m-lint/src/main.ts");
const bun = "bun";

function run(args: string[]) {
  const r = spawnSync(bun, [CLI, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("m-lint CLI (rsm#28 acceptance)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mlint-"));
  const dirty = join(dir, "dirty.m");
  const clean = join(dir, "clean.m");
  writeFileSync(dirty, 'W "a" E  W "b"\nQ 1\nW $FOOBAR(1)\nW 1   \n');
  writeFileSync(clean, "S X=1 W X,!\n");

  test("--list-codes prints every rule", () => {
    const r = run(["--list-codes"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("m/unbalanced-else");
    expect(r.out).toContain("m/ncopy-compare");
    expect(r.out).toContain("m/trailing-whitespace");
  });

  test("--help documents exit codes", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Exit codes:");
    expect(r.out).toContain("0  clean");
    expect(r.out).toContain("1  diagnostics");
    expect(r.out).toContain("2  usage");
  });

  test("stylish format + exit 1 on dirty file", () => {
    const r = run([dirty]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("m/unbalanced-else");
    expect(r.out).toContain("error");
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
    expect(data[0].line).toBeGreaterThan(0);
  });

  test("github format emits workflow commands", () => {
    const r = run(["--format", "github", dirty]);
    expect(r.out).toMatch(/^::(error|warning|notice) /m);
  });

  test("--dir walks a tree", () => {
    const r = run(["--dir", dir]);
    expect(r.code).toBe(1); // dirty.m has errors
    expect(r.out).toContain("dirty.m");
    expect(r.out).toContain("2 file(s)"); // both files were linted
  });

  test("--fail-on warning changes the threshold", () => {
    // dirty has warnings and errors; clean has none
    const r = run(["--fail-on", "warning", clean]);
    expect(r.code).toBe(0);
  });

  test("missing file exits 2", () => {
    const r = run([join(dir, "nope.m")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("no such file");
  });

  test("no input exits 2", () => {
    const r = run([]);
    expect(r.code).toBe(2);
  });
});
