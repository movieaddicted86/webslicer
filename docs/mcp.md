# MCP: let agents slice

WebSlicer speaks the [Model Context Protocol](https://modelcontextprotocol.io) (Streamable HTTP) at
`/mcp`, so an assistant can look through printers, presets and the library, build a project in it and
slice it – without a browser. Concept and roadmap: [MCP-Concept.md](MCP-Concept.md).

The endpoint exists only with a token configured: without `MCP_TOKEN` `/mcp` answers **404**, a
missing or wrong `Authorization: Bearer …` header answers **401**. Tokens are scrypt hashes in
`data/mcp-tokens.json`; `MCP_TOKEN` is stored there as the owner `admin` on every start and removed
again when the variable disappears. Every call is written to `data/audit.log` (time, token id, owner,
tool, parameters – never the token or a printer API key). A token only ever sees the projects of its
own owner.

## Enabling the endpoint

```bash
# Docker Compose: uncomment "- MCP_TOKEN=change-me" in docker-compose.yml, or pass it directly
docker run -d --name webslicer -p 8080:8080 -e MCP_TOKEN=change-me \
  -v webslicer-data:/data -v /path/to/models:/library webslicer
```

On a Proxmox install (LXC) the service reads `/etc/webslicer/webslicer.env`; add the line and restart:

```bash
echo 'MCP_TOKEN=change-me' >> /etc/webslicer/webslicer.env
systemctl restart webslicer
```

Updates keep the file (the installer only refreshes `PORT` and appends missing lines), so the token
survives a re-install.

## Client configuration

Claude Code:

```bash
claude mcp add --transport http webslicer http://webslicer.local:8080/mcp \
  --header "Authorization: Bearer change-me"
```

…or as `.mcp.json` in the project:

```json
{
  "mcpServers": {
    "webslicer": {
      "type": "http",
      "url": "http://webslicer.local:8080/mcp",
      "headers": { "Authorization": "Bearer change-me" }
    }
  }
}
```

Claude Desktop: _Settings → Connectors → Add custom connector_ works with a URL, but not with a
static bearer header – bridge it through `mcp-remote` in `%APPDATA%\Claude\claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "webslicer": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://webslicer.local:8080/mcp", "--header", "Authorization:${WEBSLICER_MCP_TOKEN}"],
      "env": { "WEBSLICER_MCP_TOKEN": "Bearer change-me" }
    }
  }
}
```

No space around the `:` inside `args` – Claude Desktop on Windows does not quote spaces there.

## Tools

| Tool                          | Arguments                                  | What it does                                                                          |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `webslicer.list_printers`     | –                                          | installed printers plus the printer presets of each                                   |
| `webslicer.list_presets`      | `type`, `printer?`, `print?`               | print/filament/printer presets with the compatibility flag                            |
| `webslicer.get_option_schema` | `query?`, `type?`, `limit?`                | options with label, type, default and allowed values (an exact key match ranks first) |
| `webslicer.list_library`      | `path?`                                    | models, projects and G-code in the file library                                       |
| `webslicer.create_project`    | `printer`, `print`, `filaments?`           | a server-side project → `project_id` (expires 24 h after its last use)                |
| `webslicer.add_model`         | `project_id`, `library_path`, `copies?`    | adds an STL or 3MF from the library (3MF keeps its objects and their places)          |
| `webslicer.arrange`           | `project_id`                               | packs the instances on the bed                                                        |
| `webslicer.set_settings`      | `project_id`, `scope`, `values`            | sets options, validated against the schema (unknown keys are rejected)                |
| `webslicer.quick_settings`    | `project_id`, `supports`, `infill`, `brim` | the three plater quick settings                                                       |
| `webslicer.slice`             | `project_id`                               | starts a slicing job → `job_id` (headless slices carry no thumbnails)                 |
| `webslicer.get_job`           | `job_id`                                   | status, progress, time, filament (mm/g/cost), layers and the slicer warnings          |

`slice` and the project tools are the writing ones, the rest is marked read-only (`readOnlyHint`).
`set_settings` takes `scope: "print"`, `"printer"`, `"filament"` or `"filament[<index>]"` for the
other extruders.

## Quotas

`MAX_JOBS` protects the CPU, but nothing protected the queue a person shares with an agent: one
token could queue slices without end and the browser's own slice waited behind them. Every token is
therefore limited on its own:

| Limit                   | Default | Variable                  |
| ----------------------- | ------- | ------------------------- |
| jobs queued or running  | 2       | `MCP_MAX_CONCURRENT_JOBS` |
| slices started per hour | 30      | `MCP_MAX_SLICES_PER_HOUR` |

The counters are **per token**, never per owner, and they are held in memory – a restart forgets
them, like the authentication limiter. The hourly limit is a rolling window, so the 31st slice an
hour after the first works again. A refused call is an **MCP tool error** whose message names the
limit ("This token already has 2 slicing jobs queued or running (limit 2)…"), and it is written to
the audit log like any other call, so a human can see who was refused and why.

An MCP slice still counts against the global `MAX_JOBS`, so the quotas never raise the server's
load; they only keep one agent from filling the queue ahead of everybody else. The browser is not
subject to them.

## Audit log

Every MCP call and every accepted send override appends one JSON line to `data/audit.log`. The file
rotates by size instead of growing forever:

- `AUDIT_LOG_MAX_BYTES` (default 10 MB) – an append that would take the current file past this limit
  first rotates it.
- `AUDIT_LOG_KEEP_FILES` (default 5) – how many older generations are kept as `audit.log.1` …
  `audit.log.5`; the next one is deleted, so the log uses at most `(keep + 1) × max` bytes.
- The append that rotates the file (`audit.log` → `audit.log.1`) also runs for the send override's
  strict write, and a strict write that cannot be recorded still fails the request (see
  [SECURITY.md](../SECURITY.md)).

Reading the log for the UI reads a bounded tail of the current file (the newest entries) with async
fs, so a 10 MB log never blocks the server.

## Testing the endpoint by hand

```bash
# all tools with their JSON schemas
npx @modelcontextprotocol/inspector --cli http://localhost:8080/mcp --transport http \
  --method tools/list --header "Authorization: Bearer $MCP_TOKEN"

# the whole workflow (AC-1 … AC-5) against a running server, see server/scripts/mcp-e2e.ts
MCP_TOKEN=change-me npx tsx server/scripts/mcp-e2e.ts
```
