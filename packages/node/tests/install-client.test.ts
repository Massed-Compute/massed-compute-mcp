import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// `os.homedir()` exhibits per-process caching inside vitest workers that
// makes it return a stale value across `beforeEach` resets — even with
// pool:"forks", the second test in the file sees the first test's HOME.
// Mocking the module makes every caller (including the production code) go
// through `currentHomedir`, which we reset per-test.
let currentHomedir = "";
vi.mock("node:os", async () => {
  const real = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...real,
    homedir: () => currentHomedir || real.homedir(),
  };
});

const { runInstallClient } = await import("../src/commands/install-client");
const { writeConfig } = await import("../src/config");

const ENV_BACKUP = { ...process.env };
let tmp: string;
let logs: string[] = [];
let errs: string[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mcp-install-"));
  currentHomedir = tmp;
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".config");
  process.env.APPDATA = path.join(tmp, "AppData", "Roaming");
  // install-client refuses to run if no key is stored, so we pre-seed one.
  writeConfig({ apiKey: "stored-test-key" });
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...args) => { errs.push(args.join(" ")); });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  process.env = { ...ENV_BACKUP };
  vi.restoreAllMocks();
});

describe("install-client (claude-code)", () => {
  const targetFile = () => path.join(process.env.HOME!, ".claude.json");

  it("creates a new config file when none exists", async () => {
    const code = await runInstallClient(["claude-code"]);
    expect(code).toBe(0);
    expect(fs.existsSync(targetFile())).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(targetFile(), "utf8"));
    expect(parsed.mcpServers["massed-compute"]).toEqual({
      command: "massed-compute-mcp",
    });
  });

  it("preserves existing mcpServers entries and adds ours", async () => {
    fs.writeFileSync(
      targetFile(),
      JSON.stringify({
        someUnrelatedKey: "keep me",
        mcpServers: {
          "other-server": { command: "other-cli" },
        },
      }),
    );
    const code = await runInstallClient(["claude-code"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(fs.readFileSync(targetFile(), "utf8"));
    expect(parsed.someUnrelatedKey).toBe("keep me");
    expect(parsed.mcpServers["other-server"]).toEqual({ command: "other-cli" });
    expect(parsed.mcpServers["massed-compute"]).toEqual({
      command: "massed-compute-mcp",
    });
  });

  it("creates a timestamped backup when overwriting", async () => {
    fs.writeFileSync(
      targetFile(),
      JSON.stringify({ mcpServers: { other: { command: "x" } } }),
    );
    await runInstallClient(["claude-code"]);
    const dir = fs.readdirSync(path.dirname(targetFile()));
    const backups = dir.filter((f) => f.startsWith(".claude.json.bak."));
    expect(backups.length).toBe(1);
  });

  it("refuses to overwrite malformed JSON", async () => {
    fs.writeFileSync(targetFile(), "{ not valid json");
    const code = await runInstallClient(["claude-code"]);
    expect(code).toBe(5);
    expect(errs.join("\n")).toMatch(/invalid JSON/);
    // Original file must remain untouched.
    expect(fs.readFileSync(targetFile(), "utf8")).toBe("{ not valid json");
  });

  it("refuses when top-level JSON is not an object", async () => {
    fs.writeFileSync(targetFile(), JSON.stringify(["not", "an", "object"]));
    const code = await runInstallClient(["claude-code"]);
    expect(code).toBe(5);
  });

  it("prints usage when no client id given", async () => {
    const code = await runInstallClient([]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/Supported clients/);
  });

  it("exits with code 2 for unknown client id", async () => {
    const code = await runInstallClient(["does-not-exist"]);
    expect(code).toBe(2);
  });

  it("is a silent no-op when the entry already matches (idempotency)", async () => {
    fs.writeFileSync(
      targetFile(),
      JSON.stringify({
        mcpServers: { "massed-compute": { command: "massed-compute-mcp" } },
      }),
    );
    const code = await runInstallClient(["claude-code"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/Already configured/);
    // No backup file should have been created — that's the whole point.
    const dir = fs.readdirSync(path.dirname(targetFile()));
    expect(dir.filter((f) => f.startsWith(".claude.json.bak."))).toEqual([]);
  });

  it("--yes skips the 'differs, replace?' prompt", async () => {
    fs.writeFileSync(
      targetFile(),
      JSON.stringify({
        mcpServers: {
          "massed-compute": { command: "custom-binary", args: ["--weird"] },
        },
      }),
    );
    const code = await runInstallClient(["claude-code", "--yes"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(fs.readFileSync(targetFile(), "utf8"));
    expect(parsed.mcpServers["massed-compute"]).toEqual({
      command: "massed-compute-mcp",
    });
  });
});

describe("install-client guards", () => {
  it("refuses to run when no API key is stored", async () => {
    // Wipe the seeded config tree under the mocked home dir. The exact
    // subpath varies by platform (XDG vs Library/Application Support vs
    // AppData), so just delete the whole tmp tree and recreate it.
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const code = await runInstallClient(["claude-code"]);
    expect(code).toBe(1);
    expect(errs.join("\n")).toMatch(/init/);
  });
});
