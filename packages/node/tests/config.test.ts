import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// See install-client.test.ts: os.homedir() caches in a way that defeats
// per-test setup. Mocking the module is the only reliable isolation.
let currentHomedir = "";
vi.mock("node:os", async () => {
  const real = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...real,
    homedir: () => currentHomedir || real.homedir(),
  };
});

const {
  configDir,
  configPath,
  readConfig,
  writeConfig,
  deleteConfig,
  resolveAuth,
  DEFAULT_BASE_URL,
} = await import("../src/config");

const ENV_BACKUP = { ...process.env };

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mcp-cfg-"));
  currentHomedir = tmp;
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".config");
  process.env.APPDATA = path.join(tmp, "AppData", "Roaming");
  delete process.env.MASSED_COMPUTE_API_KEY;
  delete process.env.MASSED_COMPUTE_API_BASE_URL;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  process.env = { ...ENV_BACKUP };
  vi.restoreAllMocks();
});

describe("configDir / configPath", () => {
  it("returns an XDG path on Linux", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    expect(configDir()).toBe(path.join(tmp, ".config", "massed-compute"));
    expect(configPath()).toBe(path.join(tmp, ".config", "massed-compute", "config.json"));
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is empty", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    process.env.XDG_CONFIG_HOME = "";
    expect(configDir()).toBe(path.join(tmp, ".config", "massed-compute"));
  });

  it("uses Application Support on macOS", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    expect(configDir()).toBe(
      path.join(tmp, "Library", "Application Support", "massed-compute"),
    );
  });

  it("uses APPDATA on Windows", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    expect(configDir()).toBe(
      path.join(tmp, "AppData", "Roaming", "massed-compute"),
    );
  });
});

describe("readConfig / writeConfig / deleteConfig", () => {
  it("round-trips a config payload", () => {
    writeConfig({ apiKey: "abc.def", baseUrl: "https://staging.example.com" });
    const got = readConfig();
    expect(got?.apiKey).toBe("abc.def");
    expect(got?.baseUrl).toBe("https://staging.example.com");
  });

  it("returns undefined when no file exists", () => {
    expect(readConfig()).toBeUndefined();
  });

  it("returns undefined for malformed JSON instead of throwing", () => {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(configPath(), "not json{", "utf8");
    expect(readConfig()).toBeUndefined();
  });

  it("sets 0600 permissions on POSIX", () => {
    if (process.platform === "win32") return;
    writeConfig({ apiKey: "k" });
    const mode = fs.statSync(configPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("deleteConfig removes the file and reports whether one existed", () => {
    expect(deleteConfig()).toBe(false);
    writeConfig({ apiKey: "k" });
    expect(deleteConfig()).toBe(true);
    expect(fs.existsSync(configPath())).toBe(false);
  });
});

describe("resolveAuth priority chain", () => {
  it("override wins over env and config", () => {
    process.env.MASSED_COMPUTE_API_KEY = "from-env";
    writeConfig({ apiKey: "from-config" });
    const r = resolveAuth({ apiKey: "from-flag" });
    expect(r.apiKey).toBe("from-flag");
    expect(r.source).toBe("override");
  });

  it("env wins over config when no override", () => {
    process.env.MASSED_COMPUTE_API_KEY = "from-env";
    writeConfig({ apiKey: "from-config" });
    const r = resolveAuth();
    expect(r.apiKey).toBe("from-env");
    expect(r.source).toBe("env");
  });

  it("config used when no override or env", () => {
    writeConfig({ apiKey: "from-config" });
    const r = resolveAuth();
    expect(r.apiKey).toBe("from-config");
    expect(r.source).toBe("config");
  });

  it("source is 'none' and apiKey undefined when nothing is set", () => {
    const r = resolveAuth();
    expect(r.apiKey).toBeUndefined();
    expect(r.source).toBe("none");
    expect(r.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("baseUrl env var overrides default but not stored config baseUrl", () => {
    process.env.MASSED_COMPUTE_API_BASE_URL = "https://env.example.com";
    writeConfig({ apiKey: "k", baseUrl: "https://stored.example.com" });
    expect(resolveAuth().baseUrl).toBe("https://stored.example.com");
    deleteConfig();
    expect(resolveAuth().baseUrl).toBe("https://env.example.com");
  });
});
