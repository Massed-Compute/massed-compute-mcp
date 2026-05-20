"""`massed-compute-mcp init` — first-run setup.

Idempotency: re-running with the same key as already stored is a refresh —
validates against upstream, bumps `validatedAt`, no prompt. Re-running with
a different key prompts to replace unless --yes.

CI-friendly: accepts the key from --token-file or MASSED_COMPUTE_API_KEY env
var, in which case no interactive prompt is needed.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

from ..client_detect import detect_clients, ClientId
from ..config import (
    DEFAULT_BASE_URL,
    ENV_API_KEY,
    ENV_BASE_URL,
    config_path,
    get_cli_override,
    read_config,
    write_config,
)
from ..prompt import prompt_hidden, prompt_yes_no
from ..upstream import validate_api_key
from .install_client import run_install_client

SETTINGS_URL = "https://vm.massedcompute.com/settings/api"


def _arg_value(argv: list[str], flag: str) -> str | None:
    for a in argv:
        if a.startswith(f"{flag}="):
            return a[len(flag) + 1 :]
    if flag in argv:
        i = argv.index(flag)
        if i + 1 < len(argv):
            return argv[i + 1]
    return None


def _has_flag(argv: list[str], *flags: str) -> bool:
    return any(a in flags for a in argv)


async def _wire_clients(argv: list[str]) -> None:
    """Detect installed MCP clients and offer to wire each one up. Mirrors
    init.ts/wireClients exactly so the cross-language UX stays in lockstep."""
    yes = _has_flag(argv, "--yes", "--force", "-y")
    all_clients = _has_flag(argv, "--all-clients")
    explicit = _arg_value(argv, "--clients")

    detected = detect_clients()
    explicit_ids: list[str] | None = (
        [s.strip() for s in explicit.split(",")] if explicit else None
    )

    print()
    print("Detecting MCP clients on this machine…")
    for c in detected:
        mark = "✓" if c.present else "✗"
        where = str(c.detected_at) if c.present else "not installed"
        print(f"  {mark} {c.display_name:<16} ({where})")
    print()

    if explicit_ids:
        to_wire = explicit_ids
    elif all_clients:
        to_wire = [c.id for c in detected]
    else:
        to_wire = [c.id for c in detected if c.present]

    if not to_wire:
        print(
            "No MCP clients detected. Install one (Claude Code, Cursor, Claude Desktop, Codex) then run:"
        )
        print("  massed-compute-mcp install-client <client>")
        return

    for cid in to_wire:
        c = next((d for d in detected if d.id == cid), None)
        if not yes:
            accept = prompt_yes_no(
                f"Wire massed-compute-mcp into {c.display_name if c else cid}?",
                default_yes=c.present if c else False,
            )
            if not accept:
                continue
        # Reuse the standalone subcommand so behavior (atomic write,
        # backup, idempotency, codex handling) is identical.
        run_install_client([cid, *(["--yes"] if yes else [])])
        print()


def run_init(argv: list[str]) -> int:
    import asyncio

    override = get_cli_override() or {}
    base_url = (
        _arg_value(argv, "--base-url")
        or override.get("base_url")
        or os.environ.get(ENV_BASE_URL)
        or DEFAULT_BASE_URL
    )
    yes = _has_flag(argv, "--yes", "--force", "-y")
    no_install = _has_flag(argv, "--no-install-clients")

    # Candidate key sources (highest first):
    #   1. CLI override (--token / --token-file, parsed in cli.py)
    #   2. MASSED_COMPUTE_API_KEY env
    # Both bypass the interactive prompt — init becomes CI-safe.
    candidate: str | None = override.get("api_key") or os.environ.get(ENV_API_KEY)

    existing = read_config()

    # Case 1: existing config + candidate matches it → refresh path.
    # Re-validate against upstream and bump validatedAt. No prompt, no
    # write-and-replace churn. Lets CI scripts re-run init periodically.
    if existing and existing.get("apiKey") and candidate and candidate == existing["apiKey"]:
        sys.stdout.write("Re-validating stored key against upstream… ")
        sys.stdout.flush()
        result = validate_api_key(candidate, base_url)
        if result.status != "ok":
            print("failed")
            print(
                f"Error: stored key no longer valid (HTTP {result.http_status}).",
                file=sys.stderr,
            )
            print(
                f"Generate a new one at {SETTINGS_URL} and re-run `massed-compute-mcp init`.",
                file=sys.stderr,
            )
            return 2
        print("ok")
        stored = {
            "apiKey": candidate,
            "validatedAt": datetime.now(timezone.utc).isoformat(),
        }
        if base_url != DEFAULT_BASE_URL:
            stored["baseUrl"] = base_url
        write_config(stored)
        print(f"Already configured at {config_path()}; validatedAt refreshed.")
        if not no_install:
            asyncio.run(_wire_clients(argv))
        return 0

    print("Massed Compute MCP — first-run setup")
    print("───────────────────────────────────────")
    if not candidate:
        print(f"Generate or copy your API key from {SETTINGS_URL}")
        print(
            "Use a read-only key if this assistant should not be able to launch, restart, or terminate instances."
        )
        print()

    # Case 2: existing config + (no candidate OR candidate differs).
    # Confirm before overwriting, unless --yes.
    if existing and existing.get("apiKey") and not yes:
        proceed = prompt_yes_no(
            f"An API key is already stored at {config_path()}. Replace it?",
            default_yes=False,
        )
        if not proceed:
            print("Aborted; existing key kept.")
            return 0

    # Case 3: no candidate → interactive prompt.
    if candidate is None:
        try:
            api_key = prompt_hidden("API key (input hidden): ").strip()
        except RuntimeError as err:
            print(f"Error: {err}", file=sys.stderr)
            return 1
    else:
        api_key = candidate.strip()
    if not api_key:
        print("Error: no key entered.", file=sys.stderr)
        return 1

    sys.stdout.write("Validating against upstream… ")
    sys.stdout.flush()
    result = validate_api_key(api_key, base_url)

    if result.status == "ok":
        print("ok")
    elif result.status == "unauthorized":
        print("rejected")
        print(
            f"Error: the upstream rejected this key (HTTP {result.http_status}).",
            file=sys.stderr,
        )
        print(
            f"Generate a new one at {SETTINGS_URL} and re-run `massed-compute-mcp init`.",
            file=sys.stderr,
        )
        return 2
    elif result.status == "network_error":
        print("network error")
        print(f"Error: could not reach {base_url} — {result.detail}", file=sys.stderr)
        print("Check your internet connection and re-run.", file=sys.stderr)
        return 3
    else:
        print("upstream error")
        print(
            f"Error: upstream returned HTTP {result.http_status}. Try again later.",
            file=sys.stderr,
        )
        return 4

    stored = {
        "apiKey": api_key,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
    }
    if base_url != DEFAULT_BASE_URL:
        stored["baseUrl"] = base_url
    write_config(stored)

    print()
    print(f"Saved to {config_path()}")

    if not no_install:
        asyncio.run(_wire_clients(argv))

    print()
    print("Done. Restart any wired MCP clients to pick up the new tools.")
    print("Run `massed-compute-mcp doctor` anytime to verify health.")
    return 0
