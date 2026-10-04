/**
 * Thin VS Code client for the C3 language server (rsm#27).
 *
 * Same host as the M extension — `packages/server/src/main.ts`.
 */
const { workspace } = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");
const path = require("path");
const fs = require("fs");

let client = null;

function resolveServerPath(context) {
  const cfg = workspace.getConfiguration("c3Lsp");
  const explicit = cfg.get("serverPath");
  if (explicit && fs.existsSync(explicit)) return explicit;
  return path.join(
    context.extensionPath,
    "..",
    "..",
    "packages",
    "server",
    "src",
    "main.ts",
  );
}

function start(context) {
  const bun = workspace.getConfiguration("c3Lsp").get("bunPath") || "bun";
  const serverPath = resolveServerPath(context);
  const serverOptions = {
    command: bun,
    args: [serverPath],
    transport: TransportKind.stdio,
    options: { cwd: path.dirname(serverPath) },
  };
  const clientOptions = {
    documentSelector: [{ scheme: "file", language: "c3" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.{c3,c3i,c3t}"),
    },
  };
  client = new LanguageClient("c3Lsp", "C3 Language Server", serverOptions, clientOptions);
  return client.start();
}

function activate(context) {
  start(context).catch((err) => {
    console.error("c3Lsp: failed to start server", err);
  });
  context.subscriptions.push({
    dispose: () => {
      if (client) return client.stop();
    },
  });
  try {
    const vscode = require("vscode");
    context.subscriptions.push(
      vscode.commands.registerCommand("c3Lsp.restart", async () => {
        if (client) await client.stop();
        await start(context);
      }),
    );
  } catch {
    /* optional */
  }
}

function deactivate() {
  return client ? client.stop() : undefined;
}

module.exports = { activate, deactivate };
