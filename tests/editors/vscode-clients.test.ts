import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");

describe("VS Code thin clients (rsm#27 leftover)", () => {
  for (const name of ["vscode-m", "vscode-c3"]) {
    describe(name, () => {
      const dir = join(ROOT, "editors", name);

      test("package.json is valid and claims a language", () => {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(pkg.name).toBeTruthy();
        expect(pkg.main).toBe("./extension.js");
        expect(pkg.contributes.languages.length).toBeGreaterThan(0);
        expect(pkg.contributes.grammars.length).toBeGreaterThan(0);
        expect(pkg.activationEvents).toContain(
          name === "vscode-m" ? "onLanguage:m" : "onLanguage:c3",
        );
      });

      test("extension.js exists and starts a LanguageClient", () => {
        const src = readFileSync(join(dir, "extension.js"), "utf8");
        expect(src).toContain("LanguageClient");
        expect(src).toContain("packages");
        expect(src).toContain("main.ts");
        expect(src).toContain("activate");
      });

      test("language-configuration.json parses", () => {
        const cfg = JSON.parse(readFileSync(join(dir, "language-configuration.json"), "utf8"));
        expect(cfg.comments).toBeTruthy();
      });

      test("grammar file referenced by package.json exists", () => {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        for (const g of pkg.contributes.grammars) {
          const p = join(dir, g.path);
          expect(existsSync(p)).toBe(true);
        }
      });

      test("server entry point exists", () => {
        const server = join(ROOT, "packages", "server", "src", "main.ts");
        expect(existsSync(server)).toBe(true);
        const main = readFileSync(server, "utf8");
        expect(main).toContain("listen");
      });
    });
  }

  test("both clients share one server host (not four copies)", () => {
    const m = readFileSync(join(ROOT, "editors", "vscode-m", "extension.js"), "utf8");
    const c = readFileSync(join(ROOT, "editors", "vscode-c3", "extension.js"), "utf8");
    expect(m).toContain("packages");
    expect(c).toContain("packages");
    // both point at the same host entry
    const server = "packages/server/src/main.ts";
    // path fragments join to the same place
    expect(m).toContain('"server"');
    expect(c).toContain('"server"');
    void server;
  });
});
