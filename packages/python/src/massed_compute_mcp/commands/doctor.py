"""`massed-compute-mcp doctor` — diagnostics."""

from __future__ import annotations

import sys

from ..config import config_path, resolve_auth
from ..tools import TOOLS
from ..upstream import validate_api_key


def _mask(key: str) -> str:
    if len(key) <= 8:
        return "***"
    return f"{key[:4]}…{key[-4:]}"


def run_doctor(_argv: list[str]) -> int:
    from .. import __version__

    print(f"massed-compute-mcp v{__version__}")
    print()

    auth = resolve_auth()
    print("Auth resolution")
    print("───────────────")
    if auth.source == "none":
        print("  no API key found")
        print(f"  config path: {config_path()}")
        print()
        print("Fix: run `massed-compute-mcp init`.")
        return 1
    print(f"  source:    {auth.source}")
    print(f"  key:       {_mask(auth.api_key or '')}")
    print(f"  base url:  {auth.base_url}")
    if auth.source == "config":
        print(f"  file:      {config_path()}")
    print()

    sys.stdout.write("Upstream check… ")
    sys.stdout.flush()
    result = validate_api_key(auth.api_key or "", auth.base_url)
    if result.status == "ok":
        print("ok")
    elif result.status == "unauthorized":
        print(f"failed (HTTP {result.http_status} — key rejected)")
        print()
        print("Fix: run `massed-compute-mcp init` and paste a fresh key.")
        return 2
    elif result.status == "network_error":
        print(f"failed (network: {result.detail})")
        return 3
    else:
        print(f"failed (HTTP {result.http_status})")
        return 4
    print()

    print(f"Tool catalog ({len(TOOLS)} total)")
    print("─────────────")
    for t in TOOLS:
        ann = t.get("annotations") or {}
        if ann.get("destructiveHint"):
            mark = "⚠ destructive"
        elif ann.get("readOnlyHint"):
            mark = "  read-only"
        else:
            mark = "  mutates"
        print(f"  {mark}  {t['name']:<30} {t.get('title', '')}")
    print()
    print(
        "Note: tools requiring full-access keys will return 403 to read-only keys at call time."
    )
    print()

    print("Client wiring")
    print("─────────────")
    print("Claude Code:")
    print("  claude mcp add --transport stdio massed-compute massed-compute-mcp")
    print()
    print('Or paste into ~/.claude.json under "mcpServers":')
    print('{ "massed-compute": { "command": "massed-compute-mcp" } }')
    print()
    print("Or let us do it for you:")
    print("  massed-compute-mcp install-client claude-code")
    print("  massed-compute-mcp install-client cursor")
    print("  massed-compute-mcp install-client claude-desktop")
    return 0
