// Tool catalog. The shape lives in tools-spec.json, which is generated from
// the canonical tools.json at the repo root by `scripts/sync-tools.mjs`. Do
// not edit tools-spec.json directly — your changes will be overwritten.

import type { ToolDef } from "./types.js";
import spec from "./tools-spec.json" with { type: "json" };

interface SpecFile {
  specVersion?: string;
  tools: ToolDef[];
}

/**
 * Validate the spec at module load. If the on-disk JSON has been tampered
 * with — e.g. a malicious package post-install hook rewrote it to point
 * at a different host — fail loudly rather than silently forwarding tool
 * calls to whatever path the attacker chose.
 *
 * The check is intentionally narrow: every entry must have a name, an
 * HTTP method we recognize, and a `/api/v1/` path. Tightening further
 * (e.g. requiring inputSchema) would make in-place upgrades brittle.
 */
const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const validateSpec = (s: SpecFile): void => {
  if (!Array.isArray(s.tools) || s.tools.length === 0) {
    throw new Error("tools-spec.json: 'tools' must be a non-empty array");
  }
  for (const t of s.tools) {
    if (!t.name || typeof t.name !== "string") {
      throw new Error(`tools-spec.json: tool is missing 'name'`);
    }
    if (!t.upstream || !VALID_METHODS.has(t.upstream.method)) {
      throw new Error(`tools-spec.json: ${t.name} has invalid upstream.method`);
    }
    const path = t.upstream.path;
    if (!path?.startsWith("/api/v1/")) {
      throw new Error(`tools-spec.json: ${t.name} upstream.path must start with /api/v1/`);
    }
    // Reject path-traversal sequences in the template itself. Path
    // parameters are encodeURIComponent'd at call time, so user input
    // can't introduce these — but a tampered spec could.
    if (path.includes("/../") || path.includes("/./") || path.includes("//")) {
      throw new Error(`tools-spec.json: ${t.name} upstream.path contains forbidden traversal segments`);
    }
  }
};

validateSpec(spec as SpecFile);

export const TOOL_SPEC_VERSION = (spec as SpecFile).specVersion ?? "0.0.0";
export const TOOLS: ToolDef[] = (spec as SpecFile).tools;
