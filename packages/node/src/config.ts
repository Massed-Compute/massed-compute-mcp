import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Cross-platform config-file management for the stored API key.
 *
 * Locations follow each OS's documented convention so the file ends up where
 * users expect tools to keep credentials:
 *
 * - Linux:   $XDG_CONFIG_HOME/massed-compute/config.json  (defaults to ~/.config/...)
 * - macOS:   ~/Library/Application Support/massed-compute/config.json
 * - Windows: %APPDATA%/massed-compute/config.json         (typically C:\Users\<u>\AppData\Roaming\)
 *
 * On POSIX platforms the file is written with mode 0600 — readable only by
 * the owning user, matching the security posture of ~/.aws/credentials and
 * ~/.kube/config. Windows has no equivalent chmod; on those platforms we
 * rely on the OS user-profile ACL inherited from %APPDATA%.
 */

export interface StoredConfig {
  apiKey: string;
  baseUrl?: string;
  validatedAt?: string;
}

export const APP_NAME = "massed-compute";
export const CONFIG_FILENAME = "config.json";
export const DEFAULT_BASE_URL = "https://vm.massedcompute.com";
export const ENV_API_KEY = "MASSED_COMPUTE_API_KEY";
export const ENV_BASE_URL = "MASSED_COMPUTE_API_BASE_URL";

export const configDir = (): string => {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, APP_NAME);
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_NAME);
  }
  // Linux / *BSD: honor XDG_CONFIG_HOME per the spec.
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(home, ".config");
  return path.join(base, APP_NAME);
};

export const configPath = (): string => path.join(configDir(), CONFIG_FILENAME);

export const readConfig = (): StoredConfig | undefined => {
  const file = configPath();
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.apiKey === "string") {
      return parsed as StoredConfig;
    }
    return undefined;
  } catch {
    // Malformed config — surfaced to the caller as "no config", with the
    // intent that the user is told to re-run `init`. We deliberately do not
    // try to repair the file or silently overwrite it.
    return undefined;
  }
};

export const writeConfig = (config: StoredConfig): void => {
  const dir = configDir();
  // 0700 on the dir matches ~/.aws and ~/.kube; world-readable directory
  // listings can leak the fact that a credential exists even if the file
  // itself is 0600. mkdirSync ignores the mode arg on existing dirs, so
  // this is best-effort for fresh installs.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = configPath();
  // Atomic write: open with O_NOFOLLOW + fsync + rename.
  //   - O_NOFOLLOW: refuse to follow a symlink at the temp path. Closes
  //     the (low-likelihood, since the dir is 0700) symlink-race window
  //     where an attacker pre-creates a symlink that would redirect our
  //     write elsewhere on disk.
  //   - fsync: flush the contents to disk before the rename promotes the
  //     temp file. Without it, a power loss between write and rename
  //     could promote a zero-byte file as the new credential.
  const tmp = `${file}.tmp-${process.pid}`;
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC |
    (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW);
  const fd = fs.openSync(tmp, flags, 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(config, null, 2) + "\n", null, "utf8");
    try {
      fs.fsyncSync(fd);
    } catch {
      // fsync can fail on filesystems that don't support it (network
      // mounts, etc.). The write itself still landed in kernel caches.
    }
  } finally {
    fs.closeSync(fd);
  }
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      // chmod failing on POSIX is unusual but not fatal.
    }
  }
  fs.renameSync(tmp, file);
};

export const deleteConfig = (): boolean => {
  const file = configPath();
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
};

/**
 * Resolve the active API key + base URL from (in priority order):
 *   1. explicit override passed by the caller (e.g. a --token CLI flag)
 *   2. environment variables MASSED_COMPUTE_API_KEY / MASSED_COMPUTE_API_BASE_URL
 *   3. the stored config file at `configPath()`
 *
 * Returns undefined for `apiKey` if no source supplied one — callers should
 * fail loudly with a pointer to `massed-compute-mcp init`.
 */
export interface ResolvedAuth {
  apiKey?: string;
  baseUrl: string;
  source: "override" | "env" | "config" | "none";
}

// CLI flags (--token / --base-url) parsed by cli.ts populate this; everything
// downstream calls resolveAuth() and gets the right precedence without each
// subcommand needing to know about argv.
let cliOverride: { apiKey?: string; baseUrl?: string } | undefined;

export const setCliOverride = (override: { apiKey?: string; baseUrl?: string }): void => {
  cliOverride = override;
};

export const getCliOverride = (): { apiKey?: string; baseUrl?: string } | undefined => cliOverride;

export const resolveAuth = (override?: { apiKey?: string; baseUrl?: string }): ResolvedAuth => {
  const effective = override ?? cliOverride;
  if (effective?.apiKey) {
    return {
      apiKey: effective.apiKey,
      baseUrl: effective.baseUrl ?? process.env[ENV_BASE_URL] ?? DEFAULT_BASE_URL,
      source: "override",
    };
  }
  const envKey = process.env[ENV_API_KEY];
  if (envKey && envKey.length > 0) {
    return {
      apiKey: envKey,
      baseUrl: process.env[ENV_BASE_URL] ?? DEFAULT_BASE_URL,
      source: "env",
    };
  }
  const stored = readConfig();
  if (stored?.apiKey) {
    return {
      apiKey: stored.apiKey,
      baseUrl: stored.baseUrl ?? process.env[ENV_BASE_URL] ?? DEFAULT_BASE_URL,
      source: "config",
    };
  }
  return {
    baseUrl: process.env[ENV_BASE_URL] ?? DEFAULT_BASE_URL,
    source: "none",
  };
};
