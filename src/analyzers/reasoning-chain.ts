import type { SessionTree } from "../parser/session-tree.js";
import type {
  AssistantEvent,
  UserEvent,
  TimelineEntry,
  ToolResultBlock,
} from "../types.js";

export function analyzeReasoningChain(tree: SessionTree): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];
  const events = tree.getChronologicalEvents();

  for (const event of events) {
    if (event.type === "assistant") {
      const ae = event as AssistantEvent;
      const ctxSpikeTokens = ae.message.usage.cache_creation_input_tokens ?? 0;
      const assistantTurnId = ae.requestId ?? ae.uuid;
      for (const block of ae.message.content) {
        switch (block.type) {
          case "thinking":
            timeline.push({
              type: "thinking",
              timestamp: ae.timestamp,
              content: toDisplayText(block.thinking),
              ctxSpikeTokens,
              assistantTurnId,
            });
            break;
          case "text":
            timeline.push({
              type: "text",
              timestamp: ae.timestamp,
              content: toDisplayText(block.text),
              ctxSpikeTokens,
              assistantTurnId,
            });
            break;
          case "tool_use":
            timeline.push({
              type: "tool_use",
              timestamp: ae.timestamp,
              content: `${block.name}(${summarizeToolInput(block.name, block.input, ae.cwd)})`,
              toolName: block.name,
              toolInput: block.input,
              toolUseId: block.id,
              ctxSpikeTokens,
              assistantTurnId,
            });
            break;
        }
      }
    } else if (event.type === "user") {
      const ue = event as UserEvent;
      if (!Array.isArray(ue.message.content)) continue;
      for (const block of ue.message.content) {
        if (block.type === "tool_result") {
          const rb = block as ToolResultBlock;
          timeline.push({
            type: "tool_result",
            timestamp: ue.timestamp,
            content: truncate(toDisplayText(rb.content), 200),
            toolUseId: rb.tool_use_id,
            isError: rb.is_error ?? false,
          });
        }
      }
    }
  }

  return timeline;
}

function summarizeToolInput(
  toolName: string,
  input: Record<string, unknown>,
  cwd?: string
): string {
  if (toolName === "Skill") {
    const skillName = extractSkillName(input, cwd);
    if (skillName) return `skill: ${skillName}`;
  }

  if (toolName === "Read" || toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    const filePath = getFilePath(input, cwd);
    if (filePath) return `file: ${truncate(filePath, 120)}`;
  }

  return summarizeInput(input, cwd);
}

function summarizeInput(input: Record<string, unknown>, cwd?: string): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      parts.push(`${key}: ${truncate(normalizePathForDisplay(value, cwd), 60)}`);
    } else {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return parts.join(", ");
}

function extractSkillName(input: Record<string, unknown>, cwd?: string): string | null {
  const candidates = ["skill", "skill_name", "name", "skill_path", "path"];

  for (const key of candidates) {
    const value = input[key];
    if (typeof value !== "string" || value.length === 0) continue;

    const normalized = normalizePathForDisplay(value, cwd);

    if (normalized.endsWith("/SKILL.md")) {
      const segments = normalized.split("/").filter(Boolean);
      if (segments.length >= 2) return segments[segments.length - 2];
    }

    if (!normalized.includes("/")) return normalized;
  }

  return null;
}

function getFilePath(input: Record<string, unknown>, cwd?: string): string | null {
  const filePath = input.file_path ?? input.path;
  if (typeof filePath !== "string" || filePath.length === 0) return null;
  return normalizePathForDisplay(filePath, cwd);
}

function toDisplayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => toDisplayText(entry)).join(" ");
  }
  if (typeof value === "object") {
    if (
      "text" in value &&
      typeof (value as { text?: unknown }).text === "string"
    ) {
      return (value as { text: string }).text;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

function normalizePathForDisplay(value: string, cwd?: string): string {
  if (!cwd) return value;
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  if (value.startsWith(prefix)) {
    return value.slice(prefix.length);
  }
  return value;
}
