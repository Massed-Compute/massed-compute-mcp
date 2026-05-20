"""Tool catalog. Loads from tools_spec.json, which is synced from the
canonical tools.json at the repo root by scripts/sync-tools.mjs."""

from __future__ import annotations

import json
from importlib import resources
from typing import Any, TypedDict


class UpstreamCall(TypedDict, total=False):
    method: str
    path: str
    pathParams: dict[str, str]


class ToolDef(TypedDict, total=False):
    name: str
    title: str
    description: str
    inputSchema: dict[str, Any]
    outputSchema: dict[str, Any]
    annotations: dict[str, Any]
    upstream: UpstreamCall


VALID_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def _validate(tools: list[ToolDef]) -> None:
    """Sanity-check the loaded spec.

    Defends against the case where a malicious or tampered tools_spec.json
    is shipped or modified post-install — without this, the server would
    happily forward tool calls to whatever path the attacker chose. The
    check is narrow (name + method + /api/v1/ prefix + no traversal
    segments) to stay tolerant of legitimate spec evolution.
    """
    if not isinstance(tools, list) or not tools:
        raise ValueError("tools_spec.json: 'tools' must be a non-empty array")
    for t in tools:
        name = t.get("name") if isinstance(t, dict) else None
        if not isinstance(name, str) or not name:
            raise ValueError("tools_spec.json: tool is missing 'name'")
        u = t.get("upstream")
        if not isinstance(u, dict) or u.get("method") not in VALID_METHODS:
            raise ValueError(f"tools_spec.json: {name} has invalid upstream.method")
        path = u.get("path")
        if not isinstance(path, str) or not path.startswith("/api/v1/"):
            raise ValueError(f"tools_spec.json: {name} upstream.path must start with /api/v1/")
        if "/../" in path or "/./" in path or "//" in path:
            raise ValueError(
                f"tools_spec.json: {name} upstream.path contains forbidden traversal segments"
            )


def _load() -> tuple[str, list[ToolDef]]:
    with resources.files("massed_compute_mcp").joinpath("tools_spec.json").open("r", encoding="utf-8") as f:
        raw = json.load(f)
    tools = raw["tools"]
    _validate(tools)
    return raw.get("specVersion", "0.0.0"), tools


TOOL_SPEC_VERSION, TOOLS = _load()
