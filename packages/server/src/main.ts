/**
 * m-lsp entry — wires the M language core into the shared host and
 * listens on stdio.
 */
import { mPlugin } from "../m-core/src/index";
import { listen } from "./index";

listen({
  plugins: [mPlugin],
  name: "m-lsp",
  version: "0.1.0",
});
