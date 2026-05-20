import { TOOLS } from "./tools.js";
import pkg from "../package.json" with { type: "json" };

/**
 * Static MCP server card. Served at `/.well-known/mcp/server-card.json`.
 * Some registries prefer this over JSON-RPC introspection.
 */
export interface ServerCard {
  serverInfo: { name: string; version: string; title: string };
  protocol: { name: string; version: string; transport: string };
  authentication: {
    required: boolean;
    schemes: string[];
    description: string;
  };
  documentation: { api: string };
  tools: Array<{
    name: string;
    title: string;
    description: string;
    inputSchema: unknown;
    outputSchema?: unknown;
    annotations?: unknown;
  }>;
  resources: unknown[];
  prompts: unknown[];
}

export const MCP_SERVER_NAME = "massed-compute-mcp";
// Single source of truth: package.json's version field. Bumping the
// release version anywhere else is a no-op.
export const MCP_SERVER_VERSION = (pkg as { version: string }).version;
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const buildServerCard = (): ServerCard => ({
  serverInfo: {
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    title: "Massed Compute VM Marketplace",
  },
  protocol: {
    name: "Model Context Protocol",
    version: MCP_PROTOCOL_VERSION,
    transport: "http",
  },
  authentication: {
    required: true,
    schemes: ["bearer"],
    description:
      "Send your Massed Compute API key as a Bearer token in the 'Authorization' header. Generate one at https://vm.massedcompute.com/account/api-keys. For analysis-only agents, generate a read-only key to block destructive tool calls.",
  },
  documentation: { api: "https://vm-docs.massedcompute.com/api/v1" },
  tools: TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
    annotations: t.annotations,
  })),
  resources: [],
  prompts: [],
});
