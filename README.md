# Claude Code Session Analyzer

Analyze Claude Code JSONL session transcripts to understand reasoning chains, tool usage patterns, token consumption, and skill/config impact.

## Quick Start

```bash
npm install
```

### Typical Workflow

```bash
# 1. Start the web explorer (default)
npm run start

# 2. Start web explorer for a specific session path
npm run start -- ~/.claude/projects/<project>/<session-id>.jsonl

# 3. Or run terminal analyze mode directly
npx tsx src/cli.ts analyze ~/.claude/projects/<project>/<session-id>.jsonl

# 4. Export as JSON for further processing
npx tsx src/cli.ts analyze --json
```

## Usage

### `list` - Browse Sessions

Scans `~/.claude/projects/` and lists available session files with metadata.

```bash
npx tsx src/cli.ts list
```

### `analyze` - Analyze a Session

Run without arguments to pick from a list of recent sessions, or pass a path directly.

Produces four analysis sections:

1. **Reasoning Chain** - Chronological timeline of thinking, tool calls, and text output
2. **Tool Dashboard** - Call counts, success/failure rates, most-accessed files, sequential patterns
3. **Context Tracker** - Per-turn token breakdown with cache hit rates and compaction detection
4. **Skill/Config Impact** - Estimated token cost of CLAUDE.md, skills, and config files

```bash
# Interactive session picker
npx tsx src/cli.ts analyze

# Direct path
npx tsx src/cli.ts analyze <path>

# Hide thinking blocks
npx tsx src/cli.ts analyze <path> --no-thinking

# Filter tool dashboard to a specific tool
npx tsx src/cli.ts analyze <path> --tool-filter Bash

# Output JSON to stdout
npx tsx src/cli.ts analyze <path> --json

# Write JSON to a file
npx tsx src/cli.ts analyze <path> --output analysis.json
```

### `web` - Browser Session Explorer (Default Start Mode)

`npm run start` now launches the browser-based explorer by default (`tsx src/cli.ts web`).

The web experience is inspired by Chrome DevTools' Network tab:

- filter by tool type, status, search text, and minimum time
- switch agent scopes (`main` and sidechains) without mixing timelines
- click any row to drill into full request details (input, result, time, context spike)

```bash
# Default start (web mode)
npm run start

# Default start with a specific session path
npm run start -- <path>

# Explicit web mode
npx tsx src/cli.ts web
npx tsx src/cli.ts web <path>
```

### `network` - Interactive Agent-Scoped Network View

Shows tool requests as an agent-scoped timeline. Only one scope is active at a time (`main` or sidechain agent), with per-request `Time` and `Ctx+` columns plus an optional detail pane.

```bash
# Interactive session picker
npx tsx src/cli.ts network

# Direct path
npx tsx src/cli.ts network <path>
```

Keybindings:

- `←` / `→` switch agent scope tabs
- `↑` / `↓` move request selection within active scope
- `Enter` open detail pane for selected request
- `Esc` close detail pane
- `q` quit

### `serve` - Real-time Hook Receiver

Starts an HTTP server that receives live tool call data from Claude Code hooks.

```bash
npx tsx src/cli.ts serve
npx tsx src/cli.ts serve --port 4000
```

Endpoints:

- `POST /event` - Receive a hook event (JSON body with `session_id`, `tool_name`, etc.)
- `GET /api/sessions` - List all tracked sessions
- `GET /api/session/:id` - Get accumulated events and tool summary for a session

Default port is `3456`. Configure Claude Code to send hook data using the included `hooks/claude-hook.sh` script.

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch
```
