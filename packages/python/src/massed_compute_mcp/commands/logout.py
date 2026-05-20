"""`massed-compute-mcp logout` — clear the stored API key."""

from ..config import config_path, delete_config


def run_logout(_argv: list[str]) -> int:
    if delete_config():
        print(f"Removed {config_path()}")
    else:
        print(f"No stored config to remove (looked at {config_path()}).")
    print(
        "Note: the MASSED_COMPUTE_API_KEY env var, if set, remains in effect."
    )
    return 0
