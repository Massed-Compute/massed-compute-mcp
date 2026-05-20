"""Cross-platform config + resolve_auth tests. Mirrors
packages/node/tests/config.test.ts."""

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolate_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point every per-OS path discovery at a fresh tmp dir, and wipe the
    auth env vars. Without this, tests would silently write into the
    developer's real home dir."""
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / ".config"))
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData" / "Roaming"))
    monkeypatch.delenv("MASSED_COMPUTE_API_KEY", raising=False)
    monkeypatch.delenv("MASSED_COMPUTE_API_BASE_URL", raising=False)
    return tmp_path


def test_config_dir_uses_xdg_on_linux(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    from massed_compute_mcp.config import config_dir

    assert config_dir() == tmp_path / ".config" / "massed-compute"


def test_config_dir_falls_back_when_xdg_empty(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("XDG_CONFIG_HOME", "")
    from massed_compute_mcp.config import config_dir

    assert config_dir() == tmp_path / ".config" / "massed-compute"


def test_config_dir_uses_application_support_on_macos(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "platform", "darwin")
    from massed_compute_mcp.config import config_dir

    assert config_dir() == tmp_path / "Library" / "Application Support" / "massed-compute"


def test_config_dir_uses_appdata_on_windows(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "platform", "win32")
    from massed_compute_mcp.config import config_dir

    assert config_dir() == tmp_path / "AppData" / "Roaming" / "massed-compute"


def test_read_write_round_trip() -> None:
    from massed_compute_mcp.config import read_config, write_config

    write_config({"apiKey": "abc.def", "baseUrl": "https://staging.example.com"})
    got = read_config()
    assert got is not None
    assert got["apiKey"] == "abc.def"
    assert got["baseUrl"] == "https://staging.example.com"


def test_read_returns_none_when_missing() -> None:
    from massed_compute_mcp.config import read_config

    assert read_config() is None


def test_read_returns_none_for_malformed_json() -> None:
    from massed_compute_mcp.config import config_dir, config_path, read_config

    config_dir().mkdir(parents=True, exist_ok=True)
    config_path().write_text("not json{", encoding="utf-8")
    assert read_config() is None


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX chmod only")
def test_write_sets_0600_permissions() -> None:
    from massed_compute_mcp.config import config_path, write_config

    write_config({"apiKey": "k"})
    mode = stat.S_IMODE(config_path().stat().st_mode)
    assert mode == 0o600


def test_delete_removes_file_and_reports() -> None:
    from massed_compute_mcp.config import delete_config, write_config, config_path

    assert delete_config() is False
    write_config({"apiKey": "k"})
    assert delete_config() is True
    assert not config_path().exists()


def test_resolve_auth_override_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    from massed_compute_mcp.config import resolve_auth, write_config

    monkeypatch.setenv("MASSED_COMPUTE_API_KEY", "from-env")
    write_config({"apiKey": "from-config"})
    r = resolve_auth(api_key_override="from-flag")
    assert r.api_key == "from-flag"
    assert r.source == "override"


def test_resolve_auth_env_wins_over_config(monkeypatch: pytest.MonkeyPatch) -> None:
    from massed_compute_mcp.config import resolve_auth, write_config

    monkeypatch.setenv("MASSED_COMPUTE_API_KEY", "from-env")
    write_config({"apiKey": "from-config"})
    r = resolve_auth()
    assert r.api_key == "from-env"
    assert r.source == "env"


def test_resolve_auth_falls_back_to_config() -> None:
    from massed_compute_mcp.config import resolve_auth, write_config

    write_config({"apiKey": "from-config"})
    r = resolve_auth()
    assert r.api_key == "from-config"
    assert r.source == "config"


def test_resolve_auth_returns_none_when_nothing_set() -> None:
    from massed_compute_mcp.config import resolve_auth, DEFAULT_BASE_URL

    r = resolve_auth()
    assert r.api_key is None
    assert r.source == "none"
    assert r.base_url == DEFAULT_BASE_URL
