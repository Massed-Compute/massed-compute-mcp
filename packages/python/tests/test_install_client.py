"""Install-client tests. Mirrors packages/node/tests/install-client.test.ts."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolate_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / ".config"))
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData" / "Roaming"))
    monkeypatch.delenv("MASSED_COMPUTE_API_KEY", raising=False)
    # install-client refuses without a stored key.
    from massed_compute_mcp.config import write_config

    write_config({"apiKey": "stored-test-key"})
    return tmp_path


def _target_file(tmp_path: Path) -> Path:
    return tmp_path / ".claude.json"


def test_creates_new_config_file(tmp_path: Path) -> None:
    from massed_compute_mcp.commands.install_client import run_install_client

    code = run_install_client(["claude-code"])
    assert code == 0
    assert _target_file(tmp_path).exists()
    parsed = json.loads(_target_file(tmp_path).read_text())
    assert parsed["mcpServers"]["massed-compute"] == {"command": "massed-compute-mcp"}


def test_preserves_existing_entries(tmp_path: Path) -> None:
    from massed_compute_mcp.commands.install_client import run_install_client

    _target_file(tmp_path).write_text(
        json.dumps({
            "someUnrelatedKey": "keep me",
            "mcpServers": {"other-server": {"command": "other-cli"}},
        })
    )
    code = run_install_client(["claude-code"])
    assert code == 0
    parsed = json.loads(_target_file(tmp_path).read_text())
    assert parsed["someUnrelatedKey"] == "keep me"
    assert parsed["mcpServers"]["other-server"] == {"command": "other-cli"}
    assert parsed["mcpServers"]["massed-compute"] == {"command": "massed-compute-mcp"}


def test_creates_backup_when_overwriting(tmp_path: Path) -> None:
    from massed_compute_mcp.commands.install_client import run_install_client

    _target_file(tmp_path).write_text(
        json.dumps({"mcpServers": {"other": {"command": "x"}}})
    )
    code = run_install_client(["claude-code"])
    assert code == 0
    backups = [p for p in tmp_path.iterdir() if p.name.startswith(".claude.json.bak.")]
    assert len(backups) == 1


def test_refuses_malformed_json(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    from massed_compute_mcp.commands.install_client import run_install_client

    _target_file(tmp_path).write_text("{ not valid json")
    code = run_install_client(["claude-code"])
    assert code == 5
    assert "invalid JSON" in capsys.readouterr().err
    # original file untouched
    assert _target_file(tmp_path).read_text() == "{ not valid json"


def test_refuses_when_top_level_not_object(tmp_path: Path) -> None:
    from massed_compute_mcp.commands.install_client import run_install_client

    _target_file(tmp_path).write_text(json.dumps(["not", "an", "object"]))
    code = run_install_client(["claude-code"])
    assert code == 5


def test_unknown_client_id_returns_2() -> None:
    from massed_compute_mcp.commands.install_client import run_install_client

    assert run_install_client(["does-not-exist"]) == 2


def test_no_args_prints_usage(capsys: pytest.CaptureFixture[str]) -> None:
    from massed_compute_mcp.commands.install_client import run_install_client

    code = run_install_client([])
    assert code == 0
    assert "Supported clients" in capsys.readouterr().out


def test_refuses_when_no_api_key(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    from massed_compute_mcp.commands.install_client import run_install_client
    from massed_compute_mcp.config import config_dir

    # Wipe seeded config; this exercises the "refuse if no stored key" guard.
    import shutil

    if config_dir().exists():
        shutil.rmtree(config_dir())
    code = run_install_client(["claude-code"])
    assert code == 1
    assert "init" in capsys.readouterr().err


def test_idempotent_when_entry_matches(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """Re-running install-client when our entry already exactly matches
    what we'd write must be a silent no-op — no backup file produced."""
    import json

    from massed_compute_mcp.commands.install_client import run_install_client

    _target_file(tmp_path).write_text(
        json.dumps(
            {"mcpServers": {"massed-compute": {"command": "massed-compute-mcp"}}}
        )
    )
    code = run_install_client(["claude-code"])
    assert code == 0
    assert "Already configured" in capsys.readouterr().out
    backups = [p for p in tmp_path.iterdir() if p.name.startswith(".claude.json.bak.")]
    assert backups == []


def test_yes_skips_differs_prompt(tmp_path: Path) -> None:
    """--yes bypasses the 'entry differs, replace?' prompt in CI scenarios."""
    import json

    from massed_compute_mcp.commands.install_client import run_install_client

    _target_file(tmp_path).write_text(
        json.dumps(
            {
                "mcpServers": {
                    "massed-compute": {"command": "custom-binary", "args": ["--weird"]}
                }
            }
        )
    )
    code = run_install_client(["claude-code", "--yes"])
    assert code == 0
    parsed = json.loads(_target_file(tmp_path).read_text())
    assert parsed["mcpServers"]["massed-compute"] == {
        "command": "massed-compute-mcp"
    }
