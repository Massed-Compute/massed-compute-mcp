/**
 * `massed-compute-mcp uninstall-client <client>`
 *
 * Inverse of `install-client`: removes the massed-compute entry from a
 * supported client's MCP config. Creates a timestamped backup first so
 * the change is always reversible, just like install-client.
 *
 * Does NOT delete the config file itself, even if our entry was the only
 * one — the user's other settings stay intact.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type ClientId = "claude-code" | "cursor" | "claude-desktop" | "codex";

interface ClientTarget {
  id: ClientId;
  displayName: string;
  configPath: string;
  format: "json" | "toml-snippet";
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
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
};

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
      format: "toml-snippet",
    },
  };
};

interface PlainObject {
  [key: string]: unknown;
}
const isPlainObject = (v: unknown): v is PlainObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const SERVER_KEY = "massed-compute";

const backupTimestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

const printUsage = () => {
  console.log("Usage: massed-compute-mcp uninstall-client <client>");
  console.log("");
  console.log("Supported clients:");
  for (const t of Object.values(targets())) {
    console.log(`  ${t.id.padEnd(16)} ${t.displayName}`);
  }
};

const removeFromJson = (file: string, mcpServersKey: string): number => {
  if (!fs.existsSync(file)) {
    console.log(`${file} does not exist — nothing to remove.`);
    return 0;
  }
  const raw = fs.readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`Refusing to edit — ${file} contains invalid JSON.`);
    return 5;
  }
  if (!isPlainObject(parsed)) {
    console.error(`Refusing to edit — ${file} top level is not a JSON object.`);
    return 5;
  }
  const servers = parsed[mcpServersKey];
  if (!isPlainObject(servers) || !(SERVER_KEY in servers)) {
    console.log(`No "${SERVER_KEY}" entry in ${file}; nothing to do.`);
    return 0;
  }
  const backup = `${file}.bak.${backupTimestamp()}`;
  fs.copyFileSync(file, backup);
  console.log(`Backed up ${file} → ${backup}`);

  const nextServers: PlainObject = { ...servers };
  delete nextServers[SERVER_KEY];
  const next: PlainObject = { ...parsed, [mcpServersKey]: nextServers };

  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  console.log(`Removed "${SERVER_KEY}" entry from ${file}.`);
  return 0;
};

/**
 * Codex's config is TOML. Rather than pulling in a TOML parser (and its
 * supply-chain risk), we do a line-based removal of the
 * `[mcp_servers.massed-compute]` section and its body up to the next
 * `[...]` header. This is safe for our entries (we only ever write
 * canonical shapes) but is best-effort for hand-edited files.
 */
const removeFromCodex = (file: string): number => {
  if (!fs.existsSync(file)) {
    console.log(`${file} does not exist — nothing to remove.`);
    return 0;
  }
  const raw = fs.readFileSync(file, "utf8");
  const sectionHeader = `[mcp_servers.${SERVER_KEY}]`;
  if (!raw.includes(sectionHeader)) {
    console.log(`No \`${sectionHeader}\` section in ${file}; nothing to do.`);
    return 0;
  }
  const backup = `${file}.bak.${backupTimestamp()}`;
  fs.copyFileSync(file, backup);
  console.log(`Backed up ${file} → ${backup}`);

  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!skipping && trimmed === sectionHeader) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[.+\]\s*$/.test(trimmed)) {
      skipping = false; // entered next section
    }
    if (!skipping) out.push(line);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, out.join("\n"), "utf8");
  fs.renameSync(tmp, file);
  console.log(`Removed \`${sectionHeader}\` from ${file}.`);
  return 0;
};

export const runUninstallClient = async (argv: string[]): Promise<number> => {
  const TARGETS = targets();
  const clientArg = argv[0];
  if (!clientArg || !(clientArg in TARGETS)) {
    printUsage();
    return clientArg ? 2 : 0;
  }
  const target = TARGETS[clientArg as ClientId];
  console.log(`Target: ${target.displayName}`);
  if (target.format === "json") {
    return removeFromJson(target.configPath, target.mcpServersKey ?? "mcpServers");
  }
  return removeFromCodex(target.configPath);
};
