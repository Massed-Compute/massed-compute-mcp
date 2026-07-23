"""The MCP server itself — a stdio ↔ streamable-HTTP bridge to the hosted
MCP endpoint. Mirrors packages/node/src/commands/server.ts.

Every JSON-RPC message on stdin is forwarded verbatim to
``<base_url>/api/mcp`` with the resolved API key injected as a Bearer
header; upstream responses are written verbatim to stdout. The upstream
owns the tool catalog, schemas, scope enforcement, and redaction.
"""

from __future__ import annotations

import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .config import resolve_auth
from .proxy import UpstreamSession, parse_error


def run() -> int:
    """Entry point for the `server` subcommand. Returns a process exit code."""
    auth = resolve_auth()
    if not auth.api_key:
        sys.stderr.write(
            "[mcp] No API key configured. Run `massed-compute-mcp init`, or set MASSED_COMPUTE_API_KEY.\n"
        )
        return 1

    session = UpstreamSession(auth.base_url, auth_header=f"Bearer {auth.api_key}")
    stdout_lock = threading.Lock()

    def write(msg: dict[str, Any]) -> None:
        with stdout_lock:
            sys.stdout.write(json.dumps(msg) + "\n")
            sys.stdout.flush()

    def handle(line: str) -> None:
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            write(parse_error())
            return
        try:
            for response in session.forward(message):
                write(response)
        except Exception as err:  # pragma: no cover - defensive backstop
            sys.stderr.write(f"[mcp] unexpected proxy error: {err}\n")

    # Forward concurrently — a slow tools/call must not block pings.
    # JSON-RPC responses are matched by id, so interleaving is fine.
    with ThreadPoolExecutor(max_workers=8) as pool:
        for line in sys.stdin:
            stripped = line.strip()
            if stripped:
                pool.submit(handle, stripped)
    session.close()
    return 0
