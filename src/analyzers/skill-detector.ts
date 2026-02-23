import type { SessionTree } from "../parser/session-tree.js";
import type { SkillFileImpact, ToolPair } from "../types.js";

const SKILL_PATTERNS = [
  { pattern: /CLAUDE\.md/i, type: "claude-md" as const },
  { pattern: /SKILL\.md/i, type: "skill" as const },
  { pattern: /\.claude\//i, type: "config" as const },
  { pattern: /skills\//i, type: "skill" as const },
  { pattern: /AGENTS\.md/i, type: "config" as const },
];

export interface SkillDetectorResult {
  skillImpacts: SkillFileImpact[];
}

export function analyzeSkills(tree: SessionTree): SkillDetectorResult {
  const pairs = tree.getToolPairs();
  const assistantEvents = tree.getAssistantEvents();
  const skillImpacts: SkillFileImpact[] = [];
  const seenPaths = new Set<string>();

  // Build a map of requestId → cache_creation_input_tokens for spike detection
  const cacheSpikes = new Map<string, number>();
  for (const event of assistantEvents) {
    const reqId = event.requestId ?? event.uuid;
    const tokens = event.message.usage.cache_creation_input_tokens;
    const existing = cacheSpikes.get(reqId) ?? 0;
    if (tokens > existing) cacheSpikes.set(reqId, tokens);
  }

  for (const pair of pairs) {
    const filePath = extractFilePath(pair);
    if (!filePath) continue;

    const matchedType = matchSkillPattern(filePath);
    if (!matchedType) continue;
    if (seenPaths.has(filePath)) continue;
    seenPaths.add(filePath);

    // Estimate token cost from the tool result content length
    // Rough heuristic: ~4 chars per token
    const resultContent = pair.toolResult?.content ?? "";
    const estimatedTokens = Math.round(resultContent.length / 4);

    // Find cache creation spike near this tool call
    const nearbySpike = findNearbySpike(pair, assistantEvents, cacheSpikes);

    skillImpacts.push({
      filePath,
      type: matchedType,
      estimatedTokens,
      cacheCreationSpike: nearbySpike,
    });
  }

  return { skillImpacts };
}

function extractFilePath(pair: ToolPair): string | null {
  const input = pair.toolUse.input;
  const fp = (input.file_path as string) ?? (input.path as string) ?? null;
  if (fp) return fp;

  // Check for pattern/glob in Grep/Glob calls
  const pattern = input.pattern as string | undefined;
  if (pattern) {
    for (const { pattern: rx } of SKILL_PATTERNS) {
      if (rx.test(pattern)) return pattern;
    }
  }

  // Check tool result content for skill file paths
  if (pair.toolResult?.content) {
    for (const { pattern: rx } of SKILL_PATTERNS) {
      if (rx.test(pair.toolResult.content)) {
        // Extract first matching path
        const match = pair.toolResult.content.match(
          /\S*(?:CLAUDE\.md|SKILL\.md|\.claude\/|skills\/|AGENTS\.md)\S*/i
        );
        if (match) return match[0];
      }
    }
  }

  return null;
}

function matchSkillPattern(
  filePath: string
): "claude-md" | "skill" | "config" | null {
  for (const { pattern, type } of SKILL_PATTERNS) {
    if (pattern.test(filePath)) return type;
  }
  return null;
}

function findNearbySpike(
  pair: ToolPair,
  assistantEvents: { timestamp: string; requestId?: string; uuid: string }[],
  cacheSpikes: Map<string, number>
): number {
  const pairTime = new Date(pair.assistantTimestamp).getTime();
  let maxSpike = 0;

  for (const event of assistantEvents) {
    const eventTime = new Date(event.timestamp).getTime();
    // Look within a 5-second window around the tool call
    if (Math.abs(eventTime - pairTime) <= 5000) {
      const reqId = event.requestId ?? event.uuid;
      const spike = cacheSpikes.get(reqId) ?? 0;
      if (spike > maxSpike) maxSpike = spike;
    }
  }

  return maxSpike;
}
