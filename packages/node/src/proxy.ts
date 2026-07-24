/**
 * Verbatim JSON-RPC pass-through to the hosted Massed Compute MCP endpoint
 * (`<baseUrl>/api/mcp`, streamable HTTP).
 *
 * Every message read from the client is POSTed to the upstream unchanged —
 * this package adds no tool catalog, no schema mangling, no response
 * rewriting. The only things injected are transport-level headers: the
 * stored API key as a Bearer `Authorization` header, plus the
 * `MCP-Protocol-Version` / `Mcp-Session-Id` bookkeeping the streamable
 * HTTP transport spec requires.
 */

export const MCP_ENDPOINT_PATH = "/api/mcp";

// Per-request timeout. Node's fetch has no default — a stuck upstream
// would otherwise hang the MCP request indefinitely.
const REQUEST_TIMEOUT_MS = 30_000;

// Refuse upstream responses larger than this cap. Defense-in-depth against
// a misbehaving or compromised upstream returning multi-GB payloads that
// would exhaust the proxy's memory.
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MiB

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_INTERNAL_ERROR = -32603;
const RPC_UNAUTHORIZED = -32001;
const RPC_FORBIDDEN = -32003;

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export const parseError = (): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id: null,
  error: { code: RPC_PARSE_ERROR, message: "Parse error" },
});

const httpStatusToRpcCode = (status: number): number => {
  if (status === 401) return RPC_UNAUTHORIZED;
  if (status === 403) return RPC_FORBIDDEN;
  if (status >= 400 && status < 500) return RPC_INVALID_REQUEST;
  return RPC_INTERNAL_ERROR;
};

const isJsonRpcMessage = (value: unknown): value is JsonRpcMessage =>
  value !== null && typeof value === "object" && (value as JsonRpcMessage).jsonrpc === "2.0";

/** Extract JSON-RPC messages from a `text/event-stream` body. */
const parseSseMessages = (body: string): JsonRpcMessage[] => {
  const out: JsonRpcMessage[] = [];
  for (const event of body.split(/\n\n|\r\n\r\n/)) {
    const dataLines = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice("data:".length).trimStart());
    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join("\n"));
      if (isJsonRpcMessage(parsed)) out.push(parsed);
    } catch {
      // Non-JSON SSE data (keepalives etc.) — ignore.
    }
  }
  return out;
};

export interface UpstreamSessionOptions {
  baseUrl: string;
  /** Full `Bearer <key>` header value. Omitted → unauthenticated request. */
  authHeader?: string;
}

/**
 * One logical client connection to the upstream. Tracks the negotiated
 * protocol version (from the `initialize` response) and the upstream
 * session id (from the `Mcp-Session-Id` response header, if the upstream
 * ever becomes stateful — today it is stateless and never sets one).
 */
export class UpstreamSession {
  private protocolVersion?: string;
  private sessionId?: string;

  constructor(private readonly opts: UpstreamSessionOptions) {}

  endpoint(): string {
    return `${this.opts.baseUrl.replace(/\/+$/, "")}${MCP_ENDPOINT_PATH}`;
  }

  /**
   * Forward one JSON-RPC message verbatim. Returns the JSON-RPC messages
   * to relay back to the client (empty for notifications, which the
   * upstream acknowledges with a bodyless 202).
   */
  async forward(message: JsonRpcMessage): Promise<JsonRpcMessage[]> {
    const isRequest = message.id !== undefined && message.id !== null;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.opts.authHeader) headers["Authorization"] = this.opts.authHeader;
    if (this.protocolVersion) headers["MCP-Protocol-Version"] = this.protocolVersion;
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    let res: Response;
    try {
      res = await fetch(this.endpoint(), {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Log full detail to stderr (only the operator sees this); return a
      // stable message to the MCP client so we don't leak DNS/IP/error-code
      // hints about the upstream infrastructure.
      process.stderr.write(`[mcp] upstream fetch error: ${this.endpoint()} ${err}\n`);
      return isRequest
        ? [this.errorResponse(message, RPC_INTERNAL_ERROR, "Upstream fetch failed.")]
        : [];
    }

    const newSessionId = res.headers.get("Mcp-Session-Id");
    if (newSessionId) this.sessionId = newSessionId;

    // Notifications/responses are acknowledged with 202 and no body.
    if (res.status === 202 || res.status === 204) return [];

    const declaredLength = Number(res.headers.get("Content-Length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      return isRequest
        ? [this.errorResponse(message, RPC_INTERNAL_ERROR, "Upstream response too large; refused.")]
        : [];
    }

    const body = await res.text();
    if (body.length > MAX_RESPONSE_BYTES) {
      return isRequest
        ? [this.errorResponse(message, RPC_INTERNAL_ERROR, "Upstream response too large; refused.")]
        : [];
    }

    const contentType = (res.headers.get("Content-Type") ?? "").toLowerCase();
    let messages: JsonRpcMessage[];
    if (contentType.includes("text/event-stream")) {
      messages = parseSseMessages(body);
    } else {
      let parsed: unknown;
      try {
        parsed = body.length > 0 ? JSON.parse(body) : undefined;
      } catch {
        parsed = undefined;
      }
      if (Array.isArray(parsed)) {
        messages = parsed.filter(isJsonRpcMessage);
      } else if (isJsonRpcMessage(parsed)) {
        messages = [parsed];
      } else {
        // Non-JSON-RPC body (e.g. an HTML error page from a proxy layer).
        // Synthesize an error for requests; drop for notifications.
        return isRequest
          ? [
              this.errorResponse(
                message,
                httpStatusToRpcCode(res.status),
                `Upstream returned HTTP ${res.status} with a non-MCP response.`,
              ),
            ]
          : [];
      }
    }

    if (message.method === "initialize") {
      for (const m of messages) {
        const version = (m.result as { protocolVersion?: string } | undefined)?.protocolVersion;
        if (m.id === message.id && typeof version === "string") this.protocolVersion = version;
      }
    }

    return messages;
  }

  private errorResponse(request: JsonRpcMessage, code: number, msg: string): JsonRpcMessage {
    return { jsonrpc: "2.0", id: request.id ?? null, error: { code, message: msg } };
  }
}
