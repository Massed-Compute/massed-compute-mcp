"""Mirror of packages/node/tests/redact.test.ts."""

from __future__ import annotations

import json

from massed_compute_mcp.redact import redact_sensitive


def test_replaces_top_level_password() -> None:
    out = redact_sensitive({"username": "Ubuntu", "password": "leak-xyz"})
    assert out["username"] == "Ubuntu"
    assert out["password"] == "[redacted]"
    assert "leak-xyz" not in json.dumps(out)


def test_scrubs_password_in_instances_array() -> None:
    out = redact_sensitive(
        {
            "runningInstances": [
                {"uuid": "a", "password": "leak-a"},
                {"uuid": "b", "password": "leak-b"},
            ],
        }
    )
    serialized = json.dumps(out)
    assert "leak-a" not in serialized
    assert "leak-b" not in serialized


def test_scrubs_deeply_nested_password() -> None:
    out = redact_sensitive({"a": {"b": {"c": {"password": "deep-leak"}}}})
    assert "deep-leak" not in json.dumps(out)


def test_does_not_mutate_input() -> None:
    src = {"password": "original"}
    redact_sensitive(src)
    assert src["password"] == "original"


def test_leaves_null_password_untouched() -> None:
    out = redact_sensitive({"password": None})
    assert out["password"] is None


def test_passes_primitives_through() -> None:
    assert redact_sensitive(42) == 42
    assert redact_sensitive("hello") == "hello"
    assert redact_sensitive(None) is None
    assert redact_sensitive({"ip": "1.2.3.4"}) == {"ip": "1.2.3.4"}
