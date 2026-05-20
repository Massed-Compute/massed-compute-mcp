import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Mock os.homedir() at the module level — vitest fork mode plus os.homedir's
// libuv-side caching are not enough to make process.env.HOME flip reliably.
let currentHomedir = "";
vi.mock("node:os", async () => {
  const real = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...real,
    homedir: () => currentHomedir || real.homedir(),
  };
});

const { runUninstallClient } = await import("../src/commands/uninstall-client");

let tmp: string;
let logs: string[] = [];
let errs: string[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mcp-uninstall-"));
  currentHomedir = tmp;
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...args) => { errs.push(args.join(" ")); });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const claudeFile = () => path.join(tmp, ".claude.json");
const codexFile = () => path.join(tmp, ".codex", "config.toml");

describe("uninstall-client claude-code", () => {
  it("removes the massed-compute entry and preserves siblings", async () => {
    fs.writeFileSync(claudeFile(), JSON.stringify({
      mcpServers: {
        "other-server": { command: "other-cli" },
        "massed-compute": { command: "massed-compute-mcp" },
      },
    }));
    const code = await runUninstallClient(["claude-code"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(fs.readFileSync(claudeFile(), "utf8"));
    expect(parsed.mcpServers["other-server"]).toEqual({ command: "other-cli" });
    expect(parsed.mcpServers["massed-compute"]).toBeUndefined();
  });

  it("creates a timestamped backup before editing", async () => {
    fs.writeFileSync(claudeFile(), JSON.stringify({
      mcpServers: { "massed-compute": { command: "massed-compute-mcp" } },
    }));
    await runUninstallClient(["claude-code"]);
    const backups = fs.readdirSync(tmp).filter((f) => f.startsWith(".claude.json.bak."));
    expect(backups.length).toBe(1);
  });

  it("is a no-op when the file doesn't exist", async () => {
    expect(await runUninstallClient(["claude-code"])).toBe(0);
    expect(fs.existsSync(claudeFile())).toBe(false);
  });

  it("is a no-op when our entry isn't present", async () => {
    fs.writeFileSync(claudeFile(), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    const before = fs.readFileSync(claudeFile(), "utf8");
    expect(await runUninstallClient(["claude-code"])).toBe(0);
    expect(fs.readFileSync(claudeFile(), "utf8")).toBe(before);
  });

  it("refuses to edit malformed JSON", async () => {
    fs.writeFileSync(claudeFile(), "{ not valid json");
    expect(await runUninstallClient(["claude-code"])).toBe(5);
    // original untouched
    expect(fs.readFileSync(claudeFile(), "utf8")).toBe("{ not valid json");
  });
});

describe("uninstall-client codex", () => {
  it("removes the section and leaves the rest", async () => {
    fs.mkdirSync(path.dirname(codexFile()), { recursive: true });
    fs.writeFileSync(
      codexFile(),
      [
        "[some.other.section]",
        'key = "value"',
        "",
        "[mcp_servers.massed-compute]",
        'command = "massed-compute-mcp"',
        "",
        "[trailing.section]",
        'k = "v"',
        "",
      ].join("\n"),
    );
    const code = await runUninstallClient(["codex"]);
    expect(code).toBe(0);
    const result = fs.readFileSync(codexFile(), "utf8");
    expect(result).not.toContain("[mcp_servers.massed-compute]");
    expect(result).toContain("[some.other.section]");
    expect(result).toContain("[trailing.section]");
  });

  it("is a no-op when codex config doesn't exist", async () => {
    expect(await runUninstallClient(["codex"])).toBe(0);
  });
});
