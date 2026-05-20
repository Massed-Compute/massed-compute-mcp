# Security Policy

## Supported versions

The latest minor release of `massed-compute-mcp` on both npm and PyPI receives security updates. Older versions do not — if you're more than one minor behind, please upgrade first.

| Version | Supported |
|---|---|
| 1.x (latest) | ✅ |
| Earlier | ❌ |

## Reporting a vulnerability

**Please do not file a public issue or pull request for a security finding.** Disclosing publicly before a fix is available puts our users at risk.

Email `security@massedcompute.com` with:

- A description of the issue and its impact (what an attacker can do).
- A minimal reproduction — exact CLI / API call, version of the package, OS.
- Whether you've checked that the issue exists in the latest release.
- Whether you've already disclosed it elsewhere.

We aim to acknowledge reports within **2 business days** and to ship a fix or have a remediation plan within **30 days** of the initial report for high-severity issues. We'll keep you updated on progress and credit you in the changelog (or, if you prefer, treat the report as anonymous).

## Threat model

`massed-compute-mcp` is a local CLI that holds a Bearer API key and forwards HTTP calls on the user's behalf. It is **not** an authentication system, secret manager, or sandbox.

### In scope

- Credential leakage from our local config file or process output.
- Path traversal or command injection in `install-client` / `uninstall-client` when handling user-controlled MCP client config files.
- Forging or spoofing the upstream endpoint to harvest keys.
- TLS verification regressions.
- Supply-chain integrity of the published packages (npm provenance, PyPI trusted publishing).

### Out of scope

- An attacker with code-execution on the user's machine can read the `0600` config file. We use OS-level file permissions; protection beyond that requires OS keychain integration, which is planned but not a current guarantee.
- A malicious MCP client could spawn `massed-compute-mcp` and read its stdout to obtain tool results — that's how the MCP protocol works.
- The hosting infrastructure (`vm.massedcompute.com/api/mcp` and `/api/v1/*`) is in scope for that service's own security policy, not this package.

## Defensive design highlights

- The API key lives only in our `0600` config file, **never** copied into the MCP client's own config when you run `install-client`. The MCP client config holds only `{ "command": "massed-compute-mcp" }`.
- Tool calls have a 30-second timeout and a 5 MiB response cap.
- Atomic temp-file + fsync + rename on config writes prevents corruption-induced credential loss.
- On startup, `tools-spec.json` is validated for shape; tampering causes the server to refuse to start rather than forward to attacker-controlled paths.
- No runtime telemetry. The wrapper does not phone home, log to third parties, or include analytics.

## Disclosure timeline

For critical issues (RCE, credential theft from a passive observer, etc.):

1. We acknowledge within 2 business days.
2. We develop and validate a fix.
3. We publish the patched release.
4. We publish a security advisory on GitHub with details.

For lower-severity issues we may bundle the fix into the next planned release.
