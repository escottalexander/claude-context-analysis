# Claude Code Session Analyzer

A web-based tool for analyzing Claude Code JSONL session transcripts. Visualize reasoning chains, tool usage patterns, token consumption, and skill/config impact through a browser UI inspired by Chrome DevTools' Network tab.

## Quick Start

```bash
npm install
npm start
```

This starts the web explorer at `http://127.0.0.1:3457`. It auto-discovers sessions from `~/.claude/projects/`.

To open a specific session file directly:

```bash
npm start -- ~/.claude/projects/<project>/<session-id>.jsonl
```

## Features

- **Network-style timeline** — filter by tool type, status, search text, and minimum duration
- **Agent scope tabs** — switch between `main` and sidechain agent timelines
- **Request detail pane** — click any row to see full input, result, timing, and context spike data
- **Session browser** — pick from all discovered sessions in the sidebar
- **Live reload** — re-analyzes the session file when it changes on disk

## Analysis Sections

1. **Reasoning Chain** — chronological timeline of thinking, tool calls, and text output
2. **Tool Dashboard** — call counts, success/failure rates, most-accessed files, sequential patterns
3. **Context Tracker** — per-turn token breakdown with cache hit rates and compaction detection
4. **Skill/Config Impact** — estimated token cost of CLAUDE.md, skills, and config files

## Development

```bash
npm test
npm run test:watch
```
