/**
 * Defense-in-depth redactor for upstream JSON proxied back to MCP clients.
 *
 * Walks the parsed JSON value and replaces any value whose key matches a
 * sensitive name with a sentinel string. This is the backstop for the
 * `instances_list` / `instances_get` promise that cleartext VM passwords
 * never reach the model; new endpoints that return a `password`-shaped
 * field are scrubbed automatically.
 *
 * Pure / non-mutating: returns a new structure, leaves the input alone.
 */

const SENSITIVE_KEYS = new Set(["password"]);
const REDACTED = "[redacted]";

export const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) && v != null && v !== "" ? REDACTED : redactSensitive(v);
    }
    return out;
  }
  return value;
};
