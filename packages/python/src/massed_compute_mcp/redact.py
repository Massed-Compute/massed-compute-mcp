"""Defense-in-depth redactor for upstream JSON proxied back to MCP clients.

Mirror of packages/node/src/redact.ts. Walks the parsed JSON value and
replaces any value whose key matches a sensitive name with a sentinel
string. Backstop for the `instances_list` / `instances_get` promise that
cleartext VM passwords never reach the model; new endpoints returning a
`password`-shaped field are scrubbed automatically.

Pure / non-mutating: returns a new structure, leaves the input alone.
"""

from __future__ import annotations

from typing import Any

_SENSITIVE_KEYS = frozenset({"password"})
_REDACTED = "[redacted]"


def redact_sensitive(value: Any) -> Any:
    if isinstance(value, list):
        return [redact_sensitive(v) for v in value]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if k in _SENSITIVE_KEYS and v not in (None, ""):
                out[k] = _REDACTED
            else:
                out[k] = redact_sensitive(v)
        return out
    return value
