/**
 * Thin VS Code client for the M language server (rsm#27).
 *
 * Spawns the shared m-lsp host (`packages/server/src/main.ts`) over
 * stdio.  All language smarts live in `packages/m-core` + the host —
 * this file is only lifecycle plumbing.
 */
const { workspace } = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");
const path = require("path");
const fs = require("fs");

let client = null;

function resolveServerPath(context) {
  const cfg = workspace.getConfiguration("mLsp");
  const explicit = cfg.get("serverPath");
  if (explicit && fs.existsSync(explicit)) return explicit;
  // repo checkout: editors/vscode-m -> repo root -> packages/server/src/main.ts
  const bundled = path.join(
    context.extensionPath,
    "..",
    "..",
    "packages",
    "server",
    "src",
    "main.ts",
  );
  return bundled;
}

function start(context) {
  const bun = workspace.getConfiguration("mLsp").get("bunPath") || "bun";
  const serverPath = resolveServerPath(context);
  const serverOptions = {
    command: bun,
    args: [serverPath],
    transport: TransportKind.stdio,
    options: { cwd: path.dirname(serverPath) },
  };
  const clientOptions = {
    documentSelector: [{ scheme: "file", language: "m" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.{m,mumps}"),
    },
  };
  client = new LanguageClient("mLsp", "M Language Server", serverOptions, clientOptions);
  return client.start();
}

function activate(context) {
  start(context).catch((err) => {
    console.error("mLsp: failed to start server", err);
  });
  context.subscriptions.push({
    dispose: () => {
      if (client) return client.stop();
    },
  });
  try {
    const vscode = require("vscode");
    context.subscriptions.push(
      vscode.commands.registerCommand("mLsp.restart", async () => {
        if (client) await client.stop();
        await start(context);
      }),
    );
  } catch {
    /* command registration optional during tests */
  }
}

function deactivate() {
  return client ? client.stop() : undefined;
}

module.exports = { activate, deactivate };
