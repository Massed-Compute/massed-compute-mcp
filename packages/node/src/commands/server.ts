/**
 * `massed-compute-mcp server` (also the default command when no subcommand
 * is given) — a stdio ↔ streamable-HTTP bridge to the hosted MCP endpoint.
 * This is what MCP clients actually spawn; everything else in the CLI is
 * configuration around it.
 *
 * Every JSON-RPC message on stdin is forwarded verbatim to
 * `<baseUrl>/api/mcp` with the resolved API key injected as a Bearer
 * header; upstream responses are written verbatim to stdout. The upstream
 * owns the tool catalog, schemas, scope enforcement, and redaction.
 *
 * Key resolution uses the shared `resolveAuth` chain (override / env /
 * config). If no key is available, we fail with a pointer to `init` rather
 * than crashing with a generic 401 mid-tool-call.
 */

import { createInterface } from "node:readline";
import { UpstreamSession, parseError, type JsonRpcMessage } from "../proxy.js";
import { resolveAuth } from "../config.js";

export const runServer = async (_argv: string[]): Promise<number> => {
  const auth = resolveAuth();
  if (!auth.apiKey) {
    process.stderr.write(
      "[mcp] No API key configured. Run `massed-compute-mcp init`, or set MASSED_COMPUTE_API_KEY.\n",
    );
    return 1;
  }

  const session = new UpstreamSession({
    baseUrl: auth.baseUrl,
    authHeader: `Bearer ${auth.apiKey}`,
  });

  const write = (msg: JsonRpcMessage): void => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };

  const inFlight = new Set<Promise<void>>();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(trimmed);
    } catch {
      write(parseError());
      return;
    }
    // Forward concurrently — a slow tools/call must not block pings.
    // JSON-RPC responses are matched by id, so interleaving is fine.
    const task = session
      .forward(message)
      .then((responses) => responses.forEach(write))
      .catch((err) => {
        process.stderr.write(`[mcp] unexpected proxy error: ${err}\n`);
      })
      .finally(() => {
        inFlight.delete(task);
      });
    inFlight.add(task);
  });

  await new Promise<void>((resolve) => rl.on("close", resolve));
  await Promise.all(inFlight);
  return 0;
};
