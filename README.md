# Claude Code Session Analyzer

Analyze Claude Code JSONL session transcripts to understand reasoning chains, tool usage patterns, token consumption, and skill/config impact.

## Quick Start

```bash
npm install
```

### Typical Workflow

```bash
# 1. List your recent sessions
npx tsx src/cli.ts list

# 2. Analyze a session
npx tsx src/cli.ts analyze ~/.claude/projects/<project>/<session-id>.jsonl

# 3. Export as JSON for further processing
npx tsx src/cli.ts analyze <path-to-session.jsonl> --json
```

## Usage

### `list` - Browse Sessions

Scans `~/.claude/projects/` and lists available session files with metadata.

```bash
npx tsx src/cli.ts list
```

### `analyze` - Analyze a Session

Produces four analysis sections:

1. **Reasoning Chain** - Chronological timeline of thinking, tool calls, and text output
2. **Tool Dashboard** - Call counts, success/failure rates, most-accessed files, sequential patterns
3. **Context Tracker** - Per-turn token breakdown with cache hit rates and compaction detection
4. **Skill/Config Impact** - Estimated token cost of CLAUDE.md, skills, and config files

```bash
# Full terminal output
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
