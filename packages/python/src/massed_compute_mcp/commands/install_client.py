"""`massed-compute-mcp install-client <client>` — patch a supported MCP
client's config so the user doesn't have to hand-edit JSON.

The injected entry has no Authorization header — the binary reads its key
from our 0600 config file at runtime, so the secret never lands in the
client's own config (which is often readable by other tools on the
machine)."""

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

from ..config import read_config
from ..prompt import prompt_yes_no

ClientId = Literal["claude-code", "cursor", "claude-desktop", "codex"]
SUPPORTED: tuple[ClientId, ...] = ("claude-code", "cursor", "claude-desktop", "codex")


@dataclass
class _Target:
    id: ClientId
    display_name: str
    config_path: Path
    format: Literal["json", "toml-section"] = "json"
    mcp_servers_key: str = "mcpServers"


def _claude_desktop_path() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else home / "AppData" / "Roaming"
        return base / "Claude" / "claude_desktop_config.json"
    # Claude Desktop is macOS- and Windows-only; on Linux we point at a
    # best-guess path so the user can still inspect what we would have done.
    return home / ".config" / "Claude" / "claude_desktop_config.json"


def _targets() -> dict[ClientId, _Target]:
    home = Path.home()
    return {
        "claude-code": _Target(
            id="claude-code",
            display_name=f"Claude Code ({home / '.claude.json'})",
            config_path=home / ".claude.json",
        ),
        "cursor": _Target(
            id="cursor",
            display_name=f"Cursor ({home / '.cursor' / 'mcp.json'})",
            config_path=home / ".cursor" / "mcp.json",
        ),
        "claude-desktop": _Target(
            id="claude-desktop",
            display_name=f"Claude Desktop ({_claude_desktop_path()})",
            config_path=_claude_desktop_path(),
        ),
        "codex": _Target(
            id="codex",
            display_name=f"Codex ({Path.home() / '.codex' / 'config.toml'})",
            config_path=Path.home() / ".codex" / "config.toml",
            format="toml-section",
        ),
    }


SERVER_KEY = "massed-compute"
SERVER_ENTRY = {"command": "massed-compute-mcp"}
CODEX_HEADER = f"[mcp_servers.{SERVER_KEY}]"
CODEX_SECTION = f'{CODEX_HEADER}\ncommand = "massed-compute-mcp"\n'


def _backup_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _print_usage(targets: dict[ClientId, _Target]) -> None:
    print("Usage: massed-compute-mcp install-client <client>")
    print()
    print("Supported clients:")
    for t in targets.values():
        print(f"  {t.id:<16} {t.display_name}")


def _install_codex(file: Path, yes: bool = False) -> int:
    """Append [mcp_servers.massed-compute] to Codex's config.toml.

    We avoid pulling in a TOML parser dep and instead do a line-based
    section-aware splice. Safe for the canonical entries we ever write;
    best-effort for hand-edited files.
    """
    file.parent.mkdir(parents=True, exist_ok=True)
    if not file.exists():
        print(f"{file} does not exist — will create.")
        file.write_text(CODEX_SECTION, encoding="utf-8")
        print(f"Wrote `{CODEX_HEADER}` to {file}.")
        return 0

    raw = file.read_text(encoding="utf-8")
    if CODEX_HEADER in raw:
        # Idempotency: if the existing section byte-matches what we'd write,
        # silent no-op with no backup.
        if CODEX_SECTION in raw:
            print(
                f"Already configured: `{CODEX_HEADER}` matches expected content. No change."
            )
            return 0
        if not yes:
            replace = prompt_yes_no(
                f"A `{CODEX_HEADER}` section already exists in {file} but differs from what we'd write. Replace it?",
                default_yes=False,
            )
            if not replace:
                print("Aborted.")
                return 0
        # Strip existing section before appending fresh.
        out: list[str] = []
        skipping = False
        for line in raw.splitlines():
            if not skipping and line.strip() == CODEX_HEADER:
                skipping = True
                continue
            if skipping and re.match(r"^\[.+\]\s*$", line.strip()):
                skipping = False
            if not skipping:
                out.append(line)
        backup = file.with_suffix(file.suffix + f".bak.{_backup_timestamp()}")
        shutil.copy2(file, backup)
        print(f"Backed up existing config to {backup}")
        merged = ("\n".join(out)).rstrip("\n") + "\n\n" + CODEX_SECTION
        tmp = file.with_suffix(file.suffix + f".tmp-{os.getpid()}")
        tmp.write_text(merged, encoding="utf-8")
        tmp.replace(file)
    else:
        backup = file.with_suffix(file.suffix + f".bak.{_backup_timestamp()}")
        shutil.copy2(file, backup)
        print(f"Backed up existing config to {backup}")
        merged = raw.rstrip("\n") + "\n\n" + CODEX_SECTION
        tmp = file.with_suffix(file.suffix + f".tmp-{os.getpid()}")
        tmp.write_text(merged, encoding="utf-8")
        tmp.replace(file)
    print(f"Wrote `{CODEX_HEADER}` to {file}.")
    print()
    print("Restart Codex to pick up the change.")
    return 0


def run_install_client(argv: list[str]) -> int:
    targets = _targets()
    # Distinguish positional client id from flag args so --yes can be placed
    # before or after the client id.
    positional = [a for a in argv if not a.startswith("-")]
    yes = any(a in ("--yes", "--force", "-y") for a in argv)
    client_arg = positional[0] if positional else None
    if not client_arg or client_arg not in targets:
        _print_usage(targets)
        return 2 if client_arg else 0

    if not (read_config() or {}).get("apiKey"):
        print(
            "No stored API key found. Run `massed-compute-mcp init` first so the wiring is useful.",
            file=sys.stderr,
        )
        return 1

    target = targets[client_arg]  # type: ignore[index]
    file = target.config_path

    print(f"Target: {target.display_name}")

    if target.format == "toml-section":
        return _install_codex(file, yes=yes)

    existing: object = {}
    if file.exists():
        try:
            raw = file.read_text(encoding="utf-8")
        except OSError as err:
            print(f"Could not read {file}: {err}", file=sys.stderr)
            return 4
        if raw.strip():
            try:
                existing = json.loads(raw)
            except json.JSONDecodeError:
                print(
                    f"Refusing to overwrite — {file} contains invalid JSON.",
                    file=sys.stderr,
                )
                print("Fix or move the file aside, then re-run.", file=sys.stderr)
                return 5
        if not isinstance(existing, dict):
            print(
                f"Refusing to overwrite — {file} top level is not a JSON object.",
                file=sys.stderr,
            )
            return 5
        servers = existing.get(target.mcp_servers_key)
        if isinstance(servers, dict) and SERVER_KEY in servers:
            # Idempotency: identical entry → silent no-op, no backup.
            if servers[SERVER_KEY] == SERVER_ENTRY:
                print(
                    f'Already configured: "{SERVER_KEY}" entry in {file} matches expected. No change.'
                )
                return 0
            if not yes:
                replace = prompt_yes_no(
                    f'An MCP entry named "{SERVER_KEY}" already exists in {file} but differs from what we\'d write. Replace it?',
                    default_yes=False,
                )
                if not replace:
                    print("Aborted.")
                    return 0
        backup = file.with_suffix(file.suffix + f".bak.{_backup_timestamp()}")
        shutil.copy2(file, backup)
        print(f"Backed up existing config to {backup}")
    else:
        print(f"{file} does not exist — will create.")
        file.parent.mkdir(parents=True, exist_ok=True)

    next_obj = dict(existing) if isinstance(existing, dict) else {}
    servers_obj = (
        dict(next_obj[target.mcp_servers_key])
        if isinstance(next_obj.get(target.mcp_servers_key), dict)
        else {}
    )
    servers_obj[SERVER_KEY] = SERVER_ENTRY
    next_obj[target.mcp_servers_key] = servers_obj

    # Atomic write: temp file + rename
    tmp = file.with_suffix(file.suffix + f".tmp-{os.getpid()}")
    tmp.write_text(json.dumps(next_obj, indent=2) + "\n", encoding="utf-8")
    tmp.replace(file)

    print(f'Wrote MCP server entry "{SERVER_KEY}" → command "massed-compute-mcp".')
    print()
    print("Restart your MCP client to pick up the change.")
    return 0
