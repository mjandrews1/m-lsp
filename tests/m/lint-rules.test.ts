import { describe, expect, test } from "bun:test";
import { analyse, lintOnlyDiagnostics, LINT_CODES } from "../../packages/m-core/src/index";

const codes = (text: string, opts = {}) =>
  [...analyse("t.m", text).diagnostics, ...lintOnlyDiagnostics(text, opts)].map((d) => d.code);

describe("m-lint rule coverage (rsm#28)", () => {
  test("every advertised code is produced by some input", () => {
    const produced = new Set<string>();
    const samples = [
      'W "a" E  W "b"',
      "Q 1",
      "W $FOOBAR(1)",
      "W:",
      "D FOO^",
      "W 1\nFOO BAR BAZ",
      "W $NEXT(1)",
      'I "007"=7 W 1',
      "W $ORDER(\"\")",
      "W 1" + " ".repeat(300),
      "W 1   \n",
    ];
    for (const s of samples) for (const c of codes(s)) produced.add(c);
    for (const c of LINT_CODES) {
      expect(produced.has(c)).toBe(true);
    }
  });
});

describe("m/lint-only rules", () => {
  test("m/deprecated-intrinsic flags $NEXT", () => {
    expect(codes("W $NEXT(1)")).toContain("m/deprecated-intrinsic");
  });

  test("m/ncopy-compare flags numeric-looking string compare", () => {
    expect(codes('I "007"=7 W 1')).toContain("m/ncopy-compare");
  });

  test("m/empty-subscript-order flags $ORDER(\"\")", () => {
    expect(codes('W $ORDER("")')).toContain("m/empty-subscript-order");
  });

  test("m/long-line at 256 default", () => {
    expect(codes("W 1" + " ".repeat(300))).toContain("m/long-line");
    expect(codes("W 1")).not.toContain("m/long-line");
    expect(codes("W 1" + " ".repeat(300), { maxLineLength: 400 })).not.toContain("m/long-line");
  });

  test("m/trailing-whitespace", () => {
    expect(codes("W 1   \n")).toContain("m/trailing-whitespace");
  });

  test("m/unknown-command", () => {
    expect(codes("FOO BAR BAZ")).toContain("m/unknown-command");
  });

  test("severity override can silence a rule", () => {
    expect(codes("W 1   \n", { severity: { "m/trailing-whitespace": "off" } })).not.toContain(
      "m/trailing-whitespace",
    );
  });
});

describe("shared rules still fire through the lint path", () => {
  test("unbalanced else", () => {
    expect(codes('W "a" E  W "b"')).toContain("m/unbalanced-else");
  });
  test("unknown intrinsic", () => {
    expect(codes("W $FOOBAR(1)")).toContain("m/unknown-intrinsic");
  });
  test("quit arg", () => {
    expect(codes("Q 1")).toContain("m/quit-arg-context");
  });
});
