
PROJECT OVERVIEW
Claude Code Session Analyzer

Internal Development Brief for Engineering
February 2026

CONFIDENTIAL
1. What We’re Building
A tool that reads Claude Code session transcripts (JSONL files stored locally on disk) and produces a structured, human-readable analysis of what happened during each session. The output should surface three things: the reasoning chain (Claude’s “train of thought”), every tool call with its inputs and outputs, and context window usage over time.



2. Why This Matters
Claude Code sessions are opaque by default. The terminal shows a fraction of what’s happening. Under the hood, Claude is reading files, spawning subagents, caching context, and making dozens of tool calls. Understanding these internals lets us optimize prompts, debug failures, control costs, and measure the impact of configuration files (like CLAUDE.md and skill files) on context consumption.

3. The Data Source: JSONL Session Files
3.1 Where They Live
Claude Code writes a complete transcript of every session to: ~/.claude/projects/<url-encoded-project-path>/sessions/<session-uuid>.jsonl
Each line in the file is a standalone JSON object representing one event in the session. Events are linked together via a parentUuid field to form a conversation tree.

3.2 What’s in Each JSONL Line


3.3 Content Block Types
The message.content array contains typed blocks. These are the ones you need to handle:



3.4 Common Tool Names



4. Core Features to Build
4.1 Feature 1: Reasoning Chain Reconstruction
Goal: Show the user what Claude was thinking and doing at each step, in chronological order.

How it works: Walk through the JSONL lines in order. For each assistant message, extract the content blocks and interleave them into a timeline:
Thinking block → Show as collapsible reasoning trace (these can be long)
Tool call (tool_use) → Show tool name + formatted input
Tool result (tool_result) → Match to its tool_use via tool_use_id, show output
Text block → Show as Claude’s response to the user

The result should read like a narrative: “Claude thought about X, then ran a bash command, got this output, then decided to read file Y, and concluded Z.”



4.2 Feature 2: Tool Call Dashboard
Goal: A structured view of every tool call in the session with filtering and stats.

For each tool call, extract:
Timestamp and position in the conversation
Tool name (Bash, Read, Write, etc.)
Full input (the command or file path or search query)
Full output (truncate long outputs but keep them expandable)
Success/failure status
Duration if available (difference between tool_use and tool_result timestamps)

Aggregate stats to show:
Total tool calls by type (e.g., 14 Bash, 8 Read, 3 Write)
Files most frequently read or modified
Failed tool calls and their error messages
Tool call patterns (e.g., “Grep → Read → Edit” sequences)

4.3 Feature 3: Context Window Tracker
Goal: Visualize how the context window fills up over the course of a session and identify what’s consuming the most space.

4.3.1 Token Usage per Turn
Each assistant message includes a usage object:





4.3.2 What to Visualize
Build a stacked area chart (or stacked bar per turn) with:
X-axis: Turn number (or timestamp)
Y-axis: Token count
Stacked layers: fresh input (blue), cache creation (orange), cache read (green), output (gray)
Horizontal line at max context window size (200K for most models)
Annotation markers for auto-compact events (context drops sharply)

4.4 Feature 4: Skill / Config File Impact Analysis
Goal: Estimate how much context window space is consumed by CLAUDE.md, .claude/ config files, and skill files.

Approach: There’s no explicit “skill file loaded” event in the JSONL. Instead, detect them indirectly:
Scan for Read/Bash tool calls targeting CLAUDE.md, .claude/settings.json, or any path containing “skills”
Measure the token delta — compare the usage object before and after these file reads
Look at early cache_creation spikes — on the first few turns, large cache creation numbers usually correspond to system prompt + config files being ingested
Compare sessions — a session with a large CLAUDE.md vs. one without will have a visibly different baseline token count




5. Recommended Architecture
5.1 Tech Stack


5.2 Module Breakdown




6. Implementation Plan
Phase 1: Parser + Data Model (Week 1)
Define TypeScript interfaces for every message type and content block type
Build the JSONL reader that streams lines and returns typed objects
Build the session-tree module that links messages into a navigable tree
Write tests using a real JSONL session file (just run a quick Claude Code session to generate one)

Phase 2: Analysis Engines (Week 2)
Build reasoning-extractor: walk tree, output ordered timeline
Build tool-analyzer: aggregate stats, detect patterns
Build context-tracker: compute per-turn token data, detect compaction
Build skill-detector: identify config file reads, estimate impact

Phase 3: UI + Visualization (Week 3)
Session browser: list all sessions with project, date, cost, model, token count
Timeline view: interleaved thinking + tool calls + responses
Tool dashboard: filterable table + aggregate stats
Context chart: stacked area chart with compaction markers
Skill impact panel: estimated token cost of config/skill files


7. Existing Tools to Study
Don’t start from scratch. These open-source projects have already solved parts of this problem:




8. Bonus: Real-Time Data via Hooks
Claude Code has a hooks system that fires events before and after tool calls. Instead of only doing post-hoc JSONL analysis, you could set up hooks to stream data to the analyzer in real time.

Relevant hook events: 
PreToolUse — fires before every tool call with tool_name and tool_input
PostToolUse — fires after success with tool output
PostToolUseFailure — fires on tool errors with error details
TaskCompleted — fires when an agent finishes a task

Hooks receive JSON on stdin including session_id and transcript_path. You could have a hook script POST this data to a local web server running your analyzer UI, giving you a live dashboard. This is a stretch goal — get the JSONL parser working first.


9. Key Gotchas




10. Definition of Done
The tool is done when a user can:

Point it at any Claude Code session JSONL file (or select from a session browser)
See a chronological timeline showing Claude’s reasoning, tool calls, and responses
See aggregate tool call statistics with filtering by tool type
See a context window usage chart showing how context grew over the session
See an estimate of how much context was consumed by CLAUDE.md and skill files



