import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { UpstreamSession, parseError } from "../src/proxy.js";

const PORT = 18093;
const BASE_URL = `http://localhost:${PORT}`;

interface SeenRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let upstream: HttpServer;
let seen: SeenRequest[];
let respond: (req: SeenRequest, res: ServerResponse) => void;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const record = { path: req.url ?? "", headers: req.headers, body };
          seen.push(record);
          respond(record, res);
        });
      });
      upstream.listen(PORT, () => resolve());
    }),
);

afterAll(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

beforeEach(() => {
  seen = [];
  respond = (req, res) => {
    const msg = JSON.parse(req.body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.method } }));
  };
});

const session = (authHeader?: string) => new UpstreamSession({ baseUrl: BASE_URL, authHeader });

describe("UpstreamSession", () => {
  it("POSTs the message verbatim to /api/mcp with the Bearer header injected", async () => {
    const request = {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "instances_list", arguments: { nested: { keep: [1, 2, 3] } } },
    };
    const out = await session("Bearer k-123").forward(request);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe("/api/mcp");
    expect(seen[0]!.headers["authorization"]).toBe("Bearer k-123");
    expect(JSON.parse(seen[0]!.body)).toEqual(request);
    expect(out).toEqual([{ jsonrpc: "2.0", id: 7, result: { echo: "tools/call" } }]);
  });

  it("sends no Authorization header when no key is configured", async () => {
    await session(undefined).forward({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(seen[0]!.headers["authorization"]).toBeUndefined();
  });

  it("relays upstream JSON-RPC error responses verbatim", async () => {
    respond = (req, res) => {
      const msg = JSON.parse(req.body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32602, message: "read-only key", data: { scope: "ro" } },
        }),
      );
    };
    const out = await session("Bearer k").forward({ jsonrpc: "2.0", id: 3, method: "tools/call" });
    expect(out).toEqual([
      { jsonrpc: "2.0", id: 3, error: { code: -32602, message: "read-only key", data: { scope: "ro" } } },
    ]);
  });

  it("returns nothing for notifications acknowledged with 202", async () => {
    respond = (_req, res) => {
      res.writeHead(202);
      res.end();
    };
    const out = await session("Bearer k").forward({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(out).toEqual([]);
  });

  it("synthesizes a JSON-RPC error when the upstream returns a non-MCP body", async () => {
    respond = (_req, res) => {
      res.writeHead(401, { "Content-Type": "text/html" });
      res.end("<html>denied</html>");
    };
    const out = await session("Bearer bad").forward({ jsonrpc: "2.0", id: 9, method: "tools/list" });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(9);
    expect((out[0]!.error as { code: number }).code).toBe(-32001);
  });

  it("parses SSE responses into JSON-RPC messages", async () => {
    respond = (req, res) => {
      const msg = JSON.parse(req.body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { via: "sse" } })}\n\n`,
      );
    };
    const out = await session("Bearer k").forward({ jsonrpc: "2.0", id: 4, method: "ping" });
    expect(out).toEqual([{ jsonrpc: "2.0", id: 4, result: { via: "sse" } }]);
  });

  it("captures the negotiated protocol version and echoes it on later requests", async () => {
    respond = (req, res) => {
      const msg = JSON.parse(req.body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          msg.method === "initialize"
            ? { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }
            : { jsonrpc: "2.0", id: msg.id, result: {} },
        ),
      );
    };
    const s = session("Bearer k");
    await s.forward({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
    expect(seen[0]!.headers["mcp-protocol-version"]).toBeUndefined();
    await s.forward({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(seen[1]!.headers["mcp-protocol-version"]).toBe("2025-06-18");
  });

  it("captures an upstream session id and echoes it on later requests", async () => {
    respond = (req, res) => {
      const msg = JSON.parse(req.body);
      res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "sid-42" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
    };
    const s = session("Bearer k");
    await s.forward({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
    await s.forward({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(seen[1]!.headers["mcp-session-id"]).toBe("sid-42");
  });

  it("refuses oversized upstream responses", async () => {
    respond = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 5, result: { blob: "x".repeat(6 * 1024 * 1024) } }));
    };
    const out = await session("Bearer k").forward({ jsonrpc: "2.0", id: 5, method: "tools/call" });
    expect(out).toHaveLength(1);
    expect((out[0]!.error as { message: string }).message).toContain("too large");
  });

  it("synthesizes an internal error when the upstream is unreachable", async () => {
    const s = new UpstreamSession({ baseUrl: "http://localhost:1", authHeader: "Bearer k" });
    const out = await s.forward({ jsonrpc: "2.0", id: 6, method: "ping" });
    expect(out).toHaveLength(1);
    expect((out[0]!.error as { code: number }).code).toBe(-32603);
  });
});

describe("UpstreamSession stale-session recovery", () => {
  // Upstream that issues session ids on initialize and 404s any request
  // carrying an id it no longer knows about.
  const statefulUpstream = (opts: { alwaysStale?: boolean } = {}) => {
    let counter = 0;
    let live: string | undefined;
    respond = (req, res) => {
      const msg = JSON.parse(req.body);
      const sid = req.headers["mcp-session-id"] as string | undefined;
      if (msg.method === "initialize") {
        live = `sid-${++counter}`;
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": live });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }));
        return;
      }
      if (sid && (opts.alwaysStale || sid !== live)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Session not found" } }));
        return;
      }
      if (msg.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.method, sid } }));
    };
    return { expire: () => (live = "server-restarted") };
  };

  it("re-initializes after a 404 on a stale session and retries the request once", async () => {
    const up = statefulUpstream();
    const s = session("Bearer k");
    const initParams = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } };
    await s.forward({ jsonrpc: "2.0", id: 0, method: "initialize", params: initParams });
    up.expire();
    seen = [];
    const out = await s.forward({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(out).toEqual([{ jsonrpc: "2.0", id: 1, result: { echo: "tools/list", sid: "sid-2" } }]);
    const methods = seen.map((r) => JSON.parse(r.body).method);
    expect(methods).toEqual(["tools/list", "initialize", "notifications/initialized", "tools/list"]);
    expect(seen[0]!.headers["mcp-session-id"]).toBe("sid-1");
    expect(seen[1]!.headers["mcp-session-id"]).toBeUndefined();
    expect(JSON.parse(seen[1]!.body).params).toEqual(initParams);
    expect(seen[2]!.headers["mcp-session-id"]).toBe("sid-2");
    expect(seen[3]!.headers["mcp-session-id"]).toBe("sid-2");
  });

  it("does not loop when the retry also 404s", async () => {
    statefulUpstream({ alwaysStale: true });
    const s = session("Bearer k");
    await s.forward({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
    seen = [];
    const out = await s.forward({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(seen.map((r) => JSON.parse(r.body).method)).toEqual([
      "tools/list",
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.error).toBeDefined();
  });

  it("shares one re-init across concurrent 404s and retries all with the new session", async () => {
    const up = statefulUpstream();
    const s = session("Bearer k");
    await s.forward({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
    up.expire();
    seen = [];
    const outs = await Promise.all([1, 2, 3].map((id) => s.forward({ jsonrpc: "2.0", id, method: "tools/list" })));
    // A request issued while the re-init is in flight waits for it.
    const late = await s.forward({ jsonrpc: "2.0", id: 4, method: "ping" });
    const methods = seen.map((r) => JSON.parse(r.body).method);
    expect(methods.filter((m) => m === "initialize")).toHaveLength(1);
    expect(methods.filter((m) => m === "notifications/initialized")).toHaveLength(1);
    outs.forEach((out, i) =>
      expect(out).toEqual([{ jsonrpc: "2.0", id: i + 1, result: { echo: "tools/list", sid: "sid-2" } }]),
    );
    expect(late).toEqual([{ jsonrpc: "2.0", id: 4, result: { echo: "ping", sid: "sid-2" } }]);
    // No request ever went out session-less except the replayed initialize.
    for (const r of seen) {
      if (JSON.parse(r.body).method !== "initialize") expect(r.headers["mcp-session-id"]).toBeDefined();
    }
  });

  it("requests sent mid-re-init wait and carry the new session id", async () => {
    const up = statefulUpstream();
    const s = session("Bearer k");
    await s.forward({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
    up.expire();
    seen = [];
    const first = s.forward({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    // Let the first request's 404 land and the re-init start.
    while (!seen.some((r) => JSON.parse(r.body).method === "initialize")) await new Promise((r) => setTimeout(r, 1));
    const mid = await s.forward({ jsonrpc: "2.0", id: 2, method: "ping" });
    await first;
    expect(mid).toEqual([{ jsonrpc: "2.0", id: 2, result: { echo: "ping", sid: "sid-2" } }]);
    expect(seen.filter((r) => JSON.parse(r.body).method === "initialize")).toHaveLength(1);
  });

  it("surfaces an error and does not retry when re-initialization fails", async () => {
    const up = statefulUpstream();
    const s = session("Bearer k");
    await s.forward({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
    up.expire();
    const inner = respond;
    respond = (req, res) => {
      if (JSON.parse(req.body).method === "initialize") {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("boom");
        return;
      }
      inner(req, res);
    };
    seen = [];
    const outs = await Promise.all([1, 2].map((id) => s.forward({ jsonrpc: "2.0", id, method: "tools/list" })));
    const methods = seen.map((r) => JSON.parse(r.body).method);
    expect(methods).toEqual(["tools/list", "tools/list", "initialize"]);
    outs.forEach((out, i) =>
      expect(out).toEqual([
        {
          jsonrpc: "2.0",
          id: i + 1,
          error: { code: -32603, message: "Upstream session expired and re-initialization failed." },
        },
      ]),
    );
  });

  it("refuses an oversized re-init body and adopts the re-negotiated protocol version", async () => {
    const up = statefulUpstream();
    const s = session("Bearer k");
    await s.forward({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
    up.expire();
    const inner = respond;
    let big = true;
    respond = (req, res) => {
      const msg = JSON.parse(req.body);
      if (msg.method === "initialize") {
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "sid-new" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { protocolVersion: "2025-11-25", pad: big ? "x".repeat(6 * 1024 * 1024) : "" },
          }),
        );
        return;
      }
      if (req.headers["mcp-session-id"] === "sid-new") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
        return;
      }
      inner(req, res);
    };
    const refused = await s.forward({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect((refused[0]!.error as { message: string }).message).toContain("re-initialization failed");
    // Session was dropped; simulate a fresh session id to re-trigger recovery.
    big = false;
    (s as unknown as { sessionId: string }).sessionId = "dead";
    seen = [];
    await s.forward({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const init = seen.find((r) => JSON.parse(r.body).method === "initialize")!;
    expect(init.headers["mcp-protocol-version"]).toBeUndefined();
    expect(seen[seen.length - 1]!.headers["mcp-protocol-version"]).toBe("2025-11-25");
    expect(seen[seen.length - 1]!.headers["mcp-session-id"]).toBe("sid-new");
  });

  it("passes a 404 without a session id through unchanged", async () => {
    respond = (_req, res) => {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html>not found</html>");
    };
    const out = await session("Bearer k").forward({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(seen).toHaveLength(1);
    expect(out).toEqual([
      { jsonrpc: "2.0", id: 2, error: { code: -32600, message: "Upstream returned HTTP 404 with a non-MCP response." } },
    ]);
  });
});

describe("parseError", () => {
  it("produces a -32700 response with a null id", () => {
    expect(parseError()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });
});
