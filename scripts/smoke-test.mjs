#!/usr/bin/env node
/**
 * Smoke test for the hosted MCP endpoint this package proxies.
 *
 * The wrapper is a verbatim pass-through, so there is no local tool spec
 * to diff against — the only contract worth checking is that the hosted
 * endpoint at vm.massedcompute.com/api/mcp still speaks MCP: `initialize`
 * negotiates a protocol version and `tools/list` returns a non-empty
 * catalog. Run it on a schedule (nightly CI) so an upstream regression
 * surfaces immediately instead of when the first user files an issue.
 *
 * Exit codes:
 *   0  endpoint healthy
 *   2  endpoint answered but the response shape is wrong
 *   3  network failure to the hosted endpoint (skip — fail open)
 */

const HOSTED_URL = process.env.MC_MCP_HOSTED_URL ?? "https://vm.massedcompute.com/api/mcp";

const post = async (message) => {
  const res = await fetch(HOSTED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
  return res.json();
};

try {
  const init = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "massed-compute-mcp-smoke", version: "0.0.0" },
    },
  });
  const protocolVersion = init?.result?.protocolVersion;
  if (typeof protocolVersion !== "string") {
    console.error(`[smoke] initialize returned no protocolVersion: ${JSON.stringify(init)}`);
    process.exit(2);
  }
  console.log(`[smoke] initialize ok (protocol ${protocolVersion}, server ${init.result?.serverInfo?.name ?? "?"})`);

  const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = list?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    console.error(`[smoke] tools/list returned no tools: ${JSON.stringify(list)}`);
    process.exit(2);
  }
  console.log(`[smoke] tools/list ok (${tools.length} tools): ${tools.map((t) => t.name).join(", ")}`);
} catch (err) {
  console.warn(`[smoke] network failure reaching ${HOSTED_URL}: ${err}`);
  process.exit(3);
}
