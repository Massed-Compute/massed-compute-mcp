"""Massed Compute MCP — a thin Model Context Protocol wrapper around the
public Massed Compute API. Exposes 14 tools that map 1:1 to documented
operations at https://vm-docs.massedcompute.com/api/v1."""

from importlib.metadata import PackageNotFoundError, version as _pkg_version

from .tools import TOOLS, TOOL_SPEC_VERSION

# Single source of truth: pyproject.toml's [project] version, read via
# importlib.metadata. The fallback covers the rare case where the package
# is imported from a source tree without being installed (e.g. running
# scripts directly out of git).
try:
    __version__ = _pkg_version("massed-compute-mcp")
except PackageNotFoundError:  # pragma: no cover - dev-checkout path
    __version__ = "0.0.0+local"

__all__ = ["TOOLS", "TOOL_SPEC_VERSION", "__version__"]
