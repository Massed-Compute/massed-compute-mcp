import { TOOLS } from "./tools.js";
import { forwardToUpstream, type ToolResult } from "./forward.js";

export const dispatchToolCall = async (
  toolName: string,
  args: Record<string, unknown>,
  authHeader: string,
  baseUrl: string,
): Promise<ToolResult> => {
  const tool = TOOLS.find((t) => t.name === toolName);
  if (!tool) {
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${toolName}` }],
      isError: true as const,
      _meta: { rpcCode: -32602 },
    };
  }
  return forwardToUpstream(tool, args, authHeader, baseUrl);
};
