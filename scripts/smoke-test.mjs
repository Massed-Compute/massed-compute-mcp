#!/usr/bin/env node
/**
 * Smoke test for the hosted MCP endpoint this package proxies.
 *
 * The wrapper is a verbatim pass-through, so there is no local tool spec to
 * diff against — the only contract worth checking is that the hosted endpoint
 * at vm.massedcompute.com/api/mcp still answers and still speaks MCP. Run it
 * on a schedule (nightly CI) so an upstream regression surfaces immediately
 * instead of when the first user files an issue.
 *
 * Both checks are deliberately unauthenticated, so this job needs no secret:
 *
 *   1. GET returns the public server card — protocol version, and a non-empty
 *      tool catalog.
 *   2. An unauthenticated JSON-RPC POST is rejected with 401. That is not an
 *      outage, it is the contract: vm-marketplace 51389cd (MCDEV-482) closed
 *      the anonymous POST path on purpose, because serving an anonymous
 *      tools/list made Claude and Codex conclude no credentials were needed
 *      and skip OAuth discovery entirely. If this ever answers 200 again, the
 *      OAuth flow has silently stopped being reachable.
 *
 * Exit codes:
 *   0  endpoint healthy, or unreachable (see below)
 *   2  endpoint answered but the contract is wrong
 *
 * The reachability check fails open: an outage or a network blip warns and
 * exits 0. A nightly job that reds on someone else's downtime trains you to
 * ignore the mail, and then it is worth nothing on the night it is right.
 */

const HOSTED_URL = process.env.MC_MCP_HOSTED_URL ?? "https://vm.massedcompute.com/api/mcp";
const TIMEOUT_MS = 30_000;

let card;
try {
  const res = await fetch(HOSTED_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    console.warn(`[smoke] server card returned HTTP ${res.status} — skipping, treating as an outage.`);
    process.exit(0);
  }
  card = await res.json();
} catch (err) {
  console.warn(`[smoke] could not reach ${HOSTED_URL}: ${err.message} — skipping, treating as an outage.`);
  process.exit(0);
}

const protocolVersion = card?.protocol?.version;
if (typeof protocolVersion !== "string") {
  console.error(`[smoke] server card carries no protocol.version: ${JSON.stringify(card)}`);
  process.exit(2);
}

const tools = card?.tools;
if (!Array.isArray(tools) || tools.length === 0) {
  console.error(`[smoke] server card lists no tools: ${JSON.stringify(card)}`);
  process.exit(2);
}
console.log(
  `[smoke] server card ok (protocol ${protocolVersion}, server ${card.server?.name ?? "?"}, ${tools.length} tools): ` +
    tools.map((t) => t.name).join(", "),
);

// The POST path must stay closed to anonymous callers — see the note above.
let status;
try {
  const res = await fetch(HOSTED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: "massed-compute-mcp-smoke", version: "0.0.0" },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  status = res.status;
} catch (err) {
  console.warn(`[smoke] could not probe the POST path: ${err.message} — skipping that check.`);
  process.exit(0);
}

if (status !== 401) {
  console.error(
    `[smoke] unauthenticated POST answered HTTP ${status}, expected 401. ` +
      `Anonymous JSON-RPC is meant to be closed (MCDEV-482); if it is open again, ` +
      `MCP clients will skip OAuth discovery.`,
  );
  process.exit(2);
}
console.log("[smoke] unauthenticated POST correctly rejected with 401.");
