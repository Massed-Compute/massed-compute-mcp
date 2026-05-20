"""`massed-compute-mcp uninstall-client <client>` — remove our entry from a
client's MCP config. Always backs up first."""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

ClientId = Literal["claude-code", "cursor", "claude-desktop", "codex"]


@dataclass
class _Target:
    id: ClientId
    display_name: str
    config_path: Path
    format: Literal["json", "toml-section"]
    mcp_servers_key: str = "mcpServers"


def _claude_desktop_path() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else home / "AppData" / "Roaming"
        return base / "Claude" / "claude_desktop_config.json"
    return home / ".config" / "Claude" / "claude_desktop_config.json"


def _targets() -> dict[ClientId, _Target]:
    home = Path.home()
    return {
        "claude-code": _Target(
            id="claude-code",
            display_name=f"Claude Code ({home / '.claude.json'})",
            config_path=home / ".claude.json",
            format="json",
        ),
        "cursor": _Target(
            id="cursor",
            display_name=f"Cursor ({home / '.cursor' / 'mcp.json'})",
            config_path=home / ".cursor" / "mcp.json",
            format="json",
        ),
        "claude-desktop": _Target(
            id="claude-desktop",
            display_name=f"Claude Desktop ({_claude_desktop_path()})",
            config_path=_claude_desktop_path(),
            format="json",
        ),
        "codex": _Target(
            id="codex",
            display_name=f"Codex ({home / '.codex' / 'config.toml'})",
            config_path=home / ".codex" / "config.toml",
            format="toml-section",
        ),
    }


SERVER_KEY = "massed-compute"
CODEX_HEADER = f"[mcp_servers.{SERVER_KEY}]"


def _backup_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _print_usage(targets: dict[ClientId, _Target]) -> None:
    print("Usage: massed-compute-mcp uninstall-client <client>")
    print()
    print("Supported clients:")
    for t in targets.values():
        print(f"  {t.id:<16} {t.display_name}")


def _remove_from_json(file: Path, mcp_servers_key: str) -> int:
    if not file.exists():
        print(f"{file} does not exist — nothing to remove.")
        return 0
    raw = file.read_text(encoding="utf-8")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        print(f"Refusing to edit — {file} contains invalid JSON.", file=sys.stderr)
        return 5
    if not isinstance(parsed, dict):
        print(f"Refusing to edit — {file} top level is not a JSON object.", file=sys.stderr)
        return 5
    servers = parsed.get(mcp_servers_key)
    if not isinstance(servers, dict) or SERVER_KEY not in servers:
        print(f'No "{SERVER_KEY}" entry in {file}; nothing to do.')
        return 0
    backup = file.with_suffix(file.suffix + f".bak.{_backup_timestamp()}")
    shutil.copy2(file, backup)
    print(f"Backed up {file} → {backup}")
    nextservers = {k: v for k, v in servers.items() if k != SERVER_KEY}
    nextobj = {**parsed, mcp_servers_key: nextservers}
    tmp = file.with_suffix(file.suffix + f".tmp-{os.getpid()}")
    tmp.write_text(json.dumps(nextobj, indent=2) + "\n", encoding="utf-8")
    tmp.replace(file)
    print(f'Removed "{SERVER_KEY}" entry from {file}.')
    return 0


def _remove_from_codex(file: Path) -> int:
    if not file.exists():
        print(f"{file} does not exist — nothing to remove.")
        return 0
    raw = file.read_text(encoding="utf-8")
    if CODEX_HEADER not in raw:
        print(f"No `{CODEX_HEADER}` section in {file}; nothing to do.")
        return 0
    backup = file.with_suffix(file.suffix + f".bak.{_backup_timestamp()}")
    shutil.copy2(file, backup)
    print(f"Backed up {file} → {backup}")
    out: list[str] = []
    skipping = False
    for line in raw.splitlines():
        trimmed = line.strip()
        if not skipping and trimmed == CODEX_HEADER:
            skipping = True
            continue
        if skipping and re.match(r"^\[.+\]\s*$", trimmed):
            skipping = False
        if not skipping:
            out.append(line)
    tmp = file.with_suffix(file.suffix + f".tmp-{os.getpid()}")
    tmp.write_text("\n".join(out), encoding="utf-8")
    tmp.replace(file)
    print(f"Removed `{CODEX_HEADER}` from {file}.")
    return 0


def run_uninstall_client(argv: list[str]) -> int:
    targets = _targets()
    client_arg = argv[0] if argv else None
    if not client_arg or client_arg not in targets:
        _print_usage(targets)
        return 2 if client_arg else 0
    target = targets[client_arg]  # type: ignore[index]
    print(f"Target: {target.display_name}")
    if target.format == "json":
        return _remove_from_json(target.config_path, target.mcp_servers_key)
    return _remove_from_codex(target.config_path)
