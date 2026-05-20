"""Detect which MCP clients are installed on this machine so `init` can
offer to wire them up automatically. Filesystem-only detection — we
don't shell out to `which` because the user might have a binary on PATH
without using its MCP integration. Config-dir/file presence is a
stronger signal that the user actually runs the client."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

ClientId = Literal["claude-code", "cursor", "claude-desktop", "codex"]


@dataclass
class DetectedClient:
    id: ClientId
    display_name: str
    config_path: Path
    present: bool
    detected_at: Optional[Path] = None


def _claude_desktop_config_path() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else home / "AppData" / "Roaming"
        return base / "Claude" / "claude_desktop_config.json"
    return home / ".config" / "Claude" / "claude_desktop_config.json"


def _claude_desktop_app_path() -> Optional[Path]:
    if sys.platform == "darwin":
        return Path("/Applications/Claude.app")
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            return Path(local) / "Programs" / "Claude" / "Claude.exe"
    return None


def detect_clients() -> list[DetectedClient]:
    home = Path.home()
    out: list[DetectedClient] = []

    # Claude Code: ~/.claude.json or ~/.claude/ (the CLI's config locations).
    claude_code_file = home / ".claude.json"
    claude_code_dir = home / ".claude"
    if claude_code_file.exists():
        out.append(DetectedClient(
            id="claude-code",
            display_name="Claude Code",
            config_path=claude_code_file,
            present=True,
            detected_at=claude_code_file,
        ))
    elif claude_code_dir.exists():
        out.append(DetectedClient(
            id="claude-code",
            display_name="Claude Code",
            config_path=claude_code_file,
            present=True,
            detected_at=claude_code_dir,
        ))
    else:
        out.append(DetectedClient(
            id="claude-code",
            display_name="Claude Code",
            config_path=claude_code_file,
            present=False,
        ))

    # Cursor: ~/.cursor/ dir marker.
    cursor_dir = home / ".cursor"
    out.append(DetectedClient(
        id="cursor",
        display_name="Cursor",
        config_path=cursor_dir / "mcp.json",
        present=cursor_dir.exists(),
        detected_at=cursor_dir if cursor_dir.exists() else None,
    ))

    # Claude Desktop: app bundle or config dir.
    cd_config = _claude_desktop_config_path()
    cd_app = _claude_desktop_app_path()
    if cd_config.parent.exists():
        out.append(DetectedClient(
            id="claude-desktop",
            display_name="Claude Desktop",
            config_path=cd_config,
            present=True,
            detected_at=cd_config.parent,
        ))
    elif cd_app and cd_app.exists():
        out.append(DetectedClient(
            id="claude-desktop",
            display_name="Claude Desktop",
            config_path=cd_config,
            present=True,
            detected_at=cd_app,
        ))
    else:
        out.append(DetectedClient(
            id="claude-desktop",
            display_name="Claude Desktop",
            config_path=cd_config,
            present=False,
        ))

    # Codex: ~/.codex/ dir marker.
    codex_dir = home / ".codex"
    out.append(DetectedClient(
        id="codex",
        display_name="Codex",
        config_path=codex_dir / "config.toml",
        present=codex_dir.exists(),
        detected_at=codex_dir if codex_dir.exists() else None,
    ))

    return out
