/**
 * `massed-compute-mcp doctor`
 *
 * Diagnostics for "is my install actually going to work when an MCP client
 * spawns it?" Reads the resolved auth chain (override / env / config),
 * pings the upstream, prints which tools the server would expose, and
 * dumps copy-pasteable client snippets.
 */

import { configPath, resolveAuth } from "../config.js";
import { TOOLS } from "../tools.js";
import { MCP_SERVER_VERSION } from "../server-card.js";
import { validateApiKey, ValidationOutcome } from "../upstream.js";

const mask = (key: string): string => {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
};

export const runDoctor = async (_argv: string[]): Promise<number> => {
  console.log(`massed-compute-mcp v${MCP_SERVER_VERSION}`);
  console.log("");

  const auth = resolveAuth();
  console.log("Auth resolution");
  console.log("───────────────");
  if (auth.source === "none") {
    console.log("  no API key found");
    console.log(`  config path: ${configPath()}`);
    console.log("");
    console.log("Fix: run `massed-compute-mcp init`.");
    return 1;
  }
  console.log(`  source:    ${auth.source}`);
  console.log(`  key:       ${mask(auth.apiKey!)}`);
  console.log(`  base url:  ${auth.baseUrl}`);
  if (auth.source === "config") console.log(`  file:      ${configPath()}`);
  console.log("");

  process.stdout.write("Upstream check… ");
  const outcome = await validateApiKey(auth.apiKey!, auth.baseUrl);
  switch (outcome.status) {
    case ValidationOutcome.Ok:
      console.log("ok");
      break;
    case ValidationOutcome.Unauthorized:
      console.log(`failed (HTTP ${outcome.httpStatus} — key rejected)`);
      console.log("");
      console.log("Fix: run `massed-compute-mcp init` and paste a fresh key.");
      return 2;
    case ValidationOutcome.NetworkError:
      console.log(`failed (network: ${outcome.detail})`);
      return 3;
    case ValidationOutcome.UpstreamError:
      console.log(`failed (HTTP ${outcome.httpStatus})`);
      return 4;
  }
  console.log("");

  console.log(`Tool catalog (${TOOLS.length} total)`);
  console.log("─────────────");
  for (const t of TOOLS) {
    const mark = t.annotations?.destructiveHint
      ? "⚠ destructive"
      : t.annotations?.readOnlyHint
        ? "  read-only"
        : "  mutates";
    console.log(`  ${mark}  ${t.name.padEnd(30)} ${t.title}`);
  }
  console.log("");
  console.log("Note: tools requiring full-access keys will return 403 to read-only keys at call time.");
  console.log("");

  console.log("Client wiring");
  console.log("─────────────");
  console.log("Claude Code:");
  console.log("  claude mcp add --transport stdio massed-compute massed-compute-mcp");
  console.log("");
  console.log("Or paste into ~/.claude.json under \"mcpServers\":");
  console.log(JSON.stringify({ "massed-compute": { command: "massed-compute-mcp" } }, null, 2));
  console.log("");
  console.log("Or let us do it for you:");
  console.log("  massed-compute-mcp install-client claude-code");
  console.log("  massed-compute-mcp install-client cursor");
  console.log("  massed-compute-mcp install-client claude-desktop");
  return 0;
};
