/**
 * `massed-compute-mcp install-client <client>`
 *
 * Splices an MCP server entry into a supported client's config file so the
 * user doesn't have to hand-edit JSON. Writes atomically (temp file +
 * rename) and creates a timestamped backup of any pre-existing config so
 * the change is always reversible.
 *
 * The entry intentionally has no Authorization header — the binary reads
 * its key from our 0600 config file at runtime, so the secret never gets
 * copied into the MCP client's own config (which is often readable by
 * other tools on the machine).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promptYesNo } from "../prompt.js";
import { readConfig } from "../config.js";

type ClientId = "claude-code" | "cursor" | "claude-desktop" | "codex";

interface ClientTarget {
  id: ClientId;
  displayName: string;
  configPath: string;
  /**
   * Determines how install-client patches the file. JSON clients all share
   * the same `mcpServers` top-level key shape. Codex uses TOML with a
   * `[mcp_servers.<name>]` section; we handle that with a tiny line-based
   * appender rather than pulling in a TOML parser dep.
   */
  format: "json" | "toml-section";
  mcpServersKey?: string;
}

const claudeDesktopPath = (): string => {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  }
  // Claude Desktop is currently macOS- and Windows-only; on Linux we point at a
  // best-guess XDG path so the user can still inspect what we would have done.
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
};

// Computed lazily so HOME / APPDATA changes (most often: tests setting them
// to a temp dir) are picked up at call time rather than baked in at module
// load.
const targets = (): Record<ClientId, ClientTarget> => {
  const home = os.homedir();
  return {
    "claude-code": {
      id: "claude-code",
      displayName: `Claude Code (${path.join(home, ".claude.json")})`,
      configPath: path.join(home, ".claude.json"),
      format: "json",
      mcpServersKey: "mcpServers",
    },
    cursor: {
      id: "cursor",
      displayName: `Cursor (${path.join(home, ".cursor", "mcp.json")})`,
      configPath: path.join(home, ".cursor", "mcp.json"),
      format: "json",
      mcpServersKey: "mcpServers",
    },
    "claude-desktop": {
      id: "claude-desktop",
      displayName: `Claude Desktop (${claudeDesktopPath()})`,
      configPath: claudeDesktopPath(),
      format: "json",
      mcpServersKey: "mcpServers",
    },
    codex: {
      id: "codex",
      displayName: `Codex (${path.join(home, ".codex", "config.toml")})`,
      configPath: path.join(home, ".codex", "config.toml"),
      format: "toml-section",
    },
  };
};

interface PlainObject {
  [key: string]: unknown;
}
const isPlainObject = (v: unknown): v is PlainObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const SERVER_ENTRY = {
  command: "massed-compute-mcp",
};
const SERVER_KEY = "massed-compute";

const printUsage = () => {
  console.log("Usage: massed-compute-mcp install-client <client>");
  console.log("");
  console.log("Supported clients:");
  for (const t of Object.values(targets())) {
    console.log(`  ${t.id.padEnd(16)} ${t.displayName}`);
  }
};

const backupTimestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

const CODEX_SECTION = `[mcp_servers.${SERVER_KEY}]\ncommand = "massed-compute-mcp"\n`;
const CODEX_HEADER = `[mcp_servers.${SERVER_KEY}]`;

// Wired through from runInstallClient; lets installCodex skip the prompt
// when --yes was passed without threading the flag through every helper.
let codexInstallYes = false;

const installCodex = async (file: string): Promise<number> => {
  const dir = path.dirname(file);
  const exists = fs.existsSync(file);

  if (exists) {
    const raw = fs.readFileSync(file, "utf8");
    if (raw.includes(CODEX_HEADER)) {
      // Idempotency: if the existing section matches what we'd write
      // byte-for-byte, exit silently without creating a backup. Avoids
      // backup-pile growth on repeated runs.
      if (raw.includes(CODEX_SECTION)) {
        console.log(`Already configured: \`${CODEX_HEADER}\` matches expected content. No change.`);
        return 0;
      }
      if (!codexInstallYes) {
        const replace = await promptYesNo(
          `A \`${CODEX_HEADER}\` section already exists in ${file} but differs from what we'd write. Replace it?`,
          false,
        );
        if (!replace) {
          console.log("Aborted.");
          return 0;
        }
      }
      // Strip the existing section before re-appending.
      const lines = raw.split(/\r?\n/);
      const out: string[] = [];
      let skipping = false;
      for (const line of lines) {
        if (!skipping && line.trim() === CODEX_HEADER) {
          skipping = true;
          continue;
        }
        if (skipping && /^\[.+\]\s*$/.test(line.trim())) {
          skipping = false;
        }
        if (!skipping) out.push(line);
      }
      const backup = `${file}.bak.${backupTimestamp()}`;
      fs.copyFileSync(file, backup);
      console.log(`Backed up existing config to ${backup}`);
      const merged =
        out.join("\n").replace(/\n+$/, "") + "\n\n" + CODEX_SECTION;
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, merged, "utf8");
      fs.renameSync(tmp, file);
    } else {
      const backup = `${file}.bak.${backupTimestamp()}`;
      fs.copyFileSync(file, backup);
      console.log(`Backed up existing config to ${backup}`);
      const merged = raw.replace(/\n+$/, "") + "\n\n" + CODEX_SECTION;
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, merged, "utf8");
      fs.renameSync(tmp, file);
    }
  } else {
    console.log(`${file} does not exist — will create.`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, CODEX_SECTION, "utf8");
  }
  console.log(`Wrote \`${CODEX_HEADER}\` to ${file}.`);
  console.log("");
  console.log("Restart Codex to pick up the change.");
  return 0;
};

export const runInstallClient = async (argv: string[]): Promise<number> => {
  const TARGETS = targets();
  // Identify the client id from positional args, ignoring flags.
  const positional = argv.filter((a) => !a.startsWith("-"));
  const clientArg = positional[0];
  const yes = argv.some((a) => a === "--yes" || a === "--force" || a === "-y");
  codexInstallYes = yes;
  if (!clientArg || !(clientArg in TARGETS)) {
    printUsage();
    return clientArg ? 2 : 0;
  }

  if (!readConfig()?.apiKey) {
    console.error("No stored API key found. Run `massed-compute-mcp init` first so the wiring is useful.");
    return 1;
  }

  const target = TARGETS[clientArg as ClientId];
  const file = target.configPath;
  const dir = path.dirname(file);

  console.log(`Target: ${target.displayName}`);

  if (target.format === "toml-section") {
    return installCodex(file);
  }

  let existing: unknown = {};
  if (fs.existsSync(file)) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (err) {
      console.error(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
      return 4;
    }
    if (raw.trim().length > 0) {
      try {
        existing = JSON.parse(raw);
      } catch {
        console.error(`Refusing to overwrite — ${file} contains invalid JSON.`);
        console.error("Fix or move the file aside, then re-run.");
        return 5;
      }
    }
    if (!isPlainObject(existing)) {
      console.error(`Refusing to overwrite — ${file} top level is not a JSON object.`);
      return 5;
    }
    const servers = (existing as PlainObject)[(target.mcpServersKey ?? "mcpServers")];
    if (isPlainObject(servers) && SERVER_KEY in servers) {
      // Idempotency: if the existing entry deep-equals what we'd write,
      // exit silently without backup / rewrite. Prevents .bak files from
      // accumulating on repeated runs.
      const existingEntry = (servers as PlainObject)[SERVER_KEY];
      if (JSON.stringify(existingEntry) === JSON.stringify(SERVER_ENTRY)) {
        console.log(`Already configured: "${SERVER_KEY}" entry in ${file} matches expected. No change.`);
        return 0;
      }
      if (!yes) {
        const replace = await promptYesNo(
          `An MCP entry named "${SERVER_KEY}" already exists in ${file} but differs from what we'd write. Replace it?`,
          false,
        );
        if (!replace) {
          console.log("Aborted.");
          return 0;
        }
      }
    }
    const backup = `${file}.bak.${backupTimestamp()}`;
    fs.copyFileSync(file, backup);
    console.log(`Backed up existing config to ${backup}`);
  } else {
    console.log(`${file} does not exist — will create.`);
    fs.mkdirSync(dir, { recursive: true });
  }

  const next = isPlainObject(existing) ? { ...(existing as PlainObject) } : {};
  const servers = isPlainObject(next[(target.mcpServersKey ?? "mcpServers")])
    ? { ...(next[(target.mcpServersKey ?? "mcpServers")] as PlainObject) }
    : {};
  servers[SERVER_KEY] = SERVER_ENTRY;
  next[(target.mcpServersKey ?? "mcpServers")] = servers;

  // Atomic write to survive a crash mid-rewrite.
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);

  console.log(`Wrote MCP server entry "${SERVER_KEY}" → command "massed-compute-mcp".`);
  console.log("");
  console.log("Restart your MCP client to pick up the change.");
  return 0;
};
