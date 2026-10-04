import { describe, expect, test } from "bun:test";
import { analyse } from "../../packages/m-core/src/index";
import {
  blockContext,
  classifyBlockOpener,
  leadingDots,
  quitArgAllowed,
  splitLines,
} from "../../packages/m-core/src/block";
import { tokenize } from "../../packages/m-core/src/index";

describe("M DO/FOR block context (m-lsp#1)", () => {
  const diags = (text: string) => analyse("file:///t.m", text).diagnostics;
  const codes = (text: string) => diags(text).map((d) => d.code);

  test("leading dots — depth", () => {
    expect(leadingDots("FOO S X=1", 0)).toBe(0);
    expect(leadingDots("  . S X=1", 0)).toBe(0); // indent then dot is not M depth
    expect(leadingDots(". S X=1", 0)).toBe(1);
    expect(leadingDots(".. S X=1", 0)).toBe(2);
    expect(leadingDots(".5 S X=1", 0)).toBe(0); // decimal, not a dot
  });

  test("argless DO opens a dotted block", () => {
    const text = "D\n. Q 1\n";
    const lines = splitLines(text, tokenize(text));
    const { stackAtLine } = blockContext(lines);
    expect(stackAtLine[1].some((f) => f.kind === "DO" && f.scope === "dotted")).toBe(true);
    expect(codes(text)).not.toContain("m/quit-arg-context");
  });

  test("top-level QUIT arg still warns", () => {
    expect(codes("Q 1")).toContain("m/quit-arg-context");
    expect(codes("FOO Q 1")).toContain("m/quit-arg-context");
  });

  test("QUIT arg inside dotted DO body is clean", () => {
    expect(codes("D\n. Q 1")).not.toContain("m/quit-arg-context");
  });

  test("nested FileMan-style blocks (XLFSHAN)", () => {
    const text = [
      "F  S FNUM=$O(^TMP($J,\"DIQ\",FNUM)) Q:FNUM=\"\"  D",
      ". F  S IENS=$O(^TMP($J,\"DIQ\",FNUM,IENS)) Q:IENS=\"\"  D",
      ".. S FIELDNUM=1",
      ".. Q 99",
      ". Q 1",
      "Q",
    ].join("\n");
    expect(codes(text)).not.toContain("m/quit-arg-context");
    const lines = splitLines(text, tokenize(text));
    const { stackAtLine } = blockContext(lines);
    // line `.. Q 99` is at depth 2 inside two DO frames
    const deep = stackAtLine.find((s) => s.filter((f) => f.kind === "DO").length === 2);
    expect(deep).toBeTruthy();
  });

  test("DO call does not open a block", () => {
    const text = "D FOO^BAR\nQ 1";
    expect(codes(text)).toContain("m/quit-arg-context");
    const lines = splitLines(text, tokenize(text));
    const { stackAtLine, framesOpenedOnLine } = blockContext(lines);
    expect(framesOpenedOnLine[0]).toEqual([]);
    expect(stackAtLine[1]).toEqual([]);
  });

  test("DO $$fn and DO @(x) are calls", () => {
    expect(classifyBlockOpener("DO", tokenize("D $$FOO"), 0, 0, 0)).toBeNull();
    expect(classifyBlockOpener("DO", tokenize("D @(X)"), 0, 0, 0)).toBeNull();
  });

  test("FOR with args — same-line QUIT arg allowed", () => {
    expect(codes("F I=1:1:3 Q 1")).not.toContain("m/quit-arg-context");
  });

  test("FOR argless — same-line body is inline FOR scope", () => {
    expect(codes("F  S X=1 Q 2")).not.toContain("m/quit-arg-context");
  });

  test("QUIT arg on a dotted line after DO call still warns", () => {
    // `D FOO` is a call; the following `. Q 1` is a stray dotted line
    // at depth 1 with no open DO — still top-level-ish for QUIT purposes.
    // (Stray dots are a separate diagnostic; we only care QUIT-arg.)
    const text = "D FOO\n. Q 1";
    // depth-1 line with empty dotted stack → QUIT arg not allowed
    expect(codes(text)).toContain("m/quit-arg-context");
  });

  test("quitArgAllowed", () => {
    expect(quitArgAllowed([])).toBe(false);
    expect(quitArgAllowed([
      { kind: "DO", openDepth: 0, bodyDepth: 1, scope: "dotted", openOffset: 0 },
    ])).toBe(true);
  });

  test("stack pops when depth drops", () => {
    const text = "D\n. D\n. . Q 1\n. Q 2\nQ 3";
    const lines = splitLines(text, tokenize(text));
    const { stackAtLine } = blockContext(lines);
    // last `Q 3` at depth 0 — no frames
    expect(stackAtLine[stackAtLine.length - 1]).toEqual([]);
    expect(quitArgAllowed(stackAtLine[2])).toBe(true); // `.. Q 1`
  });

  test("extrinsic with formal args — QUIT expr is clean (ISO 8.1.2)", () => {
    expect(codes("FOO(X) Q 1")).not.toContain("m/quit-arg-context");
    expect(codes("FOO(X) ;\nQ:X 1\nQ 0")).not.toContain("m/quit-arg-context");
    // label without formals is not an extrinsic
    expect(codes("BAR ;\nQ 1")).toContain("m/quit-arg-context");
  });
});
