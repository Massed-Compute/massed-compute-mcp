"""Massed Compute MCP — a stdio bridge that forwards Model Context Protocol
JSON-RPC verbatim to the hosted endpoint at
https://vm.massedcompute.com/api/mcp, injecting your stored API key."""

from importlib.metadata import PackageNotFoundError, version as _pkg_version

# Single source of truth: pyproject.toml's [project] version, read via
# importlib.metadata. The fallback covers the rare case where the package
# is imported from a source tree without being installed (e.g. running
# scripts directly out of git).
try:
    __version__ = _pkg_version("massed-compute-mcp")
except PackageNotFoundError:  # pragma: no cover - dev-checkout path
    __version__ = "0.0.0+local"

__all__ = ["__version__"]
