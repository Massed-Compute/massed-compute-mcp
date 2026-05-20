"""Tests for the config show subcommand — masks key, picks resolution source."""

from __future__ import annotations

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
    monkeypatch.delenv("MASSED_COMPUTE_API_BASE_URL", raising=False)
    return tmp_path


def test_reports_no_when_unset(capsys: pytest.CaptureFixture[str]) -> None:
    from massed_compute_mcp.commands.config_show import run_config_show

    assert run_config_show([]) == 0
    out = capsys.readouterr().out
    assert "Exists:      no" in out
    assert "massed-compute-mcp init" in out


def test_masks_stored_key(capsys: pytest.CaptureFixture[str]) -> None:
    from massed_compute_mcp.commands.config_show import run_config_show
    from massed_compute_mcp.config import write_config

    write_config({"apiKey": "uuid-prefix.thirty-char-secret-here"})
    run_config_show([])
    out = capsys.readouterr().out
    assert "Exists:      yes" in out
    # The full secret must never appear in output.
    assert "thirty-char-secret-here" not in out
    assert "uuid…here" in out


def test_source_is_env_when_env_set(capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch) -> None:
    from massed_compute_mcp.commands.config_show import run_config_show

    monkeypatch.setenv("MASSED_COMPUTE_API_KEY", "envkey.envsecret")
    run_config_show([])
    assert "source:    env" in capsys.readouterr().out


def test_source_is_config_when_only_file_set(capsys: pytest.CaptureFixture[str]) -> None:
    from massed_compute_mcp.commands.config_show import run_config_show
    from massed_compute_mcp.config import write_config

    write_config({"apiKey": "key1.secret2"})
    run_config_show([])
    assert "source:    config" in capsys.readouterr().out
