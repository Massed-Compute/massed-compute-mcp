"""Cross-platform config-file management for the stored API key.

The on-disk file format and resolution chain match the Node implementation
exactly so users can switch between `npm install -g massed-compute-mcp` and
`pip install massed-compute-mcp` without re-running `init`.
"""

from __future__ import annotations

import json
import os
import stat
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

APP_NAME = "massed-compute"
CONFIG_FILENAME = "config.json"
DEFAULT_BASE_URL = "https://vm.massedcompute.com"
ENV_API_KEY = "MASSED_COMPUTE_API_KEY"
ENV_BASE_URL = "MASSED_COMPUTE_API_BASE_URL"


def config_dir() -> Path:
    """Return the per-OS directory we use to store config.

    - Linux: $XDG_CONFIG_HOME or ~/.config + /massed-compute
    - macOS: ~/Library/Application Support/massed-compute
    - Windows: %APPDATA%/massed-compute (typically AppData/Roaming)
    """
    home = Path.home()
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else home / "AppData" / "Roaming"
        return base / APP_NAME
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / APP_NAME
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg) if xdg else home / ".config"
    return base / APP_NAME


def config_path() -> Path:
    return config_dir() / CONFIG_FILENAME


def read_config() -> Optional[dict]:
    p = config_path()
    if not p.exists():
        return None
    try:
        with p.open("r", encoding="utf-8") as f:
            parsed = json.load(f)
        if isinstance(parsed, dict) and isinstance(parsed.get("apiKey"), str):
            return parsed
    except (OSError, json.JSONDecodeError):
        # Surfaced to caller as "no config" with the intent that they run
        # `init` again. We don't try to repair the file.
        return None
    return None


def write_config(config: dict) -> None:
    d = config_dir()
    # 0700 on the dir matches ~/.aws and ~/.kube; world-readable directory
    # listings can leak the fact that a credential exists.
    d.mkdir(parents=True, exist_ok=True)
    if sys.platform != "win32":
        try:
            os.chmod(d, 0o700)
        except OSError:
            pass
    p = config_path()
    # Atomic write: open with O_NOFOLLOW + fsync + rename.
    #   - O_NOFOLLOW closes the (low-likelihood, since the dir is 0700)
    #     symlink-race window where an attacker pre-creates a symlink
    #     that would redirect our write elsewhere on disk.
    #   - fsync flushes the contents to disk before rename promotes the
    #     temp file. Without it, a power loss could promote a zero-byte
    #     file as the new credential.
    tmp = p.with_suffix(f".tmp-{os.getpid()}")
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if sys.platform != "win32":
        flags |= os.O_NOFOLLOW
    fd = os.open(str(tmp), flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
            f.write("\n")
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        raise
    if sys.platform != "win32":
        try:
            os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
    tmp.replace(p)


# CLI flags (--token / --base-url) parsed by cli.py populate this; everything
# downstream calls resolve_auth() and gets the right precedence without each
# subcommand needing to know about argv.
_cli_override: Optional[dict] = None


def set_cli_override(api_key: Optional[str] = None, base_url: Optional[str] = None) -> None:
    global _cli_override
    _cli_override = {"api_key": api_key, "base_url": base_url}


def get_cli_override() -> Optional[dict]:
    return _cli_override


def delete_config() -> bool:
    p = config_path()
    if not p.exists():
        return False
    p.unlink()
    return True


@dataclass
class ResolvedAuth:
    api_key: Optional[str]
    base_url: str
    source: Literal["override", "env", "config", "none"]


def resolve_auth(api_key_override: Optional[str] = None, base_url_override: Optional[str] = None) -> ResolvedAuth:
    """Resolve the active API key + base URL.

    Priority (first match wins):
      1. caller-supplied override (function arg)
      2. CLI flag override (--token / --base-url, stashed by cli.py)
      3. environment variables
      4. stored config file
    """
    effective_key = api_key_override or (_cli_override or {}).get("api_key")
    effective_base = base_url_override or (_cli_override or {}).get("base_url")
    if effective_key:
        return ResolvedAuth(
            api_key=effective_key,
            base_url=effective_base or os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL,
            source="override",
        )
    env_key = os.environ.get(ENV_API_KEY)
    if env_key:
        return ResolvedAuth(
            api_key=env_key,
            base_url=os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL,
            source="env",
        )
    stored = read_config()
    if stored and stored.get("apiKey"):
        return ResolvedAuth(
            api_key=stored["apiKey"],
            base_url=stored.get("baseUrl") or os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL,
            source="config",
        )
    return ResolvedAuth(
        api_key=None,
        base_url=os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL,
        source="none",
    )
