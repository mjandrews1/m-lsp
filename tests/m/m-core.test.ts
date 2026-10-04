import { describe, expect, test } from "bun:test";
import { analyse, mPlugin, tokenize, INTRINSICS, COMMANDS } from "../../packages/m-core/src/index";

describe("M tokenizer", () => {
  test("commands, strings, globals, intrinsics", () => {
    const toks = tokenize('S X=1 W "hi",! W $D(^G(1)),!');
    const kinds = toks.filter((t) => t.kind !== "whitespace").map((t) => t.kind);
    expect(kinds).toContain("ident");      // S
    expect(kinds).toContain("string");
    expect(kinds).toContain("global");
    expect(kinds).toContain("intrinsic");
    expect(kinds).toContain("number");
  });

  test("comment to end of line", () => {
    const toks = tokenize("W 1 ; this is a comment\nW 2");
    const c = toks.find((t) => t.kind === "comment");
    expect(c?.text).toBe("; this is a comment");
  });
});

describe("M diagnostics (v1 acceptance)", () => {
  const diags = (text: string) => analyse("file:///t.m", text).diagnostics;
  const codes = (text: string) => diags(text).map((d) => d.code);

  test("unbalanced ELSE — ELSE with no IF", () => {
    expect(codes('W "a" E  W "b"')).toContain("m/unbalanced-else");
  });

  test("balanced IF/ELSE is clean", () => {
    expect(codes('I 1 W "a" E  W "b"')).not.toContain("m/unbalanced-else");
  });

  test("QUIT with argument at top level warns", () => {
    expect(codes("Q 1")).toContain("m/quit-arg-context");
  });

  test("argumentless QUIT is clean", () => {
    expect(codes("Q")).not.toContain("m/quit-arg-context");
    expect(codes("Q:1")).not.toContain("m/quit-arg-context");
  });

  test("unknown intrinsic", () => {
    expect(codes("W $FOOBAR(1)")).toContain("m/unknown-intrinsic");
    expect(codes('W $DATA(^X)')).not.toContain("m/unknown-intrinsic");
    expect(codes('W $D(^X)')).not.toContain("m/unknown-intrinsic");
    expect(codes('W $ORDER(^X(I))')).not.toContain("m/unknown-intrinsic");
    expect(codes('W $O(^X(I))')).not.toContain("m/unknown-intrinsic");
  });

  test("empty post-conditional", () => {
    expect(codes("W:")).toContain("m/empty-postcond");
    expect(codes('W:1 "ok"')).not.toContain("m/empty-postcond");
  });

  test("invalid routine name", () => {
    expect(codes("D FOO^BAR")).not.toContain("m/invalid-routine");
    // a routine ref whose name is a bare ^ is invalid
    expect(codes("D FOO^")).toContain("m/invalid-routine");
    expect(codes("D OK^ROUT")).not.toContain("m/invalid-routine");
  });

  test("unknown command is not a hard error (v1) but known commands parse", () => {
    // SET / WRITE / IF / ELSE / FOR / DO / QUIT / KILL / NEW / MERGE all accepted
    for (const c of ["S X=1", "W 1", "I 1 W 1", "F I=1:1:3 W I", "K X", "N X", "M A=B"]) {
      expect(analyse("file:///t.m", c).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    }
  });
});

describe("M hover (v1 acceptance)", () => {
  const hoverAt = (text: string, needle: string) => {
    const i = text.indexOf(needle);
    expect(i).toBeGreaterThanOrEqual(0);
    return analyse("file:///t.m", text).hover(i + 1);
  };

  test("$DATA documents 0/1/10/11", () => {
    const h = hoverAt("W $DATA(^G)", "$DATA");
    expect(h?.value).toContain("0");
    expect(h?.value).toContain("10");
    expect(h?.value).toContain("11");
  });

  test("$ORDER documents empty-subscript marker (rsm#14)", () => {
    const h = hoverAt("W $ORDER(^G(I))", "$ORDER");
    expect(h?.value).toContain("Empty subscript");
  });

  test("$T is $TEST not $TEXT", () => {
    const h = hoverAt("W $T", "$T");
    expect(h?.value).toContain("TEST");
  });

  test("ELSE / $TEST ISO 7.2.4 is mentioned", () => {
    const h = hoverAt("W $TEST", "$TEST");
    expect(h?.value).toContain("ELSE");
    expect(h?.value).toContain("7.2.4");
  });

  test("intrinsic abbreviation resolves", () => {
    const h = hoverAt("W $D(^G)", "$D");
    expect(h?.value).toContain("$DATA");
  });

  test("extrinsic $$fn shows as extrinsic", () => {
    const h = hoverAt("S Y=$$FOO(1)", "$$FOO");
    expect(h?.value).toContain("extrinsic");
  });
});

describe("M goto (v1 acceptance)", () => {
  test("label^routine resolves to a label symbol", () => {
    const text = "FOO()  W 1\nDO FOO^ROUT\n";
    const a = analyse("file:///t.m", text);
    const defs = a.definitions(text.indexOf("FOO^ROUT"));
    expect(defs.length).toBeGreaterThan(0);
  });

  test("global ref is a definition site", () => {
    const a = analyse("file:///t.m", "S ^G(1)=1");
    expect(a.symbols.some((s) => s.name === "^G")).toBe(true);
  });
});

describe("M plugin shape", () => {
  test("claims .m extensions", () => {
    expect(mPlugin.extensions).toContain(".m");
    expect(mPlugin.id).toBe("m");
  });

  test("command table covers the v1 surface", () => {
    for (const c of ["SET", "WRITE", "IF", "ELSE", "FOR", "DO", "GOTO", "QUIT", "KILL", "MERGE", "HALT", "HANG", "READ", "LOCK", "OPEN", "CLOSE", "USE", "NEW"]) {
      expect(COMMANDS.has(c)).toBe(true);
    }
  });

  test("intrinsic table covers the v1 surface", () => {
    for (const i of ["DATA", "ORDER", "QUERY", "NAME", "GET", "PIECE", "EXTRACT", "FIND", "LENGTH", "ASCII", "CHAR", "RANDOM", "HOROLOG", "JOB", "TEXT", "JUSTIFY", "REVERSE", "TRANSLATE", "INCREMENT", "FNUMBER", "STACK"]) {
      expect(INTRINSICS[i]).toBeTruthy();
    }
  });
});
