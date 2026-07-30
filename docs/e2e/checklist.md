# Massed Compute MCP — release E2E checklist

Rerun after every published release of `massed-compute-mcp` (npm/PyPI) and after hosted endpoint changes at `https://vm.massedcompute.com/api/mcp`.

Parent ticket: [MAR-17](https://massedcompute.atlassian.net/browse/MAR-17).

## Safety rules

1. Backup only these files before surgical edits; restore when the client’s cells are done:
   - `~/.cursor/mcp.json`
   - `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
   - `~/.codex/config.toml`
2. Swap **only** the `massed-compute` server entry. Never wipe the whole file.
3. Prefer Cursor **project** `.cursor/mcp.json` for Cursor cells so the user-level file stays untouched.
4. Do not delete or overwrite `~/.config/massed-compute/api_key`. Missing/invalid auth tests use a wrong env var or throwaway token for that process only.
5. No global installs: use `npx -y massed-compute-mcp@<ver>` and `uvx massed-compute-mcp==<ver>`.
6. At most one `mar17-e2e-*` instance live. Terminate before the next launch. Final `instances_list` sweep.

## Environment under test

Record for each run:

| Field | Value |
|---|---|
| Date | |
| npm/PyPI version | |
| Hosted URL | `https://vm.massedcompute.com/api/mcp` |
| Cursor version | |
| Claude Desktop version | |
| ChatGPT / Codex desktop version | |
| Operator | |

## Tool count (authoritative)

Hosted `tools/list` returns **17** tools (not 14). Every tool must have a human-readable `title`.

1. `gpu_inventory_list` — List GPU inventory  
2. `images_list` — List VM images  
3. `instances_list` — List running instances  
4. `instances_get` — Get a running instance  
5. `instances_launch` — Launch a new instance  
6. `instances_restart` — Restart instances  
7. `instances_terminate` — Terminate instances  
8. `coupon_information` — Get coupon information  
9. `coupon_accepted_products` — List products a coupon is valid for  
10. `account_token_validation` — Validate API token  
11. `account_billing` — Get account billing snapshot  
12. `ssh_keys_list` — List SSH keys  
13. `ssh_keys_create` — Add an SSH key  
14. `ssh_keys_delete` — Delete an SSH key  
15. `recipes_list` — List setup recipes  
16. `recipes_search` — Search setup recipes  
17. `recipes_get` — Fetch a recipe by slug  

## Config snippets (no secrets inline)

### Cursor — stdio npm — `~/.cursor/mcp.json` or project `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "massed-compute": {
      "command": "npx",
      "args": ["-y", "massed-compute-mcp@1.1.0"],
      "env": {}
    }
  }
}
```

Package resolves `MASSED_COMPUTE_API_KEY` or `~/.config/massed-compute/api_key`.

### Cursor — stdio PyPI

```json
{
  "mcpServers": {
    "massed-compute": {
      "command": "uvx",
      "args": ["massed-compute-mcp==1.1.0"],
      "env": {}
    }
  }
}
```

### Cursor — hosted Streamable HTTP

```json
{
  "mcpServers": {
    "massed-compute": {
      "url": "https://vm.massedcompute.com/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:MASSED_COMPUTE_API_KEY}"
      }
    }
  }
}
```

### Claude Desktop — stdio npm / PyPI

Same JSON shapes as Cursor. Path: `~/Library/Application Support/Claude/claude_desktop_config.json`.

### Claude Desktop — hosted HTTP

Claude Desktop does not speak Streamable HTTP natively. Use `mcp-remote` (or the local stdio package) as a bridge:

```json
{
  "mcpServers": {
    "massed-compute": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://vm.massedcompute.com/api/mcp",
        "--header",
        "Authorization: Bearer ${MASSED_COMPUTE_API_KEY}"
      ],
      "env": {}
    }
  }
}
```

Prefer stdio `massed-compute-mcp` for Claude daily use.

### Codex / ChatGPT desktop — `~/.codex/config.toml`

Hosted HTTP:

```toml
[mcp_servers.massed-compute]
url = "https://vm.massedcompute.com/api/mcp"
bearer_token_env_var = "MASSED_COMPUTE_API_KEY"
enabled = true
```

Stdio npm:

```toml
[mcp_servers.massed-compute]
command = "npx"
args = ["-y", "massed-compute-mcp@1.1.0"]
enabled = true
```

Stdio PyPI:

```toml
[mcp_servers.massed-compute]
command = "uvx"
args = ["massed-compute-mcp==1.1.0"]
enabled = true
```

## Matrix (connect cells)

For each cell: surgical config → reload MCP in client → server visible → 17 tools with titles → `account_token_validation` OK → disconnect/reconnect without app restart → restore config.

| Cell | Pass |
|---|---|
| Cursor, stdio via npm | [ ] |
| Cursor, stdio via PyPI | [ ] |
| Cursor, hosted Streamable HTTP | [ ] |
| Codex desktop, stdio via npm | [ ] |
| Codex desktop, stdio via PyPI | [ ] |
| Codex desktop, hosted Streamable HTTP | [ ] |
| Claude desktop, stdio via npm | [ ] |
| Claude desktop, stdio via PyPI | [ ] |
| Claude desktop, hosted Streamable HTTP (`mcp-remote` or equivalent) | [ ] |

Protocol-only proof (outside GUI) for the three transports is required before ticking a cell if the GUI cannot be exercised that day; note that in the results file.

## Setup checks (per client)

- [ ] Fresh Massed Compute entry (other servers untouched)
- [ ] Config path + exact syntax recorded
- [ ] Server in tool list
- [ ] Tool count = 17; titles human-readable
- [ ] Auth success
- [ ] Missing key → clear error
- [ ] Invalid key → clear error
- [ ] Disconnect/reconnect without full app restart

## Tool checklist (run once vs hosted HTTP)

Valid input, then deliberately bad input. Record exact responses in the dated results file.

### Read-only

- [ ] `account_token_validation`
- [ ] `account_billing`
- [ ] `gpu_inventory_list`
- [ ] `images_list`
- [ ] `instances_list`
- [ ] `instances_get`
- [ ] `recipes_list`
- [ ] `recipes_get`
- [ ] `recipes_search`
- [ ] `ssh_keys_list`
- [ ] `coupon_information`
- [ ] `coupon_accepted_products`

### State-changing (careful)

- [ ] `ssh_keys_create` (ED25519 + RSA)
- [ ] `ssh_keys_delete` (bad id must not silently succeed)
- [ ] `instances_launch` (bad input only in tool pass; real launch in workflows)
- [ ] `instances_restart` (bad UUID)
- [ ] `instances_terminate` (bad UUID)

## Behaviors

- [ ] Errors actionable (no bare Internal Server Error)
- [ ] Invalid input rejected usefully
- [ ] Responses reasonably sized
- [ ] Destructive tools prompt when client supports it
- [ ] No secrets/tokens in tool responses
- [ ] `tools/list` stable order across ≥3 calls

## GPU workflows

Use GPU SKUs only. One live instance max. Name `mar17-e2e-*`.

### Cursor (full)

- [ ] Inventory → pick GPU → launch → Running + public IP → terminate
- [ ] Create/register SSH key (or document MCDEV-464) → launch with existing key → SSH works → terminate
- [ ] `recipes_search` → `recipes_get` → launch from recipe → terminate
- [ ] `account_billing` matches marketplace UI

### Claude desktop / Codex desktop (proof)

- [ ] Claude: one GPU launch → Running + IP → terminate
- [ ] Codex: one GPU launch → Running + IP → terminate

## Deliverables

- [ ] Dated results file under `docs/e2e/results/`
- [ ] MCDEV ticket per new failure
- [ ] This checklist still accurate after the run
