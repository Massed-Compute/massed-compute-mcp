/**
 * `massed-compute-mcp init`
 *
 * One-shot setup: resolve an API key (--token-file > env > interactive
 * prompt), validate it against the live upstream, persist it, then
 * detect installed MCP clients and offer to wire each one up.
 *
 * The user shouldn't have to run two commands after `pip install` / `npm
 * install -g` — one `init` covers the full path from "I just installed
 * this" to "Claude Code sees the tools".
 *
 * Idempotent: re-running with the same key as already stored revalidates
 * and refreshes `validatedAt` without prompting. Identical client
 * entries are silent no-ops via the same logic that `install-client`
 * already uses.
 */

import {
  DEFAULT_BASE_URL,
  ENV_API_KEY,
  ENV_BASE_URL,
  configPath,
  getCliOverride,
  readConfig,
  writeConfig,
} from "../config.js";
import { promptHidden, promptYesNo } from "../prompt.js";
import { validateApiKey, ValidationOutcome } from "../upstream.js";
import { detectClients, type ClientId } from "../client-detect.js";
import { runInstallClient } from "./install-client.js";

const SETTINGS_URL = "https://vm.massedcompute.com/settings/api";

const argValue = (argv: string[], flag: string): string | undefined => {
  const eqMatch = argv.find((a) => a.startsWith(`${flag}=`));
  if (eqMatch) return eqMatch.slice(flag.length + 1);
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
};

const hasFlag = (argv: string[], ...flags: string[]): boolean =>
  argv.some((a) => flags.includes(a));

/**
 * Walk through the four supported clients and, for each, either auto-wire
 * (non-interactive `--yes`) or prompt. Skips clients that aren't detected
 * unless `--clients` explicitly lists them or `--all-clients` is set.
 */
const wireClients = async (argv: string[]): Promise<void> => {
  const yes = hasFlag(argv, "--yes", "--force", "-y");
  const allClients = hasFlag(argv, "--all-clients");
  const explicitList = argValue(argv, "--clients");

  const detected = detectClients();
  const explicitIds: ClientId[] | undefined = explicitList
    ? (explicitList.split(",").map((s) => s.trim()) as ClientId[])
    : undefined;

  console.log("");
  console.log("Detecting MCP clients on this machine…");
  for (const c of detected) {
    const mark = c.present ? "✓" : "✗";
    const where = c.present ? c.detectedAt : "not installed";
    console.log(`  ${mark} ${c.displayName.padEnd(16)} (${where})`);
  }
  console.log("");

  // Build the list of clients we'll attempt to wire.
  let toWire: ClientId[];
  if (explicitIds) {
    toWire = explicitIds;
  } else if (allClients) {
    toWire = detected.map((c) => c.id);
  } else {
    // Default: only detected clients. In non-interactive mode (--yes),
    // wire all of them. In interactive mode, ask per client.
    toWire = detected.filter((c) => c.present).map((c) => c.id);
  }

  if (toWire.length === 0) {
    console.log("No MCP clients detected. Install one (Claude Code, Cursor, Claude Desktop, Codex) then run:");
    console.log("  massed-compute-mcp install-client <client>");
    return;
  }

  for (const id of toWire) {
    const c = detected.find((d) => d.id === id);
    if (!yes) {
      const accept = await promptYesNo(
        `Wire massed-compute-mcp into ${c?.displayName ?? id}?`,
        c?.present ?? false,
      );
      if (!accept) continue;
    }
    // Reuse the same code path as the standalone subcommand, so behavior
    // (atomic write, backup, idempotency, codex handling) is identical.
    await runInstallClient([id, ...(yes ? ["--yes"] : [])]);
    console.log("");
  }
};

export const runInit = async (argv: string[]): Promise<number> => {
  const override = getCliOverride();
  const baseUrl =
    argValue(argv, "--base-url") ??
    override?.baseUrl ??
    process.env[ENV_BASE_URL] ??
    DEFAULT_BASE_URL;
  const yes = hasFlag(argv, "--yes", "--force", "-y");
  const noInstall = hasFlag(argv, "--no-install-clients");

  // Candidate key sources (highest first):
  //   1. CLI override (--token / --token-file, parsed in cli.ts)
  //   2. MASSED_COMPUTE_API_KEY env
  const candidate: string | undefined =
    override?.apiKey ?? process.env[ENV_API_KEY] ?? undefined;

  const existing = readConfig();

  // Case 1: existing config + candidate matches it → refresh path.
  // Re-validate, bump validatedAt, no prompt, no churn. Then still offer
  // to wire clients so re-running on a new machine with a synced key
  // gets the user fully set up.
  if (existing?.apiKey && candidate && candidate === existing.apiKey) {
    process.stdout.write("Re-validating stored key against upstream… ");
    const outcome = await validateApiKey(candidate, baseUrl);
    if (outcome.status !== ValidationOutcome.Ok) {
      process.stdout.write("failed\n");
      console.error(`Error: stored key no longer valid (HTTP ${"httpStatus" in outcome ? outcome.httpStatus : "?"}).`);
      console.error(`Generate a new one at ${SETTINGS_URL} and re-run \`massed-compute-mcp init\`.`);
      return 2;
    }
    process.stdout.write("ok\n");
    writeConfig({
      apiKey: candidate,
      baseUrl: baseUrl === DEFAULT_BASE_URL ? undefined : baseUrl,
      validatedAt: new Date().toISOString(),
    });
    console.log(`Already configured at ${configPath()}; validatedAt refreshed.`);
    if (!noInstall) await wireClients(argv);
    return 0;
  }

  console.log("Massed Compute MCP — first-run setup");
  console.log("───────────────────────────────────────");
  if (!candidate) {
    console.log(`Generate or copy your API key from ${SETTINGS_URL}`);
    console.log("Use a read-only key if this assistant should not be able to launch, restart, or terminate instances.");
    console.log("");
  }

  // Case 2: existing config + (no candidate OR candidate differs).
  // Confirm before overwriting, unless --yes.
  if (existing?.apiKey && !yes) {
    const proceed = await promptYesNo(
      `An API key is already stored at ${configPath()}. Replace it?`,
      false,
    );
    if (!proceed) {
      console.log("Aborted; existing key kept.");
      return 0;
    }
  }

  // Case 3: no candidate yet → interactive prompt.
  const apiKey = (candidate ?? (await promptHidden("API key (input hidden): "))).trim();
  if (apiKey.length === 0) {
    console.error("Error: no key entered.");
    return 1;
  }

  process.stdout.write("Validating against upstream… ");
  const outcome = await validateApiKey(apiKey, baseUrl);
  switch (outcome.status) {
    case ValidationOutcome.Ok:
      process.stdout.write("ok\n");
      break;
    case ValidationOutcome.Unauthorized:
      process.stdout.write("rejected\n");
      console.error(`Error: the upstream rejected this key (HTTP ${outcome.httpStatus}).`);
      console.error(`Generate a new one at ${SETTINGS_URL} and re-run \`massed-compute-mcp init\`.`);
      return 2;
    case ValidationOutcome.NetworkError:
      process.stdout.write("network error\n");
      console.error(`Error: could not reach ${baseUrl} — ${outcome.detail}`);
      console.error("Check your internet connection and re-run.");
      return 3;
    case ValidationOutcome.UpstreamError:
      process.stdout.write("upstream error\n");
      console.error(`Error: upstream returned HTTP ${outcome.httpStatus}. Try again later.`);
      return 4;
  }

  writeConfig({
    apiKey,
    baseUrl: baseUrl === DEFAULT_BASE_URL ? undefined : baseUrl,
    validatedAt: new Date().toISOString(),
  });

  console.log("");
  console.log(`Saved to ${configPath()}`);

  if (!noInstall) {
    await wireClients(argv);
  }

  console.log("");
  console.log("Done. Restart any wired MCP clients to pick up the new tools.");
  console.log("Run `massed-compute-mcp doctor` anytime to verify health.");
  return 0;
};
