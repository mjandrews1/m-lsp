import { describe, expect, test } from "bun:test";
import { analyse, c3Plugin } from "../../packages/c3-core/src/index";

describe("C3 diagnostics (v1 acceptance)", () => {
  const codes = (text: string) => analyse("file:///t.c3", text).diagnostics.map((d) => d.code);

  test("class used instead of struct", () => {
    expect(codes("class Foo { int x; }")).toContain("c3/class-not-keyword");
    expect(codes("struct Foo { int x; }")).not.toContain("c3/class-not-keyword");
  });

  test("parameter name all-caps or starting capital", () => {
    expect(codes("fn void f(int FOO) { }")).toContain("c3/param-name");
    expect(codes("fn void f(int Foo) { }")).toContain("c3/param-name");
    expect(codes("fn void f(int foo) { }")).not.toContain("c3/param-name");
  });

  test("extern fn char* where ZString is required", () => {
    expect(codes('extern fn int puts(char* s);')).toContain("c3/extern-char-ptr");
    expect(codes('extern fn int puts(ZString s);')).not.toContain("c3/extern-char-ptr");
  });

  test("array parameter warns (by-value copy)", () => {
    expect(codes("fn void f(int[256] buf) { }")).toContain("c3/array-param");
  });

  test("missing import for cross-module type", () => {
    expect(codes("fn void f() { io::printn(\"x\"); }")).toContain("c3/missing-import");
    expect(codes("import io;\nfn void f() { io::printn(\"x\"); }")).not.toContain("c3/missing-import");
  });
});

describe("C3 hover", () => {
  test("ZString explains the extern-fn rule", () => {
    const text = "extern fn int puts(ZString s);";
    const h = analyse("file:///t.c3", text).hover(text.indexOf("ZString") + 1);
    expect(h?.value).toContain("extern fn");
    expect(h?.value).toContain("char*");
  });

  test("struct hover mentions class is not a keyword", () => {
    const text = "struct Foo { int x; }";
    const h = analyse("file:///t.c3", text).hover(text.indexOf("struct") + 1);
    expect(h?.value).toContain("class");
  });
});

describe("C3 goto + symbols", () => {
  test("fn name is a definition", () => {
    const text = "fn void helper() { }";
    const a = analyse("file:///t.c3", text);
    expect(a.symbols.some((s) => s.name === "helper" && s.kind === "fn")).toBe(true);
  });

  test("plugin shape", () => {
    expect(c3Plugin.id).toBe("c3");
    expect(c3Plugin.extensions).toContain(".c3");
  });
});
