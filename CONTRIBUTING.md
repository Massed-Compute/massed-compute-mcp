# Contributing

Thanks for taking the time to contribute. This repo is a monorepo containing the Massed Compute MCP wrapper in two languages (Node/TypeScript and Python). Each package is a verbatim JSON-RPC pass-through to the hosted MCP endpoint at `https://vm.massedcompute.com/api/mcp` — there is no local tool catalog to maintain.

## Development setup

```bash
git clone https://github.com/Massed-Compute/massed-compute-mcp
cd massed-compute-mcp
npm run sync-docs           # copies the repo-root README/LICENSE into each package
```

### Node package

```bash
cd packages/node
npm ci
npm run build
npm test                    # vitest, 52 tests
node dist/cli.js help
```

### Python package

```bash
cd packages/python
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest tests/     # 44 tests
.venv/bin/massed-compute-mcp help
```

### Run the whole suite

From the repo root:

```bash
npm test                    # runs sync-docs + node tests + python tests + hosted smoke test
```

## The pass-through contract

The stdio server forwards every JSON-RPC message verbatim to the hosted endpoint and relays responses verbatim. The only additions are transport-level: the stored API key as a Bearer header, `MCP-Protocol-Version` / `Mcp-Session-Id` bookkeeping, a 30 s per-request timeout, and a 5 MiB response cap. Keep it that way — do not add code that inspects, filters, or rewrites message payloads. Tools, schemas, scope enforcement, and redaction are all owned by the hosted endpoint.

`scripts/smoke-test.mjs` runs nightly and asserts the hosted endpoint still answers `initialize` and returns a non-empty `tools/list`. Adding or changing tools happens in the service that backs the hosted endpoint, not in this repo.

The `tests/dist-leak.test.ts` obfuscation lint (which forbids internal service names from shipped artifacts) is load-bearing — don't bypass it.

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
