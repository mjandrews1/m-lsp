import { describe, expect, test } from "bun:test";
import { analyse, c3LintOnlyDiagnostics, C3_LINT_CODES } from "../../packages/c3-core/src/index";

const codes = (text: string, opts = {}) =>
  [...analyse("t.c3", text).diagnostics, ...c3LintOnlyDiagnostics(text, opts)].map((d) => d.code);

describe("c3-lint rule coverage (rsm#29)", () => {
  test("every advertised code is produced by some input", () => {
    const produced = new Set<string>();
    const samples = [
      "class Foo { int x; }",
      "fn void f(int FOO) { }",
      "extern fn int puts(char* s);",
      "fn void f() { io::printn(\"x\"); }",
      "fn void f(int[256] buf) { }",
      "fn void f(out int[256] buf) { }",
      "extern fn int ioctl(int fd, ulong req, int arg);",
      "extern fn int f(int x, int 4096);",
      "fn void f() { int x = sizeof(int); }",
      "fn void f() { try { } }",
      "fn void f() { static int n = 0; }",
      "fn void f() {\n" + "int x = 1;\n".repeat(70) + "}",
      "import io;\nimport io;\nfn void f() { }",
    ];
    for (const s of samples) for (const c of codes(s)) produced.add(c);
    for (const c of C3_LINT_CODES) {
      expect(produced.has(c)).toBe(true);
    }
  });
});

describe("shared c3-core rules still fire", () => {
  test("class-not-keyword", () => {
    expect(codes("class Foo { int x; }")).toContain("c3/class-not-keyword");
  });
  test("param-name", () => {
    expect(codes("fn void f(int FOO) { }")).toContain("c3/param-name");
  });
  test("extern-char-ptr", () => {
    expect(codes("extern fn int puts(char* s);")).toContain("c3/extern-char-ptr");
  });
  test("missing-import", () => {
    expect(codes('fn void f() { io::printn("x"); }')).toContain("c3/missing-import");
  });
  test("array-param", () => {
    expect(codes("fn void f(int[256] buf) { }")).toContain("c3/array-param");
  });
});

describe("c3 lint-only rules", () => {
  test("c3/sizeof-trap", () => {
    expect(codes("fn void f() { int x = sizeof(int); }")).toContain("c3/sizeof-trap");
    expect(codes("fn void f() { int x = 1; }")).not.toContain("c3/sizeof-trap");
  });

  test("c3/fault-try", () => {
    expect(codes("fn void f() { try { } }")).toContain("c3/fault-try");
  });

  test("c3/static-local", () => {
    expect(codes("fn void f() { static int n = 0; }")).toContain("c3/static-local");
  });

  test("c3/abi-magic on extern fn numbers", () => {
    expect(codes("extern fn int ioctl(int fd, ulong req, int arg);")).not.toContain("c3/abi-magic");
    expect(codes("extern fn int f(int x, int 4096);")).toContain("c3/abi-magic");
  });

  test("c3/array-out-param", () => {
    expect(codes("fn void f(out int[256] buf) { }")).toContain("c3/array-out-param");
  });

  test("c3/dup-include", () => {
    expect(codes("import io;\nimport io;\nfn void f() { }")).toContain("c3/dup-include");
    expect(codes("import io;\nimport io::printn;\nfn void f() { }")).not.toContain("c3/dup-include");
  });

  test("c3/long-function at 60 lines", () => {
    const body = "{\n" + "int x = 1;\n".repeat(70) + "}";
    expect(codes("fn void big() " + body)).toContain("c3/long-function");
    expect(codes("fn void small() {\nint x = 1;\n}")).not.toContain("c3/long-function");
    expect(codes("fn void big() " + body, { maxFunctionLines: 100 })).not.toContain("c3/long-function");
  });

  test("severity override can silence a rule", () => {
    expect(
      codes("fn void f() { int x = sizeof(int); }", { severity: { "c3/sizeof-trap": "off" } }),
    ).not.toContain("c3/sizeof-trap");
  });
});
