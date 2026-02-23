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
      for (const block of ae.message.content) {
        switch (block.type) {
          case "thinking":
            timeline.push({
              type: "thinking",
              timestamp: ae.timestamp,
              content: block.thinking,
            });
            break;
          case "text":
            timeline.push({
              type: "text",
              timestamp: ae.timestamp,
              content: block.text,
            });
            break;
          case "tool_use":
            timeline.push({
              type: "tool_use",
              timestamp: ae.timestamp,
              content: `${block.name}(${summarizeInput(block.input)})`,
              toolName: block.name,
              toolInput: block.input,
              toolUseId: block.id,
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
            content: truncate(rb.content, 200),
            toolUseId: rb.tool_use_id,
            isError: rb.is_error ?? false,
          });
        }
      }
    }
  }

  return timeline;
}

function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      parts.push(`${key}: ${truncate(value, 60)}`);
    } else {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return parts.join(", ");
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}
