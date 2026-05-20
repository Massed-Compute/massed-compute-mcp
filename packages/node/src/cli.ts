#!/usr/bin/env node
/**
 * massed-compute-mcp CLI dispatcher.
 *
 * No subcommand or an unknown one defaults to `server` so MCP clients that
 * invoke the binary with no arguments (the default for stdio transports)
 * still get an MCP server. All user-facing CLI operations are explicit
 * subcommands.
 */

import * as fs from "node:fs";
import { runInit } from "./commands/init.js";
import { runDoctor } from "./commands/doctor.js";
import { runLogout } from "./commands/logout.js";
import { runInstallClient } from "./commands/install-client.js";
import { runUninstallClient } from "./commands/uninstall-client.js";
import { runTools } from "./commands/tools-list.js";
import { runConfigShow } from "./commands/config-show.js";
import { runServer } from "./commands/server.js";
import { MCP_SERVER_VERSION } from "./server-card.js";
import { setCliOverride } from "./config.js";

const HELP = `massed-compute-mcp v${MCP_SERVER_VERSION}

Run the Massed Compute MCP server, or manage its configuration.

USAGE
  massed-compute-mcp [command] [options]

COMMANDS
  server                  Run the MCP server over stdio (default).
  init [--yes] [--token-file <path>] [--clients <a,b,c>] [--no-install-clients]
                          One-shot setup: validate + store an API key, then
                          detect installed MCP clients (Claude Code, Cursor,
                          Claude Desktop, Codex) and offer to wire each one
                          up. With --yes, auto-wires every detected client.
                          --clients foo,bar overrides detection.
                          Idempotent: re-runs with the same key revalidate
                          and refresh validatedAt without prompting.
  doctor                  Verify the stored key works and print client
                          configuration snippets.
  config show             Print where the config file lives and its (masked)
                          contents. No upstream call.
  install-client <id> [-y] Wire this server into a single MCP client config
                          (most users just need 'init' — this is for adding
                          a client AFTER initial setup, like installing
                          Cursor next week).
                          ids: claude-code, cursor, claude-desktop, codex.
                          Idempotent: silent no-op when content already matches.
  uninstall-client <id>   Remove this server from a client config (creates a
                          timestamped backup first).
  logout                  Delete the stored API key.
  tools [--json]          Print the tool catalog (does not call the upstream).
  version                 Print the version.
  help                    Show this message.

GLOBAL OPTIONS
  --token <key>           Override the API key for this invocation. Note:
                          visible in 'ps'; prefer --token-file for unattended runs.
  --token-file <path>     Read the API key from a file. The file's first line
                          is used; trailing whitespace is stripped.
  --base-url <url>        Override the upstream (defaults to https://vm.massedcompute.com).

ENVIRONMENT
  MASSED_COMPUTE_API_KEY        API key, overrides the stored config.
  MASSED_COMPUTE_API_BASE_URL   Upstream base URL (defaults to https://vm.massedcompute.com).

EXAMPLES
  massed-compute-mcp init
  massed-compute-mcp doctor
  massed-compute-mcp install-client claude-code
  massed-compute-mcp --token "k.s" server
`;

/**
 * Extract `--token <value>` and `--base-url <value>` from anywhere in argv.
 * Returns the remaining args (subcommand + its options) untouched.
 *
 * We do this manually rather than pulling in commander/yargs because the
 * runtime dep tree must stay at just `@modelcontextprotocol/sdk` for
 * supply-chain reasons.
 */
const extractGlobalFlags = (argv: string[]): { token?: string; baseUrl?: string; rest: string[] } => {
  const rest: string[] = [];
  let token: string | undefined;
  let tokenFile: string | undefined;
  let baseUrl: string | undefined;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--token") {
      if (i + 1 >= argv.length) throw new Error("--token requires a value");
      token = argv[i + 1];
      i += 2;
      continue;
    }
    if (arg !== undefined && arg.startsWith("--token=")) {
      token = arg.slice("--token=".length);
      i += 1;
      continue;
    }
    if (arg === "--token-file") {
      if (i + 1 >= argv.length) throw new Error("--token-file requires a path");
      tokenFile = argv[i + 1];
      i += 2;
      continue;
    }
    if (arg !== undefined && arg.startsWith("--token-file=")) {
      tokenFile = arg.slice("--token-file=".length);
      i += 1;
      continue;
    }
    if (arg === "--base-url") {
      if (i + 1 >= argv.length) throw new Error("--base-url requires a value");
      baseUrl = argv[i + 1];
      i += 2;
      continue;
    }
    if (arg !== undefined && arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length);
      i += 1;
      continue;
    }
    if (arg !== undefined) rest.push(arg);
    i += 1;
  }
  if (tokenFile && !token) {
    // Read the token from the file. --token wins if both are given.
    // Strip leading/trailing whitespace so the file can end with a newline.
    // Using sync fs because the rest of the CLI flow is sync-friendly.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const contents = fs.readFileSync(tokenFile, "utf8");
    token = contents.trim();
    if (!token) throw new Error(`--token-file ${tokenFile} is empty`);
  }
  return { token, baseUrl, rest };
};

const main = async (): Promise<number> => {
  const raw = process.argv.slice(2);
  let parsed: ReturnType<typeof extractGlobalFlags>;
  try {
    parsed = extractGlobalFlags(raw);
  } catch (err) {
    process.stderr.write(`massed-compute-mcp: ${err instanceof Error ? err.message : String(err)}\n\n`);
    process.stdout.write(HELP);
    return 2;
  }
  if (parsed.token || parsed.baseUrl) {
    setCliOverride({ apiKey: parsed.token, baseUrl: parsed.baseUrl });
  }

  const cmd = parsed.rest[0] ?? "server";
  const rest = parsed.rest.slice(1);

  switch (cmd) {
    case "server":
      return runServer(rest);
    case "init":
    case "login":
      return runInit(rest);
    case "doctor":
      return runDoctor(rest);
    case "logout":
      return runLogout(rest);
    case "install-client":
      return runInstallClient(rest);
    case "uninstall-client":
      return runUninstallClient(rest);
    case "config":
      // `config` is a small subcommand group. Only `config show` exists today.
      if (rest[0] === "show") return runConfigShow(rest.slice(1));
      process.stderr.write(`Unknown config subcommand: ${rest[0] ?? "(none)"}\n`);
      process.stderr.write("Supported: config show\n");
      return 2;
    case "tools":
      return runTools(rest);
    case "version":
    case "--version":
    case "-v":
      console.log(MCP_SERVER_VERSION);
      return 0;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n`);
      process.stdout.write(HELP);
      return 2;
  }
};

main().then(
  (code) => {
    if (code !== 0) process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`massed-compute-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
