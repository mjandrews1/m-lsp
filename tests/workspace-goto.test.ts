import { describe, expect, test } from "bun:test";
import { analyse } from "../packages/m-core/src/index";
import { WorkspaceIndex } from "../packages/core/src/workspace";

describe("workspace-wide goto", () => {
  test("M label^routine resolves into another file", () => {
    const rout = "file:///w/ROUT.m";
    const other = "file:///w/OTHER.m";
    const routText = "FOO()  W 1\nBAR()  W 2\n";
    const otherText = "D FOO^ROUT\n";
    const ws = new WorkspaceIndex();
    ws.addFile(rout, analyse(rout, routText).symbols);
    ws.addFile(other, analyse(other, otherText).symbols);

    const a = analyse(other, otherText);
    const offset = otherText.indexOf("FOO");
    const defs = a.definitions(offset, ws);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].uri).toBe(rout);
  });

  test("M cursor on routine name jumps to the routine file", () => {
    const rout = "file:///w/ROUT.m";
    const other = "file:///w/OTHER.m";
    const routText = "FOO()  W 1\n";
    const otherText = "D FOO^ROUT\n";
    const ws = new WorkspaceIndex();
    ws.addFile(rout, analyse(rout, routText).symbols);
    const a = analyse(other, otherText);
    const offset = otherText.indexOf("ROUT");
    const defs = a.definitions(offset, ws);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].uri).toBe(rout);
  });

  test("M $$extrinsic resolves across files", () => {
    const fn = "file:///w/FN.m";
    const caller = "file:///w/CALL.m";
    const fnText = "HELPER()  W 1\n";
    const callerText = "S X=$$HELPER\n";
    const ws = new WorkspaceIndex();
    ws.addFile(fn, analyse(fn, fnText).symbols);
    const a = analyse(caller, callerText);
    const offset = callerText.indexOf("$$HELPER") + 2;
    const defs = a.definitions(offset, ws);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].uri).toBe(fn);
  });

  test("same-document still works without a workspace index", () => {
    const text = "FOO()  W 1\nD FOO\n";
    const a = analyse("file:///t.m", text);
    const defs = a.definitions(text.indexOf("D FOO") + 2);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].uri).toBe("file:///t.m");
  });

  test("WorkspaceIndex add/remove keeps lookups consistent", () => {
    const ws = new WorkspaceIndex();
    const uri = "file:///w/a.m";
    ws.addFile(uri, analyse(uri, "FOO()  W 1\n").symbols);
    expect(ws.lookup("FOO").length).toBe(1);
    ws.removeFile(uri);
    expect(ws.lookup("FOO").length).toBe(0);
  });
});
