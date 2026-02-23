import { writeFile } from "node:fs/promises";
import type { AnalysisResult } from "../types.js";
import type { SessionTree } from "../parser/session-tree.js";
import { analyzeReasoningChain } from "../analyzers/reasoning-chain.js";
import { analyzeToolDashboard } from "../analyzers/tool-dashboard.js";
import { analyzeContext } from "../analyzers/context-tracker.js";
import { analyzeSkills } from "../analyzers/skill-detector.js";

export function buildAnalysisResult(tree: SessionTree): AnalysisResult {
  const timeline = analyzeReasoningChain(tree);
  const { toolStats, fileAccess, toolPatterns } = analyzeToolDashboard(tree);
  const { tokenTurns, compactionEvents } = analyzeContext(tree);
  const { skillImpacts } = analyzeSkills(tree);

  const events = tree.getChronologicalEvents();
  const timestamps = events
    .filter((e) => "timestamp" in e && e.timestamp)
    .map((e) => (e as { timestamp: string }).timestamp);

  return {
    sessionId: tree.getSessionId() ?? "unknown",
    sessionStart: timestamps[0] ?? "",
    sessionEnd: timestamps[timestamps.length - 1] ?? "",
    totalEvents: events.length,
    timeline,
    toolStats,
    fileAccess,
    toolPatterns,
    tokenTurns,
    compactionEvents,
    skillImpacts,
  };
}

export async function writeJsonSummary(
  result: AnalysisResult,
  outputPath: string
): Promise<void> {
  await writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
}
