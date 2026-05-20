/**
 * `massed-compute-mcp server` (also the default command when no subcommand
 * is given) — runs the MCP server over stdio. This is what MCP clients
 * actually spawn; everything else in the CLI is configuration around it.
 *
 * Key resolution uses the shared `resolveAuth` chain (override / env /
 * config). If no key is available, we fail with a pointer to `init` rather
 * than crashing with a generic 401 mid-tool-call.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "../tools.js";
import { dispatchToolCall } from "../dispatch.js";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../server-card.js";
import { resolveAuth } from "../config.js";

export const runServer = async (_argv: string[]): Promise<number> => {
  const auth = resolveAuth();
  if (!auth.apiKey) {
    process.stderr.write(
      "[mcp] No API key configured. Run `massed-compute-mcp init`, or set MASSED_COMPUTE_API_KEY.\n",
    );
    return 1;
  }
  const authHeader = `Bearer ${auth.apiKey}`;

  const mcpServer = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } } },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      annotations: t.annotations,
    })),
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (req) =>
    dispatchToolCall(
      req.params.name,
      (req.params.arguments ?? {}) as Record<string, unknown>,
      authHeader,
      auth.baseUrl,
    ),
  );

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  // Returning here would let Node exit, but the SDK keeps the event loop
  // alive on the stdio transport. We resolve only when the client closes.
  return 0;
};
