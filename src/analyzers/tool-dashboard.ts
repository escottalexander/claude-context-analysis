import type { SessionTree } from "../parser/session-tree.js";
import type {
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
  return {
    toolStats: computeToolStats(pairs),
    fileAccess: computeFileAccess(pairs),
    toolPatterns: detectPatterns(pairs),
  };
}

function computeToolStats(pairs: ToolPair[]): ToolStats[] {
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
    }))
    .sort((a, b) => b.count - a.count);
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
