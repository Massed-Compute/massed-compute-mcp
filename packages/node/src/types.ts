/**
 * A JSON Schema object (the subset MCP uses for inputSchema/outputSchema).
 * We don't validate schemas ourselves — the SDK does. This type is permissive.
 */
export type JsonSchema = Record<string, unknown>;

/**
 * MCP tool annotations (display + safety hints for clients).
 * Mirror the MCP spec; clients use these to decide how to surface tools.
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Describes how to forward an MCP tool call to the upstream HTTP API.
 *
 * - `path` may contain `{name}` placeholders. Each one is substituted from
 *   `args[pathParams[name]]` at call time; the corresponding key is then
 *   removed from `args` before the remaining args are used as body or
 *   query parameters.
 * - For GET/DELETE: remaining args are appended as query parameters.
 * - For POST/PUT/PATCH: remaining args are JSON-stringified into the body.
 */
export interface UpstreamCall {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** Map of `{placeholder}` in `path` to the arg key that supplies its value. */
  pathParams?: Record<string, string>;
}

/**
 * A single MCP tool definition. The entire registry is a list of these.
 * Nothing about a tool except the upstream call mapping is Massed Compute-specific.
 */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  upstream: UpstreamCall;
}
