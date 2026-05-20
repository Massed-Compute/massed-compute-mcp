/**
 * `massed-compute-mcp config show`
 *
 * Print where the config lives and a masked view of what's stored. Useful
 * for "where is my config again?" questions and for confirming the key
 * resolution chain without making a live upstream call (that's what
 * `doctor` is for).
 */

import * as fs from "node:fs";
import { configPath, readConfig, resolveAuth, DEFAULT_BASE_URL } from "../config.js";

const mask = (key: string): string => {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
};

export const runConfigShow = async (_argv: string[]): Promise<number> => {
  const file = configPath();
  console.log(`Config file: ${file}`);
  const exists = fs.existsSync(file);
  console.log(`Exists:      ${exists ? "yes" : "no"}`);

  if (exists) {
    const stored = readConfig();
    if (stored) {
      console.log(`Stored key:  ${mask(stored.apiKey)}`);
      console.log(`Base URL:    ${stored.baseUrl ?? DEFAULT_BASE_URL}`);
      if (stored.validatedAt) console.log(`Validated:   ${stored.validatedAt}`);
    } else {
      console.log("Stored key:  (file exists but is malformed; run `init` to overwrite)");
    }
  }
  console.log("");

  const auth = resolveAuth();
  console.log("Active resolution (what the MCP server would use right now):");
  console.log(`  source:    ${auth.source}`);
  if (auth.apiKey) console.log(`  key:       ${mask(auth.apiKey)}`);
  console.log(`  base url:  ${auth.baseUrl}`);
  if (auth.source === "none") {
    console.log("");
    console.log("Run `massed-compute-mcp init` to set a key.");
  }
  return 0;
};
