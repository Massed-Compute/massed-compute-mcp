/**
 * `massed-compute-mcp logout`
 *
 * Removes the stored config file. The MCP_API_KEY env var and any inline
 * --token flags are unaffected — this only clears the file we wrote during
 * `init`.
 */

import { configPath, deleteConfig } from "../config.js";

export const runLogout = async (_argv: string[]): Promise<number> => {
  const deleted = deleteConfig();
  if (deleted) {
    console.log(`Removed ${configPath()}`);
  } else {
    console.log(`No stored config to remove (looked at ${configPath()}).`);
  }
  console.log("Note: the MASSED_COMPUTE_API_KEY env var, if set, remains in effect.");
  return 0;
};
