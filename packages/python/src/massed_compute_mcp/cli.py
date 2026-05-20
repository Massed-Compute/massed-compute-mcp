"""CLI dispatcher.

No subcommand or an unknown one defaults to `server` so MCP clients that
spawn the binary with no arguments still get an MCP server. All user-
facing CLI operations are explicit subcommands.
"""

from __future__ import annotations

import asyncio
import sys

from . import __version__
from .commands.doctor import run_doctor
from .commands.init import run_init
from .commands.install_client import run_install_client
from .commands.uninstall_client import run_uninstall_client
from .commands.config_show import run_config_show
from .commands.logout import run_logout
from .commands.tools_list import run_tools
from .config import set_cli_override

HELP = f"""massed-compute-mcp v{__version__}

Run the Massed Compute MCP server, or manage its configuration.

USAGE
  massed-compute-mcp [command] [options]

COMMANDS
  server                  Run the MCP server over stdio (default).
  init [--yes] [--token-file <path>] [--clients <a,b,c>] [--no-install-clients]
                          One-shot setup: validate + store an API key, then
                          detect installed MCP clients (Claude Code, Cursor,
                          Claude Desktop, Codex) and offer to wire each one
                          up. With --yes, auto-wires every detected client.
                          --clients foo,bar overrides detection.
                          Idempotent: re-runs with the same key revalidate
                          and refresh validatedAt without prompting.
  doctor                  Verify the stored key works and print client
                          configuration snippets.
  config show             Print where the config file lives and its (masked)
                          contents. No upstream call.
  install-client <id> [-y] Wire this server into a single MCP client config
                          (most users just need 'init' — this is for adding
                          a client AFTER initial setup, like installing
                          Cursor next week).
                          ids: claude-code, cursor, claude-desktop, codex
  uninstall-client <id>   Remove this server from a client config (creates a
                          timestamped backup first).
  logout                  Delete the stored API key.
  tools [--json]          Print the tool catalog (does not call the upstream).
  version                 Print the version.
  help                    Show this message.

GLOBAL OPTIONS
  --token <key>           Override the API key for this invocation. Note:
                          visible in `ps`; prefer --token-file for unattended runs.
  --token-file <path>     Read the API key from a file. The file's first line
                          is used; trailing whitespace is stripped.
  --base-url <url>        Override the upstream (defaults to https://vm.massedcompute.com).

ENVIRONMENT
  MASSED_COMPUTE_API_KEY        API key, overrides the stored config.
  MASSED_COMPUTE_API_BASE_URL   Upstream base URL (defaults to https://vm.massedcompute.com).

EXAMPLES
  massed-compute-mcp init
  massed-compute-mcp doctor
  massed-compute-mcp install-client claude-code
  massed-compute-mcp --token "k.s" server
"""


def _extract_global_flags(argv: list[str]) -> tuple[str | None, str | None, list[str]]:
    """Pull --token / --token-file / --base-url out of argv. Return
    (token, base_url, rest).

    Hand-rolled rather than argparse because argparse would also need to
    know every subcommand's own flags or it would error on them.
    """
    rest: list[str] = []
    token: str | None = None
    token_file: str | None = None
    base_url: str | None = None
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--token":
            if i + 1 >= len(argv):
                raise ValueError("--token requires a value")
            token = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--token="):
            token = arg[len("--token="):]
            i += 1
            continue
        if arg == "--token-file":
            if i + 1 >= len(argv):
                raise ValueError("--token-file requires a path")
            token_file = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--token-file="):
            token_file = arg[len("--token-file="):]
            i += 1
            continue
        if arg == "--base-url":
            if i + 1 >= len(argv):
                raise ValueError("--base-url requires a value")
            base_url = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--base-url="):
            base_url = arg[len("--base-url="):]
            i += 1
            continue
        rest.append(arg)
        i += 1
    if token_file and not token:
        # --token wins if both are given. Strip whitespace so the file can
        # end with a trailing newline.
        from pathlib import Path

        contents = Path(token_file).read_text(encoding="utf-8")
        token = contents.strip()
        if not token:
            raise ValueError(f"--token-file {token_file} is empty")
    return token, base_url, rest


def main() -> int:
    raw = sys.argv[1:]
    try:
        token, base_url, rest = _extract_global_flags(raw)
    except ValueError as err:
        sys.stderr.write(f"massed-compute-mcp: {err}\n\n")
        sys.stdout.write(HELP)
        return 2
    if token or base_url:
        set_cli_override(api_key=token, base_url=base_url)

    cmd = rest[0] if rest else "server"
    rest = rest[1:]

    if cmd == "server":
        from .server import run as server_run

        return asyncio.run(server_run())
    if cmd in ("init", "login"):
        return run_init(rest)
    if cmd == "doctor":
        return run_doctor(rest)
    if cmd == "logout":
        return run_logout(rest)
    if cmd == "install-client":
        return run_install_client(rest)
    if cmd == "uninstall-client":
        return run_uninstall_client(rest)
    if cmd == "config":
        if rest and rest[0] == "show":
            return run_config_show(rest[1:])
        sys.stderr.write(f"Unknown config subcommand: {rest[0] if rest else '(none)'}\n")
        sys.stderr.write("Supported: config show\n")
        return 2
    if cmd == "tools":
        return run_tools(rest)
    if cmd in ("version", "--version", "-v"):
        print(__version__)
        return 0
    if cmd in ("help", "--help", "-h"):
        sys.stdout.write(HELP)
        return 0

    sys.stderr.write(f"Unknown command: {cmd}\n\n")
    sys.stdout.write(HELP)
    return 2
