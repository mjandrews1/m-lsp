/**
 * m-lsp entry — wires the language cores into the shared host and
 * listens on stdio.  `m-lsp` and `c3-lsp` are the same binary with a
 * different default plugin set; v1 starts both.
 */
import { mPlugin } from "../m-core/src/index";
import { c3Plugin } from "../c3-core/src/index";
import { listen } from "./index";

listen({
  plugins: [mPlugin, c3Plugin],
  name: "m-lsp",
  version: "0.1.0",
});
