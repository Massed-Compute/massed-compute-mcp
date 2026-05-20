# Massed Compute MCP Server

<!-- mcp-name: io.github.Massed-Compute/mcp -->

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI assistants — Claude, Cursor, Codex, ChatGPT, and other MCP-compatible clients — interact with your [Massed Compute](https://vm.massedcompute.com) account: browse GPU inventory, launch and manage VMs, audit billing.

## Contents

- [Overview](#overview)
- [Installation](#installation)
  - [Option A — Local CLI (npm / pip)](#option-a--local-cli-npm--pip)
  - [Option B — Hosted endpoint (streamable HTTP)](#option-b--hosted-endpoint-streamable-http)
  - [Choosing a path](#choosing-a-path)
- [Verifying the connection](#verifying-the-connection)
- [Tools](#tools)
- [CLI reference](#cli-reference)
- [Key resolution](#key-resolution)
- [Security](#security)
- [Repo layout](#repo-layout)
- [Resources](#resources)
- [License](#license)

## Overview

- 14 tools covering GPU inventory, instance lifecycle, SSH-key management, billing, and coupons.
- Two install paths: a local CLI that runs the server over stdio, or a hosted streamable-HTTP endpoint.
- Read-only keys hide destructive tools from the catalog entirely.
- Works with Claude Code, Claude Desktop, Cursor, and Codex.

Full docs: [vm-docs.massedcompute.com/docs/category/mcp](https://vm-docs.massedcompute.com/docs/category/mcp).

## Installation

### Get your API key

1. Open [vm.massedcompute.com/settings/api](https://vm.massedcompute.com/settings/api).
2. Create a key. Pick **read-only** for analysis-only assistants, or **full-access** to allow launch / restart / terminate / SSH-key changes.
3. Copy it.

### Option A — Local CLI (npm / pip)

The CLI runs the server on your machine and talks to `https://vm.massedcompute.com/api/v1/*` directly. Your key is stored in your OS config dir (`0600` on POSIX), never written into the MCP client's config file.

Install via whichever ecosystem you prefer — same binary name, same subcommands, same config location:

```bash
npm install -g massed-compute-mcp     # Node >= 20
# or
pip install massed-compute-mcp        # Python >= 3.10
# or
uv tool install massed-compute-mcp    # fast Python install via uv
```

Run one-shot setup:

```bash
massed-compute-mcp init
```

`init` prompts for the key, validates it upstream, stores it, detects installed MCP clients (Claude Code, Cursor, Claude Desktop, Codex), and offers to wire each one. A timestamped backup is taken before any client edit. Restart wired clients to pick up the new tools.

Config file location:

- Linux: `$XDG_CONFIG_HOME/massed-compute/config.json` (falls back to `~/.config/...`)
- macOS: `~/Library/Application Support/massed-compute/config.json`
- Windows: `%APPDATA%\massed-compute\config.json`

Non-interactive setup (CI / scripts):

```bash
# Key from env, auto-wire every detected client
MASSED_COMPUTE_API_KEY=<your-key> massed-compute-mcp init --yes

# Key from a file, wire only specific clients
massed-compute-mcp init --token-file ~/keys/mc --yes --clients claude-code,cursor

# Store the key only; don't touch any client config
massed-compute-mcp init --yes --no-install-clients
```

Add or remove a client later:

```bash
massed-compute-mcp install-client cursor       # claude-desktop | codex | claude-code
massed-compute-mcp uninstall-client cursor
```

`install-client` is idempotent — re-running when the entry already matches is a silent no-op with no backup file.

### Option B — Hosted endpoint (streamable HTTP)

Point your MCP client directly at the hosted server. Same 14 tools, same API key, nothing to install.

**Claude Code**

```bash
claude mcp add --transport http massed-compute \
  https://vm.massedcompute.com/api/mcp \
  --header "Authorization: Bearer MC_TOKEN"
```

**Cursor** — `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "massed-compute": {
      "url": "https://vm.massedcompute.com/api/mcp",
      "headers": { "Authorization": "Bearer MC_TOKEN" }
    }
  }
}
```

**Codex** — `~/.codex/config.toml`

```toml
[mcp_servers.massed-compute]
url = "https://vm.massedcompute.com/api/mcp"
bearer_token_env_var = "MC_TOKEN"
enabled = true
```

**Claude Desktop**

Claude Desktop does not yet speak streamable-HTTP MCP, so use [`mcp-remote`](https://github.com/geelen/mcp-remote) as a stdio↔HTTP bridge. Config at `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "massed-compute": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://vm.massedcompute.com/api/mcp",
        "--header", "Authorization: Bearer MC_TOKEN"
      ]
    }
  }
}
```

### Choosing a path

| Local CLI | Hosted endpoint |
|---|---|
| Key kept off the client config file | Zero install |
| Works in air-gapped or proxied networks | Required for clients without stdio support |
| Forkable and scriptable | Per-IP and per-user throttles applied at the edge |

Both paths call the same documented `/api/v1/*` endpoints.

## Verifying the connection

```bash
massed-compute-mcp doctor
```

`doctor` confirms the stored key still works, prints the tool catalog, and shows copy-pasteable snippets for any clients you didn't auto-wire. Or just ask your assistant *"Validate my Massed Compute API key."* — a `{ message: "Valid Token" }` response confirms the wiring.

## Tools

| Tool | Required key | Returns |
|---|---|---|
| `gpu_inventory_list` | read-only | GPU configurations, pricing, regional capacity |
| `images_list` | read-only | VM image catalog |
| `instances_list` | read-only | Your running VM instances |
| `instances_get` | read-only | A single instance by UUID |
| `instances_launch` | full | Newly-launched instance details (incurs cost) |
| `instances_restart` | full | Restart confirmation |
| `instances_terminate` | full | Termination confirmation (destructive) |
| `coupon_information` | read-only | Coupon discount terms |
| `coupon_accepted_products` | read-only | Products a coupon applies to |
| `account_token_validation` | read-only | Token validity status |
| `account_billing` | read-only | Billing settings, recharge configuration |
| `ssh_keys_list` | read-only | Your SSH keys |
| `ssh_keys_create` | full | Newly-created key details |
| `ssh_keys_delete` | full | Deletion confirmation (destructive) |

Per-tool argument schemas are advertised by the server itself and rendered in your MCP client. For the full prose reference, see the [tool documentation](https://vm-docs.massedcompute.com/docs/category/mcp).

Beyond raw tools, Massed Compute publishes [Agent Skills](https://vm-docs.massedcompute.com/docs/mcp/skills) — markdown workflow templates for common operations like GPU selection and cost auditing.

## CLI reference

| Command | What it does |
|---|---|
| `massed-compute-mcp` *(no args)* | Run the MCP server over stdio |
| `massed-compute-mcp init` | First-run setup: prompt, validate, store, wire clients |
| `massed-compute-mcp doctor` | Verify the stored key and print client snippets |
| `massed-compute-mcp install-client <id>` | Wire a single client (`claude-code`, `cursor`, `claude-desktop`, `codex`) |
| `massed-compute-mcp uninstall-client <id>` | Remove our entry from a client config |
| `massed-compute-mcp config show` | Print resolved config path, masked key, resolution chain |
| `massed-compute-mcp logout` | Delete the stored API key |
| `massed-compute-mcp tools [--json]` | Print the tool catalog (no upstream call) |
| `massed-compute-mcp version` | Print the version |

## Key resolution

When the server starts, the API key is taken from the first source that provides one:

1. `--token <value>` CLI flag
2. `--token-file <path>` CLI flag (first line, trimmed)
3. `MASSED_COMPUTE_API_KEY` environment variable
4. Stored config file written by `init`

If none of those are set, the server exits non-zero with a pointer to `massed-compute-mcp init`. Override the upstream with `MASSED_COMPUTE_API_BASE_URL` (default `https://vm.massedcompute.com`).

## Security

- Key stored at mode `0600` inside a `0700` config directory on POSIX; user-profile ACLs on Windows.
- Atomic config writes with `fsync` before `rename` and `O_NOFOLLOW` on POSIX.
- Every upstream call has a 30s timeout and a 5 MiB response-body cap.
- Spec validation rejects `..`, `./`, and `//` segments in tool paths.
- The wrapper only calls documented `/api/v1/*` endpoints.
- Issue a read-only key for any assistant that doesn't need to make changes — destructive tools return 403 and clients hide them entirely.

## Repo layout

```
massed-compute-mcp/
├── tools.json              # single source of truth - 14 tool definitions
├── packages/
│   ├── node/               # npm package (TypeScript)
│   └── python/             # pip package (Python >= 3.10)
└── scripts/
    ├── sync-tools.mjs      # copies tools.json + README + LICENSE into each package
    └── contract-test.mjs   # asserts both packages and the hosted endpoint agree
```

Node and Python ship identical UX — same subcommands, same env vars, same on-disk config schema. The contract test runs in CI and fails loudly if any implementation drifts.

## Resources

- [Full MCP documentation](https://vm-docs.massedcompute.com/docs/category/mcp)
- [Massed Compute API reference](https://vm-docs.massedcompute.com/api/v1)
- [Massed Compute console](https://vm.massedcompute.com)
- [Model Context Protocol spec](https://modelcontextprotocol.io)

## License

MIT — see [LICENSE](./LICENSE).
