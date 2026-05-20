"""Minimal interactive prompts using only the stdlib.

We use `getpass` rather than a third-party prompts library because the
runtime deps list (mcp + httpx) is already minimal and we want to keep it
that way for a package that gets `pip install`-ed globally.
"""

from __future__ import annotations

import getpass
import sys


def is_interactive() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty()


def prompt_hidden(label: str) -> str:
    """Read a single line with the typed characters hidden.

    `getpass.getpass` already does the right thing on every supported
    platform — it falls back to a non-echo readline on Unix and to the
    Win32 console API on Windows. We just wrap it so the message about
    "no TTY" matches the Node implementation.
    """
    if not is_interactive():
        raise RuntimeError(
            "Interactive prompt requested but stdin is not a TTY. "
            "Pipe MASSED_COMPUTE_API_KEY in via env instead, or run "
            "`massed-compute-mcp init` directly in a terminal."
        )
    return getpass.getpass(label)


def prompt_yes_no(label: str, default_yes: bool = False) -> bool:
    if not is_interactive():
        return default_yes
    suffix = " [Y/n] " if default_yes else " [y/N] "
    answer = input(label + suffix).strip().lower()
    if not answer:
        return default_yes
    return answer in ("y", "yes")
