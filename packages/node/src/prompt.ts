/**
 * Minimal interactive prompts without external dependencies.
 *
 * We deliberately avoid pulling in `@inquirer/prompts` or similar — keeping
 * the runtime dep tree to just `@modelcontextprotocol/sdk` matters because
 * this package is global-installed (`npm i -g`) and runs on user machines
 * we don't control. Every transitive dep is supply-chain surface.
 */

import * as readline from "node:readline";

const isInteractive = (): boolean =>
  Boolean(process.stdin.isTTY && process.stdout.isTTY);

/**
 * Read a single line of input with the typed characters hidden — used for
 * the API-key entry in `init`. Implemented over stdin raw mode so it works
 * without bringing in a tty/readline-password library.
 */
export const promptHidden = (label: string): Promise<string> => {
  if (!isInteractive()) {
    return Promise.reject(
      new Error(
        "Interactive prompt requested but stdin is not a TTY. Pipe MASSED_COMPUTE_API_KEY in via env instead, or run `massed-compute-mcp init` directly in a terminal.",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(label);

    let buffer = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    // If we exit with the terminal still in raw mode (e.g. SIGTERM from the
    // parent shell, or a node panic), the user's tty stays broken until
    // they `stty sane`. Restore raw mode on every plausible exit signal.
    const restoreOnSignal = (signal: NodeJS.Signals) => {
      try { stdin.setRawMode(false); } catch { /* tty may already be closed */ }
      stdin.removeListener("data", onData);
      stdout.write("\n");
      // Re-raise the signal so the parent shell observes the right exit
      // status (128 + signum). process.exit with a numeric code would lie.
      process.kill(process.pid, signal);
    };
    const onSigInt = () => restoreOnSignal("SIGINT");
    const onSigTerm = () => restoreOnSignal("SIGTERM");
    process.once("SIGINT", onSigInt);
    process.once("SIGTERM", onSigTerm);

    const finish = (result: string | null, code = 0) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.off("SIGINT", onSigInt);
      process.off("SIGTERM", onSigTerm);
      stdout.write("\n");
      if (result === null) {
        // Ctrl+C from raw-mode input (not OS signal) — exit with the
        // conventional 128+SIGINT code so callers can tell user-abort apart
        // from validation failure.
        process.exit(code || 130);
      }
      resolve(result);
    };

    const onData = (chunk: Buffer | string): void => {
      const key = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const ch of key) {
        if (ch === "") {
          finish(null, 130);
          return;
        }
        if (ch === "\r" || ch === "\n") {
          finish(buffer);
          return;
        }
        if (ch === "" || ch === "\b") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        // Ignore other control chars (arrow keys, etc.) so they don't end
        // up in the key.
        if (ch.charCodeAt(0) < 0x20) continue;
        buffer += ch;
      }
    };

    stdin.on("data", onData);
    stdin.on("error", reject);
  });
};

export const promptYesNo = async (
  label: string,
  defaultYes = false,
): Promise<boolean> => {
  if (!isInteractive()) return defaultYes;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  return new Promise((resolve) => {
    rl.question(label + suffix, (answer) => {
      rl.close();
      const v = answer.trim().toLowerCase();
      if (v === "") return resolve(defaultYes);
      resolve(v === "y" || v === "yes");
    });
  });
};
