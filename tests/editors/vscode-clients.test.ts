import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");

describe("VS Code thin client", () => {
  const dir = join(ROOT, "editors", "vscode-m");

  test("package.json is valid and claims a language", () => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBeTruthy();
    expect(pkg.main).toBe("./extension.js");
    expect(pkg.contributes.languages.length).toBeGreaterThan(0);
    expect(pkg.contributes.grammars.length).toBeGreaterThan(0);
    expect(pkg.activationEvents).toContain("onLanguage:m");
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
