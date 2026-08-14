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
 *   2. An unauthenticated JSON-RPC POST is rejected with 401 *and* carries a
 *      `WWW-Authenticate: Bearer ... resource_metadata=...` challenge. That is
 *      not an outage, it is the contract: vm-marketplace 51389cd (MCDEV-482)
 *      closed the anonymous POST path on purpose, because serving an anonymous
 *      tools/list made Claude and Codex conclude no credentials were needed
 *      and skip OAuth discovery entirely. The status alone is not enough — the
 *      header is what actually starts discovery, so a bare 401 without it
 *      leaves clients with an opaque error and no OAuth flow.
 *
 * Exit codes:
 *   0  endpoint healthy, or transiently unreachable (see below)
 *   2  endpoint answered but the contract is wrong
 *
 * Reachability fails open, but only for failures that are plausibly transient:
 * a connection error, a timeout, or a 5xx/408/429. A nightly job that reds on
 * someone else's downtime trains you to ignore the mail, and then it is worth
 * nothing on the night it is right. Everything else fails closed — a permanent
 * 4xx (a renamed route) or a body that arrives but is not JSON is a contract
 * failure, not an outage, and skipping it would leave the job green forever
 * while both checks quietly stop running.
 */

const HOSTED_URL = process.env.MC_MCP_HOSTED_URL ?? "https://vm.massedcompute.com/api/mcp";
const TIMEOUT_MS = 30_000;

/** Statuses worth retrying tomorrow. Anything else the server means to keep saying. */
const isTransient = (status) => status >= 500 || status === 408 || status === 429;

let body;
try {
  const res = await fetch(HOSTED_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    if (isTransient(res.status)) {
      console.warn(`[smoke] server card returned HTTP ${res.status} — skipping, treating as an outage.`);
      process.exit(0);
    }
    console.error(
      `[smoke] server card returned HTTP ${res.status}. That is not an outage — the public card ` +
        `is meant to stay reachable at ${HOSTED_URL}; check whether the route moved.`,
    );
    process.exit(2);
  }
  body = await res.text();
} catch (err) {
  console.warn(`[smoke] could not reach ${HOSTED_URL}: ${err.message} — skipping, treating as an outage.`);
  process.exit(0);
}

// Parsing happens outside the reachability try on purpose: a body that arrived
// but is not JSON is a broken contract, not a network problem.
let card;
try {
  card = JSON.parse(body);
} catch (err) {
  console.error(
    `[smoke] server card is not JSON (${err.message}): ${body.slice(0, 200)}`,
  );
  process.exit(2);
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
let wwwAuth;
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
    // Per the fetch spec a followed 301/302 rewrites POST to GET, which would
    // land on the server card and read as "anonymous JSON-RPC is open".
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  status = res.status;
  wwwAuth = res.headers.get("www-authenticate") ?? "";
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

if (!/^Bearer\b/.test(wwwAuth) || !wwwAuth.includes("resource_metadata=")) {
  console.error(
    `[smoke] unauthenticated POST was rejected with 401 but the WWW-Authenticate challenge is ` +
      `missing or malformed: ${JSON.stringify(wwwAuth)}. Expected a Bearer challenge carrying ` +
      `resource_metadata= — that header is what starts OAuth discovery (MCDEV-482); without it ` +
      `clients see an opaque 401 and never begin the flow.`,
  );
  process.exit(2);
}
console.log(`[smoke] unauthenticated POST correctly rejected with 401 (${wwwAuth}).`);
