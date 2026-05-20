"""The MCP server itself — stdio transport, declarative tool catalog, single
shared forwarder. Mirrors packages/node/src/commands/server.ts."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode

import httpx
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from .config import resolve_auth
from .tools import TOOLS

from . import __version__ as SERVER_VERSION

SERVER_NAME = "massed-compute-mcp"

_METHODS_WITH_BODY = {"POST", "PUT", "PATCH"}


def _build_request(tool: dict, args: dict[str, Any], base_url: str) -> tuple[str, str | None]:
    """Compute the (url, body) pair for a tool's upstream call.

    `path` may contain `{name}` placeholders that are filled from
    `args[pathParams[name]]`. The matching args are removed before the
    remainder is used as either query string or JSON body.
    """
    upstream = tool["upstream"]
    method = upstream["method"]
    path = upstream["path"]
    remaining = dict(args)
    for placeholder, arg_key in upstream.get("pathParams", {}).items():
        if arg_key not in remaining or remaining[arg_key] is None:
            raise ValueError(
                f'Tool "{tool["name"]}": missing argument "{arg_key}" for path placeholder {{{placeholder}}}.'
            )
        from urllib.parse import quote

        path = path.replace(f"{{{placeholder}}}", quote(str(remaining.pop(arg_key)), safe=""))
    has_body = method in _METHODS_WITH_BODY
    url = f"{base_url.rstrip('/')}{path}"
    if has_body:
        return url, json.dumps(remaining if remaining else {})
    filtered = {k: v for k, v in remaining.items() if v is not None}
    if filtered:
        url = f"{url}?{urlencode(filtered, doseq=True)}"
    return url, None


def _http_status_to_error_label(status: int) -> str:
    if status == 401:
        return "unauthorized"
    if status == 403:
        return "forbidden"
    if status == 404:
        return "not_found"
    if status == 422:
        return "invalid_params"
    if 400 <= status < 500:
        return "invalid_request"
    return "internal_error"


MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5 MiB
REQUEST_TIMEOUT_S = 30.0


async def _forward(tool: dict, args: dict, auth_header: str, base_url: str) -> list[TextContent]:
    try:
        url, body = _build_request(tool, args, base_url)
    except ValueError as err:
        return [TextContent(type="text", text=str(err))]

    headers = {
        "Content-Type": "application/json",
        "Authorization": auth_header,
    }
    method = tool["upstream"]["method"]

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        try:
            res = await client.request(method, url, headers=headers, content=body)
        except httpx.HTTPError as err:
            return [TextContent(type="text", text=f"Upstream fetch failed: {err}")]

    # Defense-in-depth response size cap. Check declared length first
    # (cheap), then enforce a hard cap on the materialized body.
    declared = res.headers.get("Content-Length")
    if declared and declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
        return [
            TextContent(
                type="text",
                text=f"Upstream response declared {declared} bytes (> {MAX_RESPONSE_BYTES // (1024 * 1024)} MiB); refused.",
            )
        ]

    is_json = "application/json" in (res.headers.get("Content-Type") or "").lower()
    if is_json:
        try:
            parsed = res.json()
            text_body = json.dumps(parsed, indent=2)
        except json.JSONDecodeError:
            text_body = res.text
    else:
        text_body = res.text

    if len(text_body) > MAX_RESPONSE_BYTES:
        return [
            TextContent(
                type="text",
                text=f"Upstream response exceeded {MAX_RESPONSE_BYTES // (1024 * 1024)} MiB bytes; refused.",
            )
        ]

    if not res.is_success:
        return [
            TextContent(
                type="text",
                text=f"[{_http_status_to_error_label(res.status_code)} {res.status_code}] {text_body}",
            )
        ]
    return [TextContent(type="text", text=text_body)]


def _build_server(auth_header: str, base_url: str) -> Server:
    server: Server = Server(SERVER_NAME, version=SERVER_VERSION)

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        out: list[Tool] = []
        for t in TOOLS:
            out.append(
                Tool(
                    name=t["name"],
                    title=t.get("title"),
                    description=t.get("description", ""),
                    inputSchema=t.get("inputSchema", {"type": "object", "properties": {}}),
                    annotations=t.get("annotations"),
                )
            )
        return out

    @server.call_tool()
    async def call_tool(name: str, arguments: dict | None) -> list[TextContent]:
        tool = next((t for t in TOOLS if t["name"] == name), None)
        if tool is None:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]
        return await _forward(tool, arguments or {}, auth_header, base_url)

    return server


async def run() -> int:
    """Entry point for the `server` subcommand. Returns a process exit code."""
    auth = resolve_auth()
    if not auth.api_key:
        import sys

        sys.stderr.write(
            "[mcp] No API key configured. Run `massed-compute-mcp init`, or set MASSED_COMPUTE_API_KEY.\n"
        )
        return 1
    auth_header = f"Bearer {auth.api_key}"
    server = _build_server(auth_header, auth.base_url)
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())
    return 0
