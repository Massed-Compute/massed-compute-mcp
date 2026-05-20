"""`massed-compute-mcp config show` — inspect stored config."""

from __future__ import annotations

from ..config import DEFAULT_BASE_URL, config_path, read_config, resolve_auth


def _mask(key: str) -> str:
    if len(key) <= 8:
        return "***"
    return f"{key[:4]}…{key[-4:]}"


def run_config_show(_argv: list[str]) -> int:
    file = config_path()
    print(f"Config file: {file}")
    exists = file.exists()
    print(f"Exists:      {'yes' if exists else 'no'}")

    if exists:
        stored = read_config()
        if stored:
            print(f"Stored key:  {_mask(stored.get('apiKey', ''))}")
            print(f"Base URL:    {stored.get('baseUrl') or DEFAULT_BASE_URL}")
            if stored.get("validatedAt"):
                print(f"Validated:   {stored['validatedAt']}")
        else:
            print("Stored key:  (file exists but is malformed; run `init` to overwrite)")
    print()

    auth = resolve_auth()
    print("Active resolution (what the MCP server would use right now):")
    print(f"  source:    {auth.source}")
    if auth.api_key:
        print(f"  key:       {_mask(auth.api_key)}")
    print(f"  base url:  {auth.base_url}")
    if auth.source == "none":
        print()
        print("Run `massed-compute-mcp init` to set a key.")
    return 0
