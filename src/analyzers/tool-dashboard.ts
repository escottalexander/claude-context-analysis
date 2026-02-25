import type { SessionTree } from "../parser/session-tree.js";
import type {
  AssistantEvent,
  ToolStats,
  FileAccess,
  ToolPattern,
  ToolPair,
} from "../types.js";

export interface ToolDashboardResult {
  toolStats: ToolStats[];
  fileAccess: FileAccess[];
  toolPatterns: ToolPattern[];
}

export function analyzeToolDashboard(tree: SessionTree): ToolDashboardResult {
  const pairs = tree.getToolPairs();
  const assistantEvents = tree.getAssistantEvents();
  const tokenAttributionByTool = computeTokenAttributionByTool(
    assistantEvents,
    pairs
  );
  return {
    toolStats: computeToolStats(pairs, tokenAttributionByTool),
    fileAccess: computeFileAccess(pairs),
    toolPatterns: detectPatterns(pairs),
  };
}

interface ToolTokenAttribution {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
}

function computeToolStats(
  pairs: ToolPair[],
  tokenAttributionByTool: Map<string, ToolTokenAttribution>
): ToolStats[] {
  const stats = new Map<
    string,
    { count: number; successes: number; failures: number; durations: number[] }
  >();

  for (const pair of pairs) {
    const name = pair.toolUse.name;
    const entry = stats.get(name) ?? {
      count: 0,
      successes: 0,
      failures: 0,
      durations: [],
    };
    entry.count++;

    if (pair.toolResult) {
      if (pair.toolResult.is_error) {
        entry.failures++;
      } else {
        entry.successes++;
      }
    }

    if (pair.assistantTimestamp && pair.resultTimestamp) {
      const durationMs =
        new Date(pair.resultTimestamp).getTime() -
        new Date(pair.assistantTimestamp).getTime();
      if (durationMs >= 0) {
        entry.durations.push(durationMs);
      }
    }

    stats.set(name, entry);
  }

  return [...stats.entries()]
    .map(([name, s]) => ({
      name,
      count: s.count,
      successes: s.successes,
      failures: s.failures,
      avgDurationMs:
        s.durations.length > 0
          ? Math.round(
              s.durations.reduce((a, b) => a + b, 0) / s.durations.length
            )
          : null,
      attributedInputTokens:
        Math.round((tokenAttributionByTool.get(name)?.input ?? 0) * 10) / 10,
      attributedCacheCreationTokens:
        Math.round((tokenAttributionByTool.get(name)?.cacheCreation ?? 0) * 10) /
        10,
      attributedCacheReadTokens:
        Math.round((tokenAttributionByTool.get(name)?.cacheRead ?? 0) * 10) / 10,
      attributedOutputTokens:
        Math.round((tokenAttributionByTool.get(name)?.output ?? 0) * 10) / 10,
      attributedTotalTokens:
        Math.round(
          ((tokenAttributionByTool.get(name)?.input ?? 0) +
            (tokenAttributionByTool.get(name)?.cacheCreation ?? 0) +
            (tokenAttributionByTool.get(name)?.cacheRead ?? 0) +
            (tokenAttributionByTool.get(name)?.output ?? 0)) *
            10
        ) / 10,
    }))
    .sort((a, b) => b.count - a.count);
}

function computeTokenAttributionByTool(
  assistantEvents: AssistantEvent[],
  pairs: ToolPair[]
): Map<string, ToolTokenAttribution> {
  const toolNameById = new Map<string, string>();
  for (const pair of pairs) {
    toolNameById.set(pair.toolUse.id, pair.toolUse.name);
  }

  const turns = new Map<
    string,
    {
      toolUseIds: Set<string>;
      input: number;
      cacheCreation: number;
      cacheRead: number;
      output: number;
    }
  >();

  for (const event of assistantEvents) {
    const scopeKey = event.isSidechain
      ? `sidechain:${event.agentId ?? "unknown"}`
      : "main";
    const turnKey = event.requestId ?? event.message.id ?? event.uuid;
    const key = `${scopeKey}:${turnKey}`;
    const existing = turns.get(key) ?? {
      toolUseIds: new Set<string>(),
      input: 0,
      cacheCreation: 0,
      cacheRead: 0,
      output: 0,
    };

    const usage = event.message.usage;
    existing.input = Math.max(existing.input, usage.input_tokens ?? 0);
    existing.cacheCreation = Math.max(
      existing.cacheCreation,
      usage.cache_creation_input_tokens ?? 0
    );
    existing.cacheRead = Math.max(
      existing.cacheRead,
      usage.cache_read_input_tokens ?? 0
    );
    existing.output = Math.max(existing.output, usage.output_tokens ?? 0);

    for (const block of event.message.content) {
      if (block.type === "tool_use") {
        existing.toolUseIds.add(block.id);
      }
    }

    turns.set(key, existing);
  }

  const byTool = new Map<string, ToolTokenAttribution>();
  for (const turn of turns.values()) {
    const toolNames = [...turn.toolUseIds]
      .map((id) => toolNameById.get(id))
      .filter((name): name is string => Boolean(name));
    if (toolNames.length === 0) continue;

    const share = 1 / toolNames.length;
    for (const toolName of toolNames) {
      const existing = byTool.get(toolName) ?? {
        input: 0,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      };
      existing.input += turn.input * share;
      existing.cacheCreation += turn.cacheCreation * share;
      existing.cacheRead += turn.cacheRead * share;
      existing.output += turn.output * share;
      byTool.set(toolName, existing);
    }
  }

  return byTool;
}

function computeFileAccess(pairs: ToolPair[]): FileAccess[] {
  const files = new Map<string, { reads: number; writes: number; edits: number }>();

  for (const pair of pairs) {
    const input = pair.toolUse.input;
    const name = pair.toolUse.name;
    const filePath =
      (input.file_path as string) ??
      (input.path as string) ??
      null;

    if (!filePath) continue;

    const entry = files.get(filePath) ?? { reads: 0, writes: 0, edits: 0 };
    if (name === "Read") entry.reads++;
    else if (name === "Write") entry.writes++;
    else if (name === "Edit" || name === "MultiEdit") entry.edits++;
    files.set(filePath, entry);
  }

  return [...files.entries()]
    .map(([path, counts]) => ({ path, ...counts }))
    .sort(
      (a, b) =>
        b.reads + b.writes + b.edits - (a.reads + a.writes + a.edits)
    );
}

function detectPatterns(
  pairs: ToolPair[],
  windowSize = 3,
  minCount = 2
): ToolPattern[] {
  const toolNames = pairs.map((p) => p.toolUse.name);
  const patternCounts = new Map<string, number>();

  for (let i = 0; i <= toolNames.length - windowSize; i++) {
    const seq = toolNames.slice(i, i + windowSize);
    const key = seq.join(" → ");
    patternCounts.set(key, (patternCounts.get(key) ?? 0) + 1);
  }

  return [...patternCounts.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([key, count]) => ({
      sequence: key.split(" → "),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}
