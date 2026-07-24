import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const UPSTREAM_PORT = 18082;

interface SeenRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let upstream: HttpServer;
let seen: SeenRequest[] = [];

// Default: behave like the hosted endpoint — echo a result for requests,
// 202 for notifications.
const mcpHandler = (req: IncomingMessage, res: ServerResponse): void => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ path: req.url ?? "", headers: req.headers, body });
    const msg = JSON.parse(body);
    if (msg.id === undefined || msg.id === null) {
      res.writeHead(202);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echoedMethod: msg.method } }));
  });
};

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      upstream = createServer(mcpHandler);
      upstream.listen(UPSTREAM_PORT, () => resolve());
    }),
);

afterAll(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

afterEach(() => {
  seen = [];
});

// Pointing HOME, XDG_CONFIG_HOME, and APPDATA at an empty temp dir prevents
// the test from picking up a real `massed-compute init` config on the
// developer's machine, which would otherwise mask the "no key configured"
// exit-code assertion.
const isolatedHomeEnv = (): NodeJS.ProcessEnv => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mcp-test-"));
  return {
    HOME: tmp,
    XDG_CONFIG_HOME: path.join(tmp, ".config"),
    APPDATA: path.join(tmp, "AppData", "Roaming"),
    USERPROFILE: tmp,
  };
};

const spawnCli = (env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams =>
  spawn("node", ["dist/cli.js", "server"], {
    env: { ...process.env, ...isolatedHomeEnv(), ...env },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

const readLines = (proc: ChildProcessWithoutNullStreams, count: number): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const lines: string[] = [];
    let buffer = "";
    const timer = setTimeout(
      () =>
        reject(
          new Error(`timed out waiting for ${count} stdout lines; got ${lines.length}: ${lines.join(" | ")}`),
        ),
      5000,
    );
    proc.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        lines.push(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        if (lines.length >= count) {
          clearTimeout(timer);
          resolve(lines);
          return;
        }
      }
    });
  });

describe("cli `server` subcommand (stdio ↔ streamable-HTTP pass-through)", () => {
  it("exits non-zero when no key is supplied via env or config", async () => {
    const proc = spawnCli({ MASSED_COMPUTE_API_KEY: "" });
    const exitCode = await new Promise<number | null>((resolve) =>
      proc.on("exit", (code) => resolve(code)),
    );
    expect(exitCode).not.toBe(0);
  });

  it("forwards every message verbatim to /api/mcp with the Bearer header and relays responses", async () => {
    const proc = spawnCli({
      MASSED_COMPUTE_API_KEY: "test-key-123",
      MASSED_COMPUTE_API_BASE_URL: `http://localhost:${UPSTREAM_PORT}`,
    });

    const initialize = {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.1" },
      },
    };
    proc.stdin.write(JSON.stringify(initialize) + "\n");
    const [initLine] = await readLines(proc, 1);
    expect(JSON.parse(initLine!)).toEqual({
      jsonrpc: "2.0",
      id: 0,
      result: { echoedMethod: "initialize" },
    });

    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const toolsCall = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "gpu_inventory_list", arguments: { deep: { nested: true } } },
    };
    proc.stdin.write(JSON.stringify(toolsCall) + "\n");
    const [callLine] = await readLines(proc, 1);
    expect(JSON.parse(callLine!)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { echoedMethod: "tools/call" },
    });

    // The upstream saw all three messages, byte-equivalent, on /api/mcp,
    // each carrying the injected Bearer header. The notification and the
    // tools/call are forwarded concurrently, so poll for arrival and
    // match by content rather than order.
    const deadline = Date.now() + 5000;
    while (seen.length < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(seen).toHaveLength(3);
    for (const req of seen) {
      expect(req.path).toBe("/api/mcp");
      expect(req.headers["authorization"]).toBe("Bearer test-key-123");
    }
    const bodies = seen.map((r) => JSON.parse(r.body));
    expect(bodies).toContainEqual(initialize);
    expect(bodies).toContainEqual({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(bodies).toContainEqual(toolsCall);

    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => proc.on("exit", () => resolve()));
  });

  it("answers malformed input with a JSON-RPC parse error instead of crashing", async () => {
    const proc = spawnCli({
      MASSED_COMPUTE_API_KEY: "test-key-123",
      MASSED_COMPUTE_API_BASE_URL: `http://localhost:${UPSTREAM_PORT}`,
    });
    proc.stdin.write("this is not json\n");
    const [line] = await readLines(proc, 1);
    expect(JSON.parse(line!)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => proc.on("exit", () => resolve()));
  });
});
