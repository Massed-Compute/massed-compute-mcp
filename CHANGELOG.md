# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] — 2026-05-19

### Fixed

- Namespace casing across server.json, npm `mcpName`, and the PyPI README marker corrected from `io.github.massed-compute/mcp` to `io.github.Massed-Compute/mcp`. The MCP Registry matches GitHub's case-preserving canonical org name (`Massed-Compute`); the lowercase form in 1.0.1 caused submission to fail with a permission mismatch. No functional changes.

## [1.0.1] — 2026-05-19

### Added — MCP Registry ownership verification

- Added `"mcpName": "io.github.massed-compute/mcp"` to `packages/node/package.json`. The MCP Registry uses this field to verify that the npm package and the server.json submission have the same owner.
- Added `<!-- mcp-name: io.github.massed-compute/mcp -->` to the README. PyPI surfaces the README as the project's long description; the Registry scans it for the matching string to verify ownership of the PyPI package.
- No functional changes — same 14 tools, same UX. Republish is purely so the published packages carry the verification metadata.

## [Unreleased]

### Changed (one-shot setup)

- `init` is now the entire post-install setup, not just the key step. It
  validates + stores the key, then auto-detects installed MCP clients
  (Claude Code, Cursor, Claude Desktop, Codex) and offers to wire each
  detected client. Users who copy the README's quickstart no longer need
  to remember to run `install-client` separately.
- `--clients claude-code,cursor` overrides detection and explicitly lists
  which clients to wire. `--no-install-clients` skips the wiring step
  (useful when the user only wants to store the key).
- `--yes` auto-accepts every detected client.
- `install-client` is still available as a standalone for adding a single
  client after the initial setup (e.g., the user installs Cursor next
  week and wants to wire just that).

### Added (idempotency pass)

- `init` and `install-client` now accept `--yes` / `--force` / `-y` to skip the
  "replace existing?" prompt in CI contexts.
- `init` reads the API key non-interactively from the CLI override (`--token` /
  `--token-file`) or `MASSED_COMPUTE_API_KEY` env. With either set, no TTY is
  needed — `init` becomes safe in CI provisioning scripts.

### Changed (idempotency pass)

- `install-client` is now fully idempotent. When the existing client entry
  byte-matches what we'd write, the command exits 0 silently with no backup
  file. Repeated runs no longer accumulate `.bak.<timestamp>` clutter.
- `init` is now fully idempotent. When the candidate key (CLI override or env)
  matches the stored key, re-running revalidates against the upstream and
  refreshes `validatedAt` without prompting.
- Idempotency works for both JSON clients (`claude-code`, `cursor`,
  `claude-desktop`) and the Codex/TOML target.

### Added (pass 2 hardening)

- `--token-file <path>` global flag on both CLIs. Avoids leaking the API key via `ps aux`, which is how `--token <value>` is exposed to other users on shared systems. The file's first line is used; trailing whitespace is stripped.
- Tests for `uninstall-client` (JSON + codex paths) and `config show` in both packages — 22 new test cases.

### Changed (pass 2 hardening)

- Spec validator now rejects `..`, `./`, and `//` segments in `upstream.path`. Closes a defense-in-depth gap where a tampered `tools-spec.json` could redirect calls outside `/api/v1/`.
- Atomic config writes now open the temp file with `O_NOFOLLOW` (POSIX) so a pre-created symlink at the temp path can't redirect our write elsewhere.
- Config *directory* is created with mode `0700`, matching `~/.aws` and `~/.kube`. The file is still `0600`. Closes the gap where a world-readable directory listing could reveal a credential exists.
- Size-cap error messages now show "5 MiB" instead of the raw byte count.
- Python `install_client.py` cleaned up — `re` and `shutil` imports moved to module top.
- `dist-leak.test.ts` now also scans `.json` artifacts (the spec) for forbidden internal terms.

### Added

- `--token` and `--base-url` global CLI flags (Node + Python). Take precedence over `MASSED_COMPUTE_API_KEY` env and the stored config file.
- `config show` subcommand. Prints the resolved config path, masked stored key, and the active resolution chain without making any upstream call.
- `uninstall-client <id>` subcommand. Removes the `massed-compute` MCP entry from a supported client config; always creates a timestamped backup first.
- `install-client codex` support. Adds `[mcp_servers.massed-compute]` to `~/.codex/config.toml` via a TOML-section-aware splice (no TOML parser dep).
- Per-tool-call upstream timeout (30s) in Node's `forward.ts`, matching the Python wrapper's existing httpx default.
- Response-body size cap (5 MiB) on every upstream tool call in both packages — defense-in-depth against a misbehaving or compromised upstream returning oversized payloads.
- `fsync` before `rename` on atomic config writes in both packages, preventing a power-loss window where the rename could promote a zero-byte file.
- Spec validation on load (`tools.ts` / `tools.py`) — every entry must have a name, a known HTTP method, and a `/api/v1/` path prefix. Fails loudly if `tools-spec.json` is tampered with.
- Raw-mode `SIGINT`/`SIGTERM` handler in Node's `prompt.ts` — guarantees the user's TTY is restored if the CLI is killed mid-`init`.
- GitHub Actions: `test` (Node 20/22 + Python 3.10–3.13 across Ubuntu/macOS/Windows) and `release` (publishes both packages on `v*` tags).
- CONTRIBUTING and SECURITY policy documents.

### Changed

- Version string is now read from a single source per package: `package.json` for Node (via JSON import in `server-card.ts`), `importlib.metadata` for Python. No more 5-place duplication.
- README documents pip alongside npm as a first-class install path.

### Removed

- Dropped the self-hosted streamable-HTTP server (`packages/node/src/index.ts`), its `env.ts` config layer, its `Dockerfile`, and its integration test. The npm package distributes only the stdio CLI; users who want a hosted endpoint use `https://vm.massedcompute.com/api/mcp` directly.

## [1.0.0] — 2026-05-19

### Added

- Initial public release.
- 14 MCP tools mapping 1:1 to documented operations at https://vm-docs.massedcompute.com/api/v1.
- Node (npm) and Python (pip) packages built from a shared `tools.json` spec.
- First-run UX: `init`, `doctor`, `install-client` (claude-code, cursor, claude-desktop), `logout`, `tools`.
- Cross-platform config file (XDG / Application Support / AppData) with `0600` permissions on POSIX.
- Contract test asserting the local spec matches the live hosted MCP endpoint.

[Unreleased]: https://github.com/Massed-Compute/massed-compute-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Massed-Compute/massed-compute-mcp/releases/tag/v1.0.0
