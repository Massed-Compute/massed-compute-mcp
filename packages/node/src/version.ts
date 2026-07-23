import pkg from "../package.json" with { type: "json" };

export const MCP_SERVER_NAME = "massed-compute-mcp";
// Single source of truth: package.json's version field. Bumping the
// release version anywhere else is a no-op.
export const MCP_SERVER_VERSION = (pkg as { version: string }).version;
