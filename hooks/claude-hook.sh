#!/usr/bin/env bash
# Claude Code hook script - sends tool call events to the analysis server.
#
# Configure in Claude Code settings:
#   "hooks": {
#     "PostToolUse": [{
#       "command": "/path/to/claude-hook.sh"
#     }]
#   }
#
# The hook receives JSON on stdin with tool call details.

HOOK_SERVER="${CLAUDE_HOOK_SERVER:-http://localhost:3456}"

# Read stdin (Claude Code passes JSON with tool info)
input=$(cat)

# Extract fields and forward to hook server
curl -s -X POST "${HOOK_SERVER}/event" \
  -H "Content-Type: application/json" \
  -d "$input" \
  > /dev/null 2>&1

exit 0
