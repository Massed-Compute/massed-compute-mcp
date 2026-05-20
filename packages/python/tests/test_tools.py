"""Sanity checks for the tool catalog. Mirrors packages/node/tests/tools.test.ts."""

from __future__ import annotations

import re

import pytest

from massed_compute_mcp import TOOLS, TOOL_SPEC_VERSION


def test_tools_have_unique_names() -> None:
    names = [t["name"] for t in TOOLS]
    assert len(set(names)) == len(names)


def test_every_tool_has_required_fields() -> None:
    for t in TOOLS:
        assert t.get("title"), f"{t['name']}.title"
        assert t.get("description"), f"{t['name']}.description"
        assert t.get("inputSchema"), f"{t['name']}.inputSchema"


def test_every_tool_has_valid_upstream() -> None:
    valid = {"GET", "POST", "PUT", "PATCH", "DELETE"}
    for t in TOOLS:
        u = t["upstream"]
        assert u["method"] in valid, f"{t['name']}.upstream.method"
        assert re.match(r"^/api/v\d+/", u["path"]), f"{t['name']}.upstream.path"


def test_path_placeholders_and_path_params_in_sync() -> None:
    for t in TOOLS:
        params = (t.get("upstream") or {}).get("pathParams") or {}
        for placeholder in params:
            assert f"{{{placeholder}}}" in t["upstream"]["path"], (
                f"{t['name']}: path \"{t['upstream']['path']}\" missing {{{placeholder}}}"
            )
        ph_in_path = re.findall(r"\{([^}]+)\}", t["upstream"]["path"])
        for ph in ph_in_path:
            assert ph in params, (
                f"{t['name']}: path has {{{ph}}} but pathParams has no entry for it"
            )


FORBIDDEN_INTERNAL_STRINGS = [
    "user_api_key",
    "user_api_key_readonly",
    "vm-marketplace",
    "vm_marketplace",
    "massed-compute-api",
    "argon2",
    "argon",
    "mysql",
    "mariadb",
    "stripe_customer",
    "proxmox",
    "user_uuid",
    "api_key_hash",
]


@pytest.mark.parametrize("tool", TOOLS, ids=lambda t: t["name"])
def test_no_forbidden_internal_references(tool: dict) -> None:
    public_surface = {k: v for k, v in tool.items() if k != "upstream"}
    haystack = str(public_surface).lower()
    for needle in FORBIDDEN_INTERNAL_STRINGS:
        assert needle.lower() not in haystack, (
            f"{tool['name']}: contains forbidden string '{needle}'"
        )


def test_spec_version_is_set() -> None:
    assert TOOL_SPEC_VERSION != "0.0.0"
