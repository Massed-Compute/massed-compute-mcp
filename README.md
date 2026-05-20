# Massed Compute MCP Server

<!-- mcp-name: io.github.Massed-Compute/mcp -->

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI assistants — Claude, Cursor, Codex, ChatGPT, and other MCP-compatible clients — interact with your [Massed Compute](https://vm.massedcompute.com) account: browse GPU inventory, launch and manage VMs, audit billing.

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Verifying the connection](#verifying-the-connection)
- [CLI reference](#cli-reference)
- [Key resolution](#key-resolution)
- [Resources](#resources)
- [License](#license)

## Overview

The server exposes 14 tools that map 1:1 to documented `/api/v1/*` endpoints — no internal services, no undocumented calls. Issue a read-only key for analysis-only assistants and destructive tools (launch, restart, terminate, SSH-key changes) are hidden from the catalog entirely. Works with Claude Code, Claude Desktop, Cursor, and Codex.

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

Beyond raw tools, Massed Compute publishes [Agent Skills](https://vm-docs.massedcompute.com/docs/mcp/skills) — markdown workflow templates for common operations like GPU selection and cost auditing. Full docs at [vm-docs.massedcompute.com/docs/category/mcp](https://vm-docs.massedcompute.com/docs/category/mcp).

## Installation

### Step 1. Get your API key

Open [vm.massedcompute.com/settings/api](https://vm.massedcompute.com/settings/api), create a key (read-only for analysis-only assistants; full-access to allow launch / restart / terminate / SSH-key changes), copy it.

### Step 2. Pick an install path

<details open>
<summary><b>Local CLI</b> — runs on your machine, key stored in your OS config dir</summary>

<br>

Install via whichever ecosystem you prefer:

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

`init` prompts for the key, validates it upstream, stores it at `0600` (POSIX), detects installed MCP clients (Claude Code, Cursor, Claude Desktop, Codex), and offers to wire each one. A timestamped backup is taken before any client edit. Restart wired clients to pick up the tools.

Config file location:

- Linux: `$XDG_CONFIG_HOME/massed-compute/config.json` (falls back to `~/.config/...`)
- macOS: `~/Library/Application Support/massed-compute/config.json`
- Windows: `%APPDATA%\massed-compute\config.json`

Non-interactive (CI / scripts):

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

`install-client` is idempotent — re-running when the entry already matches is a silent no-op.

</details>

<details>
<summary><b>Hosted endpoint</b> — point your client at the streamable-HTTP URL, zero install</summary>

<br>

Same 14 tools, same API key, nothing to install. Pick the snippet for your client:

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

</details>

## Verifying the connection

```bash
massed-compute-mcp doctor
```

`doctor` confirms the stored key still works, prints the tool catalog, and shows copy-pasteable snippets for any clients you didn't auto-wire. Or just ask your assistant *"Validate my Massed Compute API key."* — a `{ message: "Valid Token" }` response confirms the wiring.

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

## Resources

- [Full MCP documentation](https://vm-docs.massedcompute.com/docs/category/mcp)
- [Massed Compute API reference](https://vm-docs.massedcompute.com/api/v1)
- [Massed Compute console](https://vm.massedcompute.com)
- [Model Context Protocol spec](https://modelcontextprotocol.io)

## License

MIT — see [LICENSE](./LICENSE).
