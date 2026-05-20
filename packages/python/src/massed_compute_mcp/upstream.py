"""HTTP-level helpers for the small set of upstream calls the CLI itself
makes. The MCP server's per-tool forwarder is separate (server.py)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import httpx

TOKEN_VALIDATION_PATH = "/api/v1/account/token/validation"


@dataclass
class ValidationResult:
    status: Literal["ok", "unauthorized", "upstream_error", "network_error"]
    http_status: int = 0
    detail: str = ""


def validate_api_key(api_key: str, base_url: str, *, timeout: float = 30.0) -> ValidationResult:
    url = f"{base_url.rstrip('/')}{TOKEN_VALIDATION_PATH}"
    try:
        res = httpx.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={},
            timeout=timeout,
        )
    except httpx.HTTPError as err:
        return ValidationResult(status="network_error", detail=str(err))
    if res.is_success:
        return ValidationResult(status="ok", http_status=res.status_code)
    if res.status_code in (401, 403):
        return ValidationResult(status="unauthorized", http_status=res.status_code)
    return ValidationResult(status="upstream_error", http_status=res.status_code)
