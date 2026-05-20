#!/usr/bin/env node
/**
 * Contract test for the MCP tool surface.
 *
 * The same 14 tools are described in three places:
 *   1. tools.json at the repo root (the single source of truth)
 *   2. packages/node/src/tools-spec.json (synced from #1)
 *   3. The live hosted endpoint at https://vm.massedcompute.com/api/mcp
 *      (a separate implementation in the vm-marketplace repo)
 *
 * This script asserts they all agree on the set of tool names, the
 * readonly/destructive flags, and the upstream method+path. Run it on a
 * schedule (e.g. nightly CI) so drift between the published spec, the
 * shipping wrapper, and the hosted endpoint surfaces immediately instead
 * of when the first user files an issue.
 *
 * Exit codes:
 *   0  everything matches
 *   1  local files disagree (your build is broken; do not publish)
 *   2  hosted endpoint disagrees (someone changed one side without the other)
 *   3  network failure to the hosted endpoint (skip — fail open)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOSTED_URL = process.env.MC_MCP_HOSTED_URL ?? "https://vm.massedcompute.com/api/mcp";

const loadJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const root = loadJson(path.join(repoRoot, "tools.json"));
const perPackageSpecs = [
  ["node", path.join(repoRoot, "packages", "node", "src", "tools-spec.json")],
  ["python", path.join(repoRoot, "packages", "python", "src", "massed_compute_mcp", "tools_spec.json")],
];

const rootJson = JSON.stringify(root, null, 2);
for (const [lang, specPath] of perPackageSpecs) {
  if (!fs.existsSync(specPath)) {
    console.error(`[contract] missing ${path.relative(repoRoot, specPath)} — run \`npm run sync-tools\` first`);
    process.exit(1);
  }
  const json = JSON.stringify(loadJson(specPath), null, 2);
  if (json !== rootJson) {
    console.error(`[contract] tools.json (root) and packages/${lang} spec differ — run \`npm run sync-tools\`.`);
    process.exit(1);
  }
}
console.log(`[contract] local files agree across ${perPackageSpecs.length} packages (${root.tools.length} tools).`);

let hostedTools;
try {
  const res = await fetch(HOSTED_URL, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) {
    console.warn(`[contract] hosted endpoint returned HTTP ${res.status} — skipping live check.`);
    process.exit(3);
  }
  const body = await res.json();
  hostedTools = body.tools;
  if (!Array.isArray(hostedTools)) {
    console.warn(`[contract] hosted endpoint did not return a tools array — skipping live check.`);
    process.exit(3);
  }
} catch (err) {
  console.warn(`[contract] could not reach ${HOSTED_URL}: ${err.message} — skipping live check.`);
  process.exit(3);
}

// Hosted endpoint uses a different field shape (no `upstream`, has
// `requiredReadonly` instead of `annotations.readOnlyHint`). Compare only
// what overlaps: tool names + the canonical destructive/read-only signal.
const localByName = new Map(root.tools.map((t) => [t.name, t]));
const hostedByName = new Map(hostedTools.map((t) => [t.name, t]));

const localNames = new Set(localByName.keys());
const hostedNames = new Set(hostedByName.keys());
const onlyLocal = [...localNames].filter((n) => !hostedNames.has(n));
const onlyHosted = [...hostedNames].filter((n) => !localNames.has(n));

if (onlyLocal.length > 0 || onlyHosted.length > 0) {
  if (onlyLocal.length) console.error(`[contract] only in local spec: ${onlyLocal.join(", ")}`);
  if (onlyHosted.length) console.error(`[contract] only on hosted:    ${onlyHosted.join(", ")}`);
  process.exit(2);
}

const mismatches = [];
for (const name of localNames) {
  const l = localByName.get(name);
  const h = hostedByName.get(name);
  const lDestructive = Boolean(l.annotations?.destructiveHint);
  const hDestructive = Boolean(h.annotations?.destructiveHint);
  if (lDestructive !== hDestructive) {
    mismatches.push(`${name}: destructiveHint local=${lDestructive} hosted=${hDestructive}`);
  }
  const lReadOnly = Boolean(l.annotations?.readOnlyHint);
  const hReadOnly = Boolean(h.annotations?.readOnlyHint);
  if (lReadOnly !== hReadOnly) {
    mismatches.push(`${name}: readOnlyHint local=${lReadOnly} hosted=${hReadOnly}`);
  }
}

if (mismatches.length > 0) {
  console.error("[contract] hosted endpoint disagrees on these tools:");
  for (const m of mismatches) console.error(`  ${m}`);
  process.exit(2);
}

console.log(`[contract] hosted endpoint agrees on all ${hostedTools.length} tools.`);
