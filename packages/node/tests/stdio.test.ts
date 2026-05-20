import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const UPSTREAM_PORT = 18082;

let upstream: HttpServer;
let currentHandler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
  res.writeHead(404);
  res.end();
};

const startUpstream = (): Promise<void> =>
  new Promise((resolve) => {
    upstream = createServer((req, res) => currentHandler(req, res));
    upstream.listen(UPSTREAM_PORT, () => resolve());
  });

const stopUpstream = (): Promise<void> =>
  new Promise((resolve) => upstream.close(() => resolve()));

beforeAll(async () => {
  await startUpstream();
});

afterAll(async () => {
  await stopUpstream();
});

afterEach(() => {
  currentHandler = (_req, res) => {
    res.writeHead(404);
    res.end();
  };
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

describe("cli `server` subcommand (stdio MCP server)", () => {
  it("exits non-zero when no key is supplied via env or config", async () => {
    const proc = spawnCli({ MASSED_COMPUTE_API_KEY: "" });
    const exitCode = await new Promise<number | null>((resolve) =>
      proc.on("exit", (code) => resolve(code)),
    );
    expect(exitCode).not.toBe(0);
  });

  it("forwards the API key as the Authorization header on every tool call", async () => {
    let resolveAuth: (value: string | undefined) => void;
    const authPromise = new Promise<string | undefined>((resolve) => {
      resolveAuth = resolve;
    });

    currentHandler = (req, res) => {
      resolveAuth(req.headers["authorization"]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ gpu_inventory: [{ name: "A100" }] }));
    };

    const proc = spawnCli({
      MASSED_COMPUTE_API_KEY: "test-key-123",
      MASSED_COMPUTE_API_BASE_URL: `http://localhost:${UPSTREAM_PORT}`,
    });

    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      }) + "\n",
    );
    proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "gpu_inventory_list", arguments: {} },
      }) + "\n",
    );

    const observedAuth = await Promise.race([
      authPromise,
      new Promise<string | undefined>((_, reject) =>
        setTimeout(() => reject(new Error("upstream never received the call")), 5000),
      ),
    ]);
    expect(observedAuth).toBe("Bearer test-key-123");

    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => proc.on("exit", () => resolve()));
  });
});
