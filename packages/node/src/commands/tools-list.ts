/**
 * `massed-compute-mcp tools`
 *
 * Prints the tool catalog the server would expose. Independent of auth —
 * useful for sanity-checking what shipped without spinning up the MCP server
 * or hitting the upstream.
 */

import { TOOLS, TOOL_SPEC_VERSION } from "../tools.js";

export const runTools = async (argv: string[]): Promise<number> => {
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ specVersion: TOOL_SPEC_VERSION, tools: TOOLS }, null, 2));
    return 0;
  }
  console.log(`Tool spec ${TOOL_SPEC_VERSION} — ${TOOLS.length} tools`);
  console.log("");
  for (const t of TOOLS) {
    const flag = t.annotations?.destructiveHint
      ? " ⚠ destructive"
      : t.annotations?.readOnlyHint
        ? "  read-only"
        : "  mutates";
    console.log(` ${flag}  ${t.name}`);
    console.log(`            ${t.upstream.method} ${t.upstream.path}`);
  }
  return 0;
};
