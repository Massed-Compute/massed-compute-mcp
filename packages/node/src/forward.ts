import type { ToolDef } from "./types.js";

export interface BuiltRequest {
  url: string;
  body: string | undefined;
}

const HAS_BODY: Record<string, true> = { POST: true, PUT: true, PATCH: true };

// Per-tool-call timeout. Node's fetch has no default — a stuck upstream
// would otherwise hang the MCP server's event loop indefinitely.
const REQUEST_TIMEOUT_MS = 30_000;

// Refuse upstream responses larger than this cap. Defense-in-depth against
// a misbehaving or compromised upstream returning multi-GB payloads that
// would exhaust the MCP server's memory.
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MiB

/**
 * Construct the upstream URL + body for a given tool call.
 *
 * 1. Interpolate `{placeholder}` segments in `tool.upstream.path` using
 *    `tool.upstream.pathParams` and `args`. Strip those keys from a working
 *    copy of `args`.
 * 2. For methods with a body (POST/PUT/PATCH): JSON-stringify the remaining args.
 * 3. For methods without a body (GET/DELETE): append remaining args as a query
 *    string (best-effort for non-string scalars via String(v)).
 */
export const buildRequest = (
  tool: ToolDef,
  args: Record<string, unknown>,
  baseUrl: string,
): BuiltRequest => {
  const remaining: Record<string, unknown> = { ...args };
  let path = tool.upstream.path;

  if (tool.upstream.pathParams) {
    for (const [placeholder, argKey] of Object.entries(tool.upstream.pathParams)) {
      const value = remaining[argKey];
      if (value === undefined || value === null) {
        throw new Error(
          `Tool "${tool.name}": missing argument "${argKey}" for path placeholder {${placeholder}}.`,
        );
      }
      delete remaining[argKey];
      path = path.replace(`{${placeholder}}`, encodeURIComponent(String(value)));
    }
  }

  const hasBody = HAS_BODY[tool.upstream.method] === true;

  if (hasBody) {
    const body = Object.keys(remaining).length > 0 ? JSON.stringify(remaining) : "{}";
    return { url: `${baseUrl}${path}`, body };
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(remaining)) {
    if (v === undefined || v === null) continue;
    qs.append(k, String(v));
  }
  const queryString = qs.toString();
  return {
    url: queryString.length > 0 ? `${baseUrl}${path}?${queryString}` : `${baseUrl}${path}`,
    body: undefined,
  };
};

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;
const RPC_UNAUTHORIZED = -32001;
const RPC_RESOURCE_NOT_FOUND = -32002;
const RPC_FORBIDDEN = -32003;

const httpStatusToRpcCode = (status: number): number => {
  if (status === 401) return RPC_UNAUTHORIZED;
  if (status === 403) return RPC_FORBIDDEN;
  if (status === 404) return RPC_RESOURCE_NOT_FOUND;
  if (status === 422) return RPC_INVALID_PARAMS;
  if (status >= 400 && status < 500) return RPC_INVALID_REQUEST;
  return RPC_INTERNAL_ERROR;
};

export interface ToolResultContentText {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolResultContentText[];
  structuredContent?: Record<string, unknown> | unknown[];
  isError?: true;
  _meta?: { rpcCode?: number };
}

/**
 * The single shared handler for every MCP tool. Builds the upstream
 * request from the tool definition + user args, fetches it, and maps
 * the response to an MCP tool result.
 *
 * On network failure (fetch throws), produces a synthetic InternalError
 * result so the SDK can still return a well-formed JSON-RPC response
 * rather than crashing the dispatcher.
 */
export const forwardToUpstream = async (
  tool: ToolDef,
  args: Record<string, unknown>,
  authHeader: string,
  baseUrl: string,
): Promise<ToolResult> => {
  let built: BuiltRequest;
  try {
    built = buildRequest(tool, args, baseUrl);
  } catch (err) {
    return {
      content: [{ type: "text", text: (err as Error).message }],
      isError: true,
      _meta: { rpcCode: RPC_INVALID_PARAMS },
    };
  }

  let res: Response;
  try {
    res = await fetch(built.url, {
      method: tool.upstream.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: built.body,
      // Node's fetch has no default timeout, so a hung upstream would
      // hang the MCP tool call indefinitely (clients eventually give up,
      // but the orphan request keeps the server's event loop busy).
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Log full detail to stderr (only the operator sees this); return a
    // stable message to the MCP client so we don't leak DNS/IP/error-code
    // hints about the upstream infrastructure.
    process.stderr.write(`[mcp] upstream fetch error: ${built.url} ${err}\n`);
    return {
      content: [{ type: "text", text: "Upstream fetch failed." }],
      isError: true,
      _meta: { rpcCode: RPC_INTERNAL_ERROR },
    };
  }

  return mapResponseToToolResult(res);
};

const isJson = (res: Response): boolean =>
  (res.headers.get("Content-Type") ?? "").toLowerCase().includes("application/json");

/**
 * Translate an upstream HTTP response into an MCP tool result.
 *
 * On 2xx with JSON body: returns the body as `structuredContent`, plus a
 * pretty-printed text representation in `content` for clients that don't
 * support structured output.
 *
 * On non-2xx: returns isError=true with `_meta.rpcCode` set per the
 * httpStatusToRpcCode mapping. The upstream body (if any) is included as
 * text content but never propagated as `structuredContent`.
 */
export const mapResponseToToolResult = async (res: Response): Promise<ToolResult> => {
  // Defense-in-depth: refuse to read responses larger than our cap. Doing
  // this off the Content-Length header is best-effort — a misbehaving
  // upstream could omit the header — but the upstream we care about
  // (vm.massedcompute.com) does set it, so the cap holds for the realistic
  // attack surface.
  const declaredLength = Number(res.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    return {
      content: [
        {
          type: "text",
          text: `Upstream response declared ${declaredLength} bytes (> ${(MAX_RESPONSE_BYTES / (1024 * 1024)).toFixed(0)} MiB); refused.`,
        },
      ],
      isError: true,
      _meta: { rpcCode: RPC_INTERNAL_ERROR },
    };
  }

  const isError = !res.ok;
  let textBody: string;
  let parsed: unknown;

  if (isJson(res)) {
    parsed = await res.json().catch(() => undefined);
    textBody = JSON.stringify(parsed, null, 2) ?? "";
  } else {
    textBody = await res.text();
    parsed = undefined;
  }
  // Hard cap regardless of Content-Length, in case the upstream lied.
  if (textBody.length > MAX_RESPONSE_BYTES) {
    return {
      content: [
        {
          type: "text",
          text: `Upstream response exceeded ${(MAX_RESPONSE_BYTES / (1024 * 1024)).toFixed(0)} MiB bytes; truncated and refused.`,
        },
      ],
      isError: true,
      _meta: { rpcCode: RPC_INTERNAL_ERROR },
    };
  }

  if (isError) {
    return {
      content: [{ type: "text", text: textBody }],
      isError: true,
      _meta: { rpcCode: httpStatusToRpcCode(res.status) },
    };
  }

  const result: ToolResult = {
    content: [{ type: "text", text: textBody }],
  };
  if (parsed !== undefined && parsed !== null && typeof parsed === "object") {
    result.structuredContent = parsed as ToolResult["structuredContent"];
  }
  return result;
};
