"""Tests for uninstall-client across both JSON and Codex/TOML targets."""

from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolate_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    return tmp_path


def _claude_file(tmp_path: Path) -> Path:
    return tmp_path / ".claude.json"


def _codex_file(tmp_path: Path) -> Path:
    return tmp_path / ".codex" / "config.toml"


def test_removes_entry_preserves_siblings(tmp_path: Path) -> None:
    from massed_compute_mcp.commands.uninstall_client import run_uninstall_client

    _claude_file(tmp_path).write_text(json.dumps({
        "mcpServers": {
            "other-server": {"command": "other-cli"},
            "massed-compute": {"command": "massed-compute-mcp"},
        }
    }))
    assert run_uninstall_client(["claude-code"]) == 0
    parsed = json.loads(_claude_file(tmp_path).read_text())
    assert parsed["mcpServers"]["other-server"] == {"command": "other-cli"}
    assert "massed-compute" not in parsed["mcpServers"]


def test_creates_backup(tmp_path: Path) -> None:
    from massed_compute_mcp.commands.uninstall_client import run_uninstall_client

    _claude_file(tmp_path).write_text(json.dumps({
        "mcpServers": {"massed-compute": {"command": "massed-compute-mcp"}}
    }))
    run_uninstall_client(["claude-code"])
    backups = [p for p in tmp_path.iterdir() if p.name.startswith(".claude.json.bak.")]
    assert len(backups) == 1


def test_noop_when_file_missing(tmp_path: Path) -> None:
    from massed_compute_mcp.commands.uninstall_client import run_uninstall_client

    assert run_uninstall_client(["claude-code"]) == 0
    assert not _claude_file(tmp_path).exists()


def test_noop_when_entry_missing(tmp_path: Path) -> None:
    from massed_compute_mcp.commands.uninstall_client import run_uninstall_client

    _claude_file(tmp_path).write_text(json.dumps({
        "mcpServers": {"other": {"command": "x"}}
    }))
    before = _claude_file(tmp_path).read_text()
    assert run_uninstall_client(["claude-code"]) == 0
    assert _claude_file(tmp_path).read_text() == before


def test_refuses_malformed_json(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    from massed_compute_mcp.commands.uninstall_client import run_uninstall_client

    _claude_file(tmp_path).write_text("{ not valid json")
    assert run_uninstall_client(["claude-code"]) == 5
    # original untouched
    assert _claude_file(tmp_path).read_text() == "{ not valid json"


def test_codex_removes_section_preserves_rest(tmp_path: Path) -> None:
    from massed_compute_mcp.commands.uninstall_client import run_uninstall_client

    cfg = _codex_file(tmp_path)
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text(
        "[some.other.section]\n"
        'key = "value"\n'
        "\n"
        "[mcp_servers.massed-compute]\n"
        'command = "massed-compute-mcp"\n'
        "\n"
        "[trailing.section]\n"
        'k = "v"\n'
    )
    assert run_uninstall_client(["codex"]) == 0
    result = cfg.read_text()
    assert "[mcp_servers.massed-compute]" not in result
    assert "[some.other.section]" in result
    assert "[trailing.section]" in result


def test_codex_noop_when_file_missing(tmp_path: Path) -> None:
    from massed_compute_mcp.commands.uninstall_client import run_uninstall_client

    assert run_uninstall_client(["codex"]) == 0
