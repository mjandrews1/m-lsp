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
    const src = "F I=1:1:10:W I";
    const toks = tokenize(src);
    const start = forArgListStart(toks, 0);
    const info = parseForArgs(toks, start, toks[0].range.end, src);
    expect(info?.variable).toBe("I");
    expect(info?.specColons).toBe(2);
    expect(info?.hasCommandInArgs).toBe(true);
  });
});

describe("FOR hover edge cases (m-lsp#3)", () => {
  const infoFor = (text: string) => {
    const toks = tokenize(text);
    const start = forArgListStart(toks, 0);
    return parseForArgs(toks, start, toks[0].range.end, text);
  };
  const hover0 = (text: string) => analyse("file:///t.m", text).hover(0);

  test("raw preserves spaces (m-lsp#3 #1)", () => {
    expect(infoFor("F I=1:1:10:W I")?.raw).toBe("I=1:1:10:W I");
    expect(infoFor("F I=1:1:10:S J=I+1 W J")?.raw).toContain("S J=I+1 W J");
  });

  test("from expression keeps $O(X(I)) (m-lsp#3 #2)", () => {
    const info = infoFor("F I=$O(X(I)):1:5 W I");
    expect(info?.variable).toBe("I");
    expect(info?.raw).toContain("$O(X(I))");
    expect(info?.specColons).toBe(2);
    expect(info?.hasCommandInArgs).toBe(false);
    expect(hover0("F I=$O(X(I)):1:5 W I")?.value).toContain("from:increment:to");
  });

  test("2-colon form is from:increment (m-lsp#3 #3)", () => {
    const info = infoFor("F I=1:2 W I");
    expect(info?.specColons).toBe(1);
    expect(hover0("F I=1:2 W I")?.value).toContain("from:increment");
    expect(hover0("F I=1:2 W I")?.value).not.toContain("from:increment:to");
  });

  test("F I=1: S X=I — body, not :cmds (m-lsp#3 #4)", () => {
    const info = infoFor("F I=1: S X=I");
    expect(info?.hasCommandInArgs).toBe(false);
    expect(info?.raw).toBe("I=1:");
    expect(hover0("F I=1: S X=I")?.value).toContain("`I=from`");
  });

  test("exclusive list + :cmds (m-lsp#3 #5)", () => {
    const info = infoFor("F I=1,2,3:W I");
    expect(info?.hasList).toBe(true);
    expect(info?.hasCommandInArgs).toBe(true);
    expect(hover0("F I=1,2,3:W I")?.value).toContain("exclusive list");
  });

  test("0:0 with :cmds shows tail (m-lsp#3 #6)", () => {
    const info = infoFor("F 0:0:W 1");
    expect(info?.bareSpec).toBe(true);
    expect(info?.hasCommandInArgs).toBe(true);
    expect(hover0("F 0:0:W 1")?.value).toContain("0:0");
    expect(hover0("F 0:0:W 1")?.value).toContain("trailing command");
  });

  test("incomplete to (m-lsp#3 #8)", () => {
    const info = infoFor("F I=1:1:");
    expect(info?.incomplete).toBe(true);
    expect(hover0("F I=1:1:")?.value).toContain("incomplete");
  });

  test("full from:inc:to:cmds still works (m-lsp#2)", () => {
    const info = infoFor("F I=1:1:10:W I");
    expect(info?.hasCommandInArgs).toBe(true);
    expect(hover0("F I=1:1:10:W I")?.value).toContain("trailing command");
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
