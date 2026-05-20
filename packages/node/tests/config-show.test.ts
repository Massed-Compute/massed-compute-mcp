import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let currentHomedir = "";
vi.mock("node:os", async () => {
  const real = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...real,
    homedir: () => currentHomedir || real.homedir(),
  };
});

const { runConfigShow } = await import("../src/commands/config-show");
const { writeConfig } = await import("../src/config");

let tmp: string;
let logs: string[];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mcp-cfgshow-"));
  currentHomedir = tmp;
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".config");
  process.env.APPDATA = path.join(tmp, "AppData", "Roaming");
  delete process.env.MASSED_COMPUTE_API_KEY;
  delete process.env.MASSED_COMPUTE_API_BASE_URL;
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("config show", () => {
  it("reports 'no' and points at init when nothing is stored", async () => {
    const code = await runConfigShow([]);
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toMatch(/Exists:\s+no/);
    expect(out).toMatch(/massed-compute-mcp init/);
  });

  it("masks the stored key and never prints it raw", async () => {
    writeConfig({ apiKey: "uuid-prefix.thirty-char-secret-here" });
    await runConfigShow([]);
    const out = logs.join("\n");
    expect(out).toMatch(/Exists:\s+yes/);
    expect(out).not.toContain("thirty-char-secret-here");
    expect(out).toMatch(/uuid…here/);
  });

  it("reports the active resolution source = config when only the file is set", async () => {
    writeConfig({ apiKey: "key1.secret2" });
    await runConfigShow([]);
    expect(logs.join("\n")).toMatch(/source:\s+config/);
  });

  it("reports source = env when the env var is set", async () => {
    process.env.MASSED_COMPUTE_API_KEY = "envkey.envsecret";
    await runConfigShow([]);
    expect(logs.join("\n")).toMatch(/source:\s+env/);
  });
});
