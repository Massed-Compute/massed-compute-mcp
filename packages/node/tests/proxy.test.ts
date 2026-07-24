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

describe("parseError", () => {
  it("produces a -32700 response with a null id", () => {
    expect(parseError()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });
});
