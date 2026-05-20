# Contributing

Thanks for taking the time to contribute. This repo is a monorepo containing the Massed Compute MCP wrapper in two languages (Node/TypeScript and Python), driven from a shared `tools.json` spec.

## Development setup

```bash
git clone https://github.com/Massed-Compute/massed-compute-mcp
cd massed-compute-mcp
npm run sync-tools          # generates per-package tools-spec.json + copies README/LICENSE
```

### Node package

```bash
cd packages/node
npm ci
npm run build
npm test                    # vitest, 73+ tests
node dist/cli.js help
```

### Python package

```bash
cd packages/python
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest tests/     # 40+ tests
.venv/bin/massed-compute-mcp help
```

### Run the whole suite

From the repo root:

```bash
npm test                    # runs sync-tools + node tests + python tests + contract test
```

## Tool spec

`tools.json` at the repo root is the single source of truth for the 14-tool catalog. `scripts/sync-tools.mjs` copies it into each package's source tree (`packages/<lang>/src/.../tools-spec.json`) at build time. Edits to the per-package copies are wiped — only edit `tools.json`.

`scripts/contract-test.mjs` runs nightly and asserts that:

1. `tools.json` matches every per-package generated spec, and
2. Both match the live hosted endpoint at `https://vm.massedcompute.com/api/mcp`.

A drifted spec fails CI loudly. Fix by editing `tools.json` and running `npm run sync-tools`.

## Adding or changing a tool

1. Edit `tools.json` at the repo root.
2. Run `npm run sync-tools` to propagate.
3. Update `packages/node/tests/tools.test.ts` and `packages/python/tests/test_tools.py` if structural expectations change.
4. Open a PR.

The `tests/tools.test.ts` obfuscation lint (which forbids internal terms like `vm-marketplace` from tool descriptions) is load-bearing — every tool description ends up in users' AI assistant contexts. Don't bypass it.

## Adding an MCP client

Adding a new install-client target means updating:

- `packages/node/src/commands/install-client.ts` (`targets()`)
- `packages/node/src/commands/uninstall-client.ts` (`targets()`)
- The same two files under `packages/python/src/massed_compute_mcp/commands/`
- Tests for each
- README's "Wire it into your MCP client" section

If the new client uses an exotic config format, prefer a small line-based splice (like the codex TOML handler) over pulling in a parser dep. Every runtime dep added to either package is supply-chain surface we ship to every user.

## Commit style

Conventional Commits, lower-case scope:

- `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`, `build:`
- Optional scope: `feat(node):`, `fix(python):`, `chore(ci):`

## Releasing

Releases are gated on a `v*` git tag. The `release.yml` workflow:

1. Re-runs the test suite against the tagged commit.
2. Publishes `packages/node` to npm with provenance attestation.
3. Publishes `packages/python` to PyPI via trusted publishing (OIDC).

Both packages share one version. Bump in:

- `packages/node/package.json` `version`
- `packages/python/pyproject.toml` `[project] version`

Then `git tag v1.x.y && git push --tags`.

## Reporting security issues

See [SECURITY.md](SECURITY.md) — please do not file a public issue for a security finding.
