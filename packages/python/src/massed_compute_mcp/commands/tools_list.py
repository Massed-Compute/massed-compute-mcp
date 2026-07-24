"""`massed-compute-mcp tools` — fetch and print the live tool catalog.

There is no local catalog to print — this package is a verbatim
pass-through, so the upstream is the only source of truth. The catalog
is the same for every key; read-only keys are rejected at tools/call
time (-32003) when they invoke a mutating tool.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from ..config import resolve_auth
from ..proxy import UpstreamSession


def fetch_tool_catalog() -> list[dict[str, Any]]:
    auth = resolve_auth()
    session = UpstreamSession(
        auth.base_url,
        auth_header=f"Bearer {auth.api_key}" if auth.api_key else None,
    )
    try:
        responses = session.forward({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    finally:
        session.close()
    response = next((m for m in responses if m.get("id") == 1), None)
    if response is None or response.get("error"):
        raise RuntimeError(
            f"tools/list failed against {session.endpoint()}: "
            f"{json.dumps(response.get('error')) if response else 'no response'}"
        )
    tools = (response.get("result") or {}).get("tools")
    if not isinstance(tools, list):
        raise RuntimeError(f"tools/list returned an unexpected shape from {session.endpoint()}")
    return tools


def format_tool_line(t: dict[str, Any]) -> str:
    ann = t.get("annotations") or {}
    if ann.get("destructiveHint"):
        mark = " ⚠ destructive"
    elif ann.get("readOnlyHint"):
        mark = "  read-only"
    else:
        mark = "  mutates"
    return f" {mark}  {t.get('name', ''):<30} {t.get('title', '')}".rstrip()


def run_tools(argv: list[str]) -> int:
    try:
        tools = fetch_tool_catalog()
    except Exception as err:
        sys.stderr.write(f"{err}\n")
        return 1
    if "--json" in argv:
        print(json.dumps({"tools": tools}, indent=2))
        return 0
    print(f"{len(tools)} tools (live catalog from the hosted MCP endpoint)")
    print()
    for t in tools:
        print(format_tool_line(t))
    return 0
