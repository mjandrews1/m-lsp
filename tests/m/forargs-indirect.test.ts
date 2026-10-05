import { describe, expect, test } from "bun:test";
import { analyse, tokenize } from "../../packages/m-core/src/index";
import {
  emptyIndirectDiagnostics,
  forArgListStart,
  parseForArgs,
} from "../../packages/m-core/src/forargs";
import { fullCommand } from "../../packages/m-core/src/block";

describe("FOR argument lists (m-lsp#2)", () => {
  const diags = (text: string) => analyse("file:///t.m", text).diagnostics;
  const codes = (text: string) => diags(text).map((d) => d.code);
  const hover = (text: string, needle: string) => {
    const i = text.indexOf(needle);
    return analyse("file:///t.m", text).hover(i + 1);
  };

  test("argumentless FOR — no arg diagnostic", () => {
    expect(codes("F  S X=1")).not.toContain("m/for-args");
  });

  test("var=from:inc:to is clean", () => {
    expect(codes("F I=1:1:3 W I")).not.toContain("m/for-args");
    expect(codes("F I=1:1:3")).not.toContain("m/for-args");
    expect(codes("F I=1:1:$L(X) W I")).not.toContain("m/for-args");
  });

  test("exclusive list is clean", () => {
    expect(codes("F I=1,2,3 W I")).not.toContain("m/for-args");
  });

  test("0:0 forever form is clean", () => {
    expect(codes("F 0:0 S X=$O(Y(X)) Q:X=\"\"")).not.toContain("m/for-args");
  });

  test("malformed FOR args warn", () => {
    expect(codes("F 1:1:3 W I")).toContain("m/for-args");
    expect(codes("F 1,2 W I")).toContain("m/for-args");
  });

  test("FOR hover shows argument form", () => {
    const t = "F I=1:1:3 W I";
    const h = analyse("file:///t.m", t).hover(0); // on `F`
    expect(h?.value).toContain("from:increment:to");
    const t2 = "F  S X=1";
    const h2 = analyse("file:///t.m", t2).hover(0);
    expect(h2?.value).toContain("argumentless");
  });

  test("parseForArgs shapes", () => {
    const toks = tokenize("F I=1:1:10:W I").filter((t) => t.kind !== "whitespace");
    const start = forArgListStart(toks, 0);
    const info = parseForArgs(toks, start, toks[0].range.end);
    expect(info?.variable).toBe("I");
    expect(info?.hasColonSpec).toBe(true);
    expect(info?.hasCommandInArgs).toBe(true);
  });
});

describe("indirection @ (m-lsp#2)", () => {
  const diags = (text: string) => analyse("file:///t.m", text).diagnostics;
  const codes = (text: string) => diags(text).map((d) => d.code);

  test("empty @ warns", () => {
    expect(codes("W @")).toContain("m/empty-indirect");
    expect(codes("W @ ; c")).toContain("m/empty-indirect");
    expect(codes("D @")).toContain("m/empty-indirect");
  });

  test("D @(X) does not warn and does not invent label refs", () => {
    expect(codes("D @(X)")).not.toContain("m/empty-indirect");
    const a = analyse("file:///t.m", "D @(X)");
    const labelRefs = a.references.filter((r) => r.kind === "label");
    expect(labelRefs.filter((r) => r.name === "X")).toEqual([]);
  });

  test("@X is indirection, not empty (X is XECUTE abbr)", () => {
    expect(codes("S @X=1")).not.toContain("m/empty-indirect");
    const t = "S @X=1";
    const h = analyse("file:///t.m", t).hover(t.indexOf("@"));
    expect(h?.value).toContain("indirection");
  });

  test("fullCommand still knows abbreviations", () => {
    expect(fullCommand("D")).toBe("DO");
    expect(fullCommand("Q")).toBe("QUIT");
  });
});
