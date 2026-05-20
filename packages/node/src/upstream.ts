/**
 * Helpers for the small set of upstream calls the CLI itself makes (the
 * token-validation request `init` and `doctor` use). The MCP server's
 * tool-call forwarder is separate (`forward.ts`) and only ever runs after
 * the CLI has handed off to the JSON-RPC dispatcher.
 */

export const enum ValidationOutcome {
  Ok = "ok",
  Unauthorized = "unauthorized",
  UpstreamError = "upstream_error",
  NetworkError = "network_error",
}

export type ValidationResult =
  | { status: ValidationOutcome.Ok; httpStatus: number }
  | { status: ValidationOutcome.Unauthorized; httpStatus: number }
  | { status: ValidationOutcome.UpstreamError; httpStatus: number }
  | { status: ValidationOutcome.NetworkError; detail: string };

const TOKEN_VALIDATION_PATH = "/api/v1/account/token/validation";

export const validateApiKey = async (
  apiKey: string,
  baseUrl: string,
): Promise<ValidationResult> => {
  const url = `${baseUrl.replace(/\/+$/, "")}${TOKEN_VALIDATION_PATH}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: "{}",
      // Mirror httpx's default timeout in the Python sibling — without
      // this, a stuck upstream during `init` or `doctor` would hang the
      // CLI silently.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return {
      status: ValidationOutcome.NetworkError,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (res.ok) return { status: ValidationOutcome.Ok, httpStatus: res.status };
  if (res.status === 401 || res.status === 403) {
    return { status: ValidationOutcome.Unauthorized, httpStatus: res.status };
  }
  return { status: ValidationOutcome.UpstreamError, httpStatus: res.status };
};
