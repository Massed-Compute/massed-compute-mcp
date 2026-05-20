#!/usr/bin/env node
// Copies the canonical tools.json spec into each language package's source
// tree so it can be imported with normal module resolution. Run before every
// build and as a `prepublishOnly` gate so a packaged release can never ship
// a stale spec.
//
// This script is the *only* writer of the per-package copies. Editing them
// by hand would be silently overwritten on the next build — edit tools.json
// at the repo root instead.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const spec = path.join(repoRoot, "tools.json");

if (!fs.existsSync(spec)) {
  console.error(`[sync-tools] tools.json not found at ${spec}`);
  process.exit(1);
}

const raw = fs.readFileSync(spec, "utf8");
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  console.error(`[sync-tools] tools.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(parsed.tools) || parsed.tools.length === 0) {
  console.error("[sync-tools] tools.json must contain a non-empty `tools` array");
  process.exit(1);
}

const targets = [
  path.join(repoRoot, "packages", "node", "src", "tools-spec.json"),
  path.join(repoRoot, "packages", "python", "src", "massed_compute_mcp", "tools_spec.json"),
];

for (const target of targets) {
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    console.error(`[sync-tools] target directory missing: ${dir}`);
    process.exit(1);
  }
  fs.writeFileSync(target, raw, "utf8");
  const rel = path.relative(repoRoot, target);
  console.log(`[sync-tools] wrote ${rel} (${parsed.tools.length} tools)`);
}

// Also keep each package's README / LICENSE in sync with the repo root so
// `npm publish` and `python -m build` include the canonical docs without
// requiring a separate per-package copy step.
const docTargets = [
  ["README.md", path.join(repoRoot, "packages", "node", "README.md")],
  ["LICENSE", path.join(repoRoot, "packages", "node", "LICENSE")],
  ["README.md", path.join(repoRoot, "packages", "python", "README.md")],
  ["LICENSE", path.join(repoRoot, "packages", "python", "LICENSE")],
];

for (const [src, dest] of docTargets) {
  const srcAbs = path.join(repoRoot, src);
  if (!fs.existsSync(srcAbs)) continue;
  if (!fs.existsSync(path.dirname(dest))) continue;
  fs.copyFileSync(srcAbs, dest);
  console.log(`[sync-tools] copied ${src} → ${path.relative(repoRoot, dest)}`);
}
