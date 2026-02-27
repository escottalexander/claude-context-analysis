import type { SessionTree } from "../parser/session-tree.js";
import type { SystemEvent, TokenTurn, CompactionEvent } from "../types.js";

export interface ContextTrackerResult {
  tokenTurns: TokenTurn[];
  compactionEvents: CompactionEvent[];
  peakTokens: number;
  totalOutputTokens: number;
}

export function analyzeContext(tree: SessionTree): ContextTrackerResult {
  const assistantEvents = tree.getAssistantEvents();
  const tokenTurns: TokenTurn[] = [];
  const compactionEvents: CompactionEvent[] = [];
  let peakTokens = 0;
  let totalOutputTokens = 0;

  // Collect compaction timestamps so we can insert reset turns
  const compactionTimestamps: { timestamp: string; scopeId: string }[] = [];
  for (const event of tree.getChronologicalEvents()) {
    if (event.type === "system") {
      const se = event as SystemEvent;
      if (se.subtype === "compact_boundary") {
        const scopeId = se.isSidechain ? "unknown" : "main";
        compactionTimestamps.push({ timestamp: se.timestamp, scopeId });
      }
    }
  }

  // Deduplicate by requestId — multiple assistant events can share
  // the same requestId (streaming chunks). Keep the last event per requestId
  // (cumulative usage) but use the earliest timestamp so the token turn is
  // visible to all events in that request group via timestamp lookup.
  const seen = new Map<string, number>();
  const earliestTimestamp = new Map<string, string>();
  const deduped: typeof assistantEvents = [];

  for (const event of assistantEvents) {
    const reqId = event.requestId ?? event.uuid;
    if (seen.has(reqId)) {
      // Replace with later event (has more complete usage)
      deduped[seen.get(reqId)!] = event;
    } else {
      seen.set(reqId, deduped.length);
      earliestTimestamp.set(reqId, event.timestamp);
      deduped.push(event);
    }
  }

  for (let i = 0; i < deduped.length; i++) {
    const event = deduped[i];
    const reqId = event.requestId ?? event.uuid;
    const usage = event.message.usage;

    const inputTokens = usage.input_tokens;
    const cacheCreationTokens = usage.cache_creation_input_tokens;
    const cacheReadTokens = usage.cache_read_input_tokens;
    const outputTokens = usage.output_tokens;
    const totalTokens = inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens;

    totalOutputTokens += outputTokens;
    if (totalTokens > peakTokens) peakTokens = totalTokens;

    const scopeId = event.isSidechain ? (event.agentId ?? "unknown") : "main";
    const turn: TokenTurn = {
      turnIndex: i,
      timestamp: earliestTimestamp.get(reqId) ?? event.timestamp,
      scopeId,
      inputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      outputTokens,
      totalTokens,
    };
    tokenTurns.push(turn);
  }

  // Insert synthetic reset turns at compaction boundaries.
  // These ensure the running total column drops immediately after compaction
  // rather than holding the stale pre-compaction value until the next API call.
  for (const compact of compactionTimestamps) {
    tokenTurns.push({
      turnIndex: -1,
      timestamp: compact.timestamp,
      scopeId: compact.scopeId,
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  }

  // Re-sort so synthetic entries interleave correctly
  tokenTurns.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return { tokenTurns, compactionEvents, peakTokens, totalOutputTokens };
}
