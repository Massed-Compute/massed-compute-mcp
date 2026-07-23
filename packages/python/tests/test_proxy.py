"""Tests for the verbatim JSON-RPC pass-through (proxy.py).

Runs a real local HTTP server rather than mocking httpx so the tests
exercise the same request/response path the shipped package uses.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from massed_compute_mcp.proxy import UpstreamSession, parse_error

PORT = 18094
BASE_URL = f"http://localhost:{PORT}"

seen: list[dict] = []
responder = None  # set per-test: fn(msg, handler) -> None


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 - http.server API
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        record = {"path": self.path, "headers": dict(self.headers), "body": body}
        seen.append(record)
        responder(json.loads(body), self)

    def log_message(self, *args):  # silence request logging
        pass

    def reply_json(self, payload: dict, status: int = 200, headers: dict | None = None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _echo(msg, handler):
    handler.reply_json({"jsonrpc": "2.0", "id": msg.get("id"), "result": {"echo": msg.get("method")}})


@pytest.fixture(autouse=True)
def _reset():
    global responder
    seen.clear()
    responder = _echo
    yield


@pytest.fixture(scope="module", autouse=True)
def _server():
    httpd = HTTPServer(("localhost", PORT), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield
    httpd.shutdown()


def _session(auth: str | None = "Bearer k-123") -> UpstreamSession:
    return UpstreamSession(BASE_URL, auth_header=auth)


def test_posts_verbatim_to_api_mcp_with_bearer_header():
    request = {
        "jsonrpc": "2.0",
        "id": 7,
        "method": "tools/call",
        "params": {"name": "instances_list", "arguments": {"nested": {"keep": [1, 2, 3]}}},
    }
    out = _session().forward(request)
    assert len(seen) == 1
    assert seen[0]["path"] == "/api/mcp"
    assert seen[0]["headers"]["Authorization"] == "Bearer k-123"
    assert json.loads(seen[0]["body"]) == request
    assert out == [{"jsonrpc": "2.0", "id": 7, "result": {"echo": "tools/call"}}]


def test_no_auth_header_when_no_key():
    _session(auth=None).forward({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert "Authorization" not in seen[0]["headers"]


def test_relays_upstream_jsonrpc_errors_verbatim():
    global responder

    def responder_fn(msg, handler):
        handler.reply_json(
            {
                "jsonrpc": "2.0",
                "id": msg.get("id"),
                "error": {"code": -32602, "message": "read-only key", "data": {"scope": "ro"}},
            }
        )

    responder = responder_fn
    out = _session().forward({"jsonrpc": "2.0", "id": 3, "method": "tools/call"})
    assert out == [
        {
            "jsonrpc": "2.0",
            "id": 3,
            "error": {"code": -32602, "message": "read-only key", "data": {"scope": "ro"}},
        }
    ]


def test_notification_202_returns_nothing():
    global responder

    def responder_fn(_msg, handler):
        handler.send_response(202)
        handler.send_header("Content-Length", "0")
        handler.end_headers()

    responder = responder_fn
    out = _session().forward({"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert out == []


def test_synthesizes_error_for_non_mcp_body():
    global responder

    def responder_fn(_msg, handler):
        body = b"<html>denied</html>"
        handler.send_response(401)
        handler.send_header("Content-Type", "text/html")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)

    responder = responder_fn
    out = _session().forward({"jsonrpc": "2.0", "id": 9, "method": "tools/list"})
    assert len(out) == 1
    assert out[0]["id"] == 9
    assert out[0]["error"]["code"] == -32001


def test_parses_sse_responses():
    global responder

    def responder_fn(msg, handler):
        payload = json.dumps({"jsonrpc": "2.0", "id": msg.get("id"), "result": {"via": "sse"}})
        body = f"event: message\ndata: {payload}\n\n".encode("utf-8")
        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)

    responder = responder_fn
    out = _session().forward({"jsonrpc": "2.0", "id": 4, "method": "ping"})
    assert out == [{"jsonrpc": "2.0", "id": 4, "result": {"via": "sse"}}]


def test_captures_protocol_version_and_session_id():
    global responder

    def responder_fn(msg, handler):
        if msg.get("method") == "initialize":
            handler.reply_json(
                {
                    "jsonrpc": "2.0",
                    "id": msg.get("id"),
                    "result": {"protocolVersion": "2025-06-18", "capabilities": {}},
                },
                headers={"Mcp-Session-Id": "sid-42"},
            )
        else:
            handler.reply_json({"jsonrpc": "2.0", "id": msg.get("id"), "result": {}})

    responder = responder_fn
    s = _session()
    s.forward({"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {}})
    assert "MCP-Protocol-Version" not in seen[0]["headers"]
    s.forward({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert seen[1]["headers"]["MCP-Protocol-Version"] == "2025-06-18"
    assert seen[1]["headers"]["Mcp-Session-Id"] == "sid-42"


def test_refuses_oversized_responses():
    global responder

    def responder_fn(msg, handler):
        handler.reply_json(
            {"jsonrpc": "2.0", "id": msg.get("id"), "result": {"blob": "x" * (6 * 1024 * 1024)}}
        )

    responder = responder_fn
    out = _session().forward({"jsonrpc": "2.0", "id": 5, "method": "tools/call"})
    assert len(out) == 1
    assert "too large" in out[0]["error"]["message"]


def test_synthesizes_internal_error_when_unreachable():
    s = UpstreamSession("http://localhost:1", auth_header="Bearer k")
    out = s.forward({"jsonrpc": "2.0", "id": 6, "method": "ping"})
    assert len(out) == 1
    assert out[0]["error"]["code"] == -32603


def test_parse_error_shape():
    assert parse_error() == {
        "jsonrpc": "2.0",
        "id": None,
        "error": {"code": -32700, "message": "Parse error"},
    }
