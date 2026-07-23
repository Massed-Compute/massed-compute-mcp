"""Verbatim JSON-RPC pass-through to the hosted Massed Compute MCP endpoint
(`<base_url>/api/mcp`, streamable HTTP). Mirror of packages/node/src/proxy.ts.

Every message read from the client is POSTed to the upstream unchanged —
this package adds no tool catalog, no schema mangling, no response
rewriting. The only things injected are transport-level headers: the
stored API key as a Bearer ``Authorization`` header, plus the
``MCP-Protocol-Version`` / ``Mcp-Session-Id`` bookkeeping the streamable
HTTP transport spec requires.
"""

from __future__ import annotations

import json
import sys
import threading
from typing import Any

import httpx

MCP_ENDPOINT_PATH = "/api/mcp"

# Per-request timeout — a stuck upstream must not hang the MCP request
# indefinitely.
REQUEST_TIMEOUT_S = 30.0

# Refuse upstream responses larger than this cap. Defense-in-depth against
# a misbehaving or compromised upstream returning multi-GB payloads.
MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5 MiB

RPC_PARSE_ERROR = -32700
RPC_INVALID_REQUEST = -32600
RPC_INTERNAL_ERROR = -32603
RPC_UNAUTHORIZED = -32001
RPC_FORBIDDEN = -32003


def parse_error() -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": None, "error": {"code": RPC_PARSE_ERROR, "message": "Parse error"}}


def _http_status_to_rpc_code(status: int) -> int:
    if status == 401:
        return RPC_UNAUTHORIZED
    if status == 403:
        return RPC_FORBIDDEN
    if 400 <= status < 500:
        return RPC_INVALID_REQUEST
    return RPC_INTERNAL_ERROR


def _is_jsonrpc_message(value: Any) -> bool:
    return isinstance(value, dict) and value.get("jsonrpc") == "2.0"


def _parse_sse_messages(body: str) -> list[dict[str, Any]]:
    """Extract JSON-RPC messages from a ``text/event-stream`` body."""
    out: list[dict[str, Any]] = []
    for event in body.replace("\r\n", "\n").split("\n\n"):
        data_lines = [
            line[len("data:"):].lstrip() for line in event.split("\n") if line.startswith("data:")
        ]
        if not data_lines:
            continue
        try:
            parsed = json.loads("\n".join(data_lines))
        except json.JSONDecodeError:
            continue  # non-JSON SSE data (keepalives etc.)
        if _is_jsonrpc_message(parsed):
            out.append(parsed)
    return out


class UpstreamSession:
    """One logical client connection to the upstream. Tracks the negotiated
    protocol version (from the ``initialize`` response) and the upstream
    session id (from the ``Mcp-Session-Id`` response header, if the upstream
    ever becomes stateful — today it is stateless and never sets one).

    Thread-safe: ``forward`` may be called from multiple worker threads.
    """

    def __init__(self, base_url: str, auth_header: str | None = None) -> None:
        self._base_url = base_url
        self._auth_header = auth_header
        self._protocol_version: str | None = None
        self._session_id: str | None = None
        self._lock = threading.Lock()
        self._client = httpx.Client(timeout=REQUEST_TIMEOUT_S)

    def endpoint(self) -> str:
        return f"{self._base_url.rstrip('/')}{MCP_ENDPOINT_PATH}"

    def close(self) -> None:
        self._client.close()

    def forward(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        """Forward one JSON-RPC message verbatim. Returns the JSON-RPC
        messages to relay back to the client (empty for notifications,
        which the upstream acknowledges with a bodyless 202)."""
        is_request = message.get("id") is not None

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self._auth_header:
            headers["Authorization"] = self._auth_header
        with self._lock:
            if self._protocol_version:
                headers["MCP-Protocol-Version"] = self._protocol_version
            if self._session_id:
                headers["Mcp-Session-Id"] = self._session_id

        try:
            res = self._client.post(self.endpoint(), headers=headers, content=json.dumps(message))
        except httpx.HTTPError as err:
            # Log full detail to stderr (only the operator sees this);
            # return a stable message to the MCP client so we don't leak
            # DNS/IP/error-code hints about the upstream infrastructure.
            sys.stderr.write(f"[mcp] upstream fetch error: {self.endpoint()} {err}\n")
            if is_request:
                return [self._error_response(message, RPC_INTERNAL_ERROR, "Upstream fetch failed.")]
            return []

        new_session_id = res.headers.get("Mcp-Session-Id")
        if new_session_id:
            with self._lock:
                self._session_id = new_session_id

        # Notifications/responses are acknowledged with 202 and no body.
        if res.status_code in (202, 204):
            return []

        declared = res.headers.get("Content-Length")
        if declared and declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
            if is_request:
                return [
                    self._error_response(
                        message, RPC_INTERNAL_ERROR, "Upstream response too large; refused."
                    )
                ]
            return []

        body = res.text
        if len(body) > MAX_RESPONSE_BYTES:
            if is_request:
                return [
                    self._error_response(
                        message, RPC_INTERNAL_ERROR, "Upstream response too large; refused."
                    )
                ]
            return []

        content_type = (res.headers.get("Content-Type") or "").lower()
        if "text/event-stream" in content_type:
            messages = _parse_sse_messages(body)
        else:
            try:
                parsed = json.loads(body) if body else None
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                messages = [m for m in parsed if _is_jsonrpc_message(m)]
            elif _is_jsonrpc_message(parsed):
                messages = [parsed]
            else:
                # Non-JSON-RPC body (e.g. an HTML error page from a proxy
                # layer). Synthesize an error for requests; drop otherwise.
                if is_request:
                    return [
                        self._error_response(
                            message,
                            _http_status_to_rpc_code(res.status_code),
                            f"Upstream returned HTTP {res.status_code} with a non-MCP response.",
                        )
                    ]
                return []

        if message.get("method") == "initialize":
            for m in messages:
                version = (m.get("result") or {}).get("protocolVersion") if isinstance(m.get("result"), dict) else None
                if m.get("id") == message.get("id") and isinstance(version, str):
                    with self._lock:
                        self._protocol_version = version

        return messages

    @staticmethod
    def _error_response(request: dict[str, Any], code: int, msg: str) -> dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "error": {"code": code, "message": msg},
        }
