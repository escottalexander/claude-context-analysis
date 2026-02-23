import type { SessionTree } from "../parser/session-tree.js";
import type { TokenTurn, CompactionEvent } from "../types.js";

const CONTEXT_LIMIT = 200_000;

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

  // Deduplicate by requestId — multiple assistant events can share
  // the same requestId (streaming chunks). Take the last one per requestId
  // as it has the cumulative usage.
  const seen = new Map<string, number>();
  const deduped: typeof assistantEvents = [];

  for (const event of assistantEvents) {
    const reqId = event.requestId ?? event.uuid;
    if (seen.has(reqId)) {
      // Replace with later event (has more complete usage)
      deduped[seen.get(reqId)!] = event;
    } else {
      seen.set(reqId, deduped.length);
      deduped.push(event);
    }
  }

  for (let i = 0; i < deduped.length; i++) {
    const event = deduped[i];
    const usage = event.message.usage;

    const inputTokens = usage.input_tokens;
    const cacheCreationTokens = usage.cache_creation_input_tokens;
    const cacheReadTokens = usage.cache_read_input_tokens;
    const outputTokens = usage.output_tokens;
    const totalTokens = inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens;

    totalOutputTokens += outputTokens;
    if (totalTokens > peakTokens) peakTokens = totalTokens;

    const turn: TokenTurn = {
      turnIndex: i,
      timestamp: event.timestamp,
      inputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      outputTokens,
      totalTokens,
      percentOfLimit: Math.round((totalTokens / CONTEXT_LIMIT) * 1000) / 10,
    };
    tokenTurns.push(turn);

    // Detect compaction: sudden drop in input tokens compared to previous turn
    if (i > 0) {
      const prevTotal = tokenTurns[i - 1].totalTokens;
      if (prevTotal > 0 && totalTokens < prevTotal * 0.7) {
        compactionEvents.push({
          afterTurnIndex: i,
          tokensBefore: prevTotal,
          tokensAfter: totalTokens,
          tokensFreed: prevTotal - totalTokens,
        });
      }
    }
  }

  return { tokenTurns, compactionEvents, peakTokens, totalOutputTokens };
}
