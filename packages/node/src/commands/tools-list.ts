/**
 * `massed-compute-mcp tools`
 *
 * Fetches the live tool catalog from the hosted MCP endpoint (tools/list)
 * and prints it. There is no local catalog to print — this package is a
 * verbatim pass-through, so the upstream is the only source of truth.
 * The catalog is the same for every key; read-only keys are rejected at
 * tools/call time (-32003) when they invoke a mutating tool.
 */

import { UpstreamSession } from "../proxy.js";
import { resolveAuth } from "../config.js";

interface CatalogTool {
  name: string;
  title?: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export const fetchToolCatalog = async (): Promise<CatalogTool[]> => {
  const auth = resolveAuth();
  const session = new UpstreamSession({
    baseUrl: auth.baseUrl,
    authHeader: auth.apiKey ? `Bearer ${auth.apiKey}` : undefined,
  });
  const responses = await session.forward({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const response = responses.find((m) => m.id === 1);
  if (!response || response.error) {
    throw new Error(
      `tools/list failed against ${session.endpoint()}: ${JSON.stringify(response?.error ?? "no response")}`,
    );
  }
  const tools = (response.result as { tools?: CatalogTool[] } | undefined)?.tools;
  if (!Array.isArray(tools)) {
    throw new Error(`tools/list returned an unexpected shape from ${session.endpoint()}`);
  }
  return tools;
};

export const formatToolLine = (t: CatalogTool): string => {
  const flag = t.annotations?.destructiveHint
    ? " ⚠ destructive"
    : t.annotations?.readOnlyHint
      ? "  read-only"
      : "  mutates";
  return ` ${flag}  ${t.name.padEnd(30)} ${t.title ?? ""}`.trimEnd();
};

export const runTools = async (argv: string[]): Promise<number> => {
  let tools: CatalogTool[];
  try {
    tools = await fetchToolCatalog();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ tools }, null, 2));
    return 0;
  }
  console.log(`${tools.length} tools (live catalog from the hosted MCP endpoint)`);
  console.log("");
  for (const t of tools) console.log(formatToolLine(t));
  return 0;
};
