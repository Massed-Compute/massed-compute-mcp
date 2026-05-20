/**
 * Detect which MCP clients are installed on this machine so `init` can
 * offer to wire them up automatically. Used by `init` (auto-detect +
 * prompt-per-client) and `install-client` (lookup by id).
 *
 * Detection is filesystem-only: we don't shell out to `which claude` or
 * `which cursor` because the user might have those binaries available
 * without actually using the corresponding MCP-capable app. The presence
 * of the config dir/file is a stronger signal that the user actually
 * runs the client.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ClientId = "claude-code" | "cursor" | "claude-desktop" | "codex";

export interface DetectedClient {
  id: ClientId;
  displayName: string;
  configPath: string;
  /** Where on disk we looked to decide the client is present. */
  detectedAt?: string;
  /** false when the client wasn't found; we still expose the path so
   *  `install-client <id>` works for users with non-standard setups. */
  present: boolean;
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

const claudeDesktopAppPath = (): string | undefined => {
  if (process.platform === "darwin") return "/Applications/Claude.app";
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Claude", "Claude.exe");
  }
  return undefined;
};

const exists = (p: string): boolean => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Probe for each supported client and return whether each is present.
 * Order matches the on-screen list users see during `init`.
 */
export const detectClients = (): DetectedClient[] => {
  const home = os.homedir();
  const out: DetectedClient[] = [];

  // Claude Code: ~/.claude.json or ~/.claude/ directory (the CLI's
  // canonical config locations). Either is enough.
  const claudeCodeFile = path.join(home, ".claude.json");
  const claudeCodeDir = path.join(home, ".claude");
  const claudeCodePresent = exists(claudeCodeFile) || exists(claudeCodeDir);
  out.push({
    id: "claude-code",
    displayName: "Claude Code",
    configPath: claudeCodeFile,
    detectedAt: claudeCodePresent
      ? exists(claudeCodeFile) ? claudeCodeFile : claudeCodeDir
      : undefined,
    present: claudeCodePresent,
  });

  // Cursor: ~/.cursor/ directory is the install marker.
  const cursorDir = path.join(home, ".cursor");
  const cursorPresent = exists(cursorDir);
  out.push({
    id: "cursor",
    displayName: "Cursor",
    configPath: path.join(cursorDir, "mcp.json"),
    detectedAt: cursorPresent ? cursorDir : undefined,
    present: cursorPresent,
  });

  // Claude Desktop: app bundle or config dir.
  const cdConfig = claudeDesktopPath();
  const cdConfigDir = path.dirname(cdConfig);
  const cdApp = claudeDesktopAppPath();
  const cdPresent = exists(cdConfigDir) || (cdApp ? exists(cdApp) : false);
  out.push({
    id: "claude-desktop",
    displayName: "Claude Desktop",
    configPath: cdConfig,
    detectedAt: cdPresent ? (exists(cdConfigDir) ? cdConfigDir : cdApp) : undefined,
    present: cdPresent,
  });

  // Codex: ~/.codex/ directory marker.
  const codexDir = path.join(home, ".codex");
  const codexPresent = exists(codexDir);
  out.push({
    id: "codex",
    displayName: "Codex",
    configPath: path.join(codexDir, "config.toml"),
    detectedAt: codexPresent ? codexDir : undefined,
    present: codexPresent,
  });

  return out;
};
