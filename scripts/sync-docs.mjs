#!/usr/bin/env node
// Copies the repo-root README / LICENSE into each package so `npm publish`
// and `python -m build` include the canonical docs without a separate
// per-package copy step. The single source of truth lives at the repo root.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
  console.log(`[sync-docs] copied ${src} → ${path.relative(repoRoot, dest)}`);
}
