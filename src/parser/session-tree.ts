import type {
  SessionEvent,
  AssistantEvent,
  UserEvent,
  ToolUseBlock,
  ToolResultBlock,
  ToolPair,
} from "../types.js";

type EventWithUuid = SessionEvent & { uuid: string; parentUuid: string | null };

function hasUuid(event: SessionEvent): event is EventWithUuid {
  return "uuid" in event && typeof (event as any).uuid === "string";
}

export class SessionTree {
  private events: SessionEvent[];
  private byUuid = new Map<string, SessionEvent>();
  private children = new Map<string, string[]>();
  private roots: string[] = [];

  constructor(events: SessionEvent[]) {
    this.events = events;
    for (const event of events) {
      if (!hasUuid(event)) continue;
      this.byUuid.set(event.uuid, event);
      if (event.parentUuid === null) {
        this.roots.push(event.uuid);
      } else {
        const siblings = this.children.get(event.parentUuid) ?? [];
        siblings.push(event.uuid);
        this.children.set(event.parentUuid, siblings);
      }
    }
  }

  getRoots(): SessionEvent[] {
    return this.roots.map((id) => this.byUuid.get(id)!);
  }

  getChildren(uuid: string): SessionEvent[] {
    return (this.children.get(uuid) ?? []).map((id) => this.byUuid.get(id)!);
  }

  getChronologicalEvents(): SessionEvent[] {
    return [...this.events]
      .filter((e) => "timestamp" in e && e.timestamp)
      .sort((a, b) => {
        const ta = "timestamp" in a ? a.timestamp : "";
        const tb = "timestamp" in b ? b.timestamp : "";
        return ta.localeCompare(tb);
      });
  }

  getToolPairs(): ToolPair[] {
    const pairs: ToolPair[] = [];
    const pendingToolUses = new Map<
      string,
      { block: ToolUseBlock; timestamp: string; uuid: string }
    >();

    for (const event of this.getChronologicalEvents()) {
      if (event.type === "assistant") {
        const assistantEvent = event as AssistantEvent;
        for (const block of assistantEvent.message.content) {
          if (block.type === "tool_use") {
            pendingToolUses.set(block.id, {
              block,
              timestamp: assistantEvent.timestamp,
              uuid: assistantEvent.uuid,
            });
          }
        }
      } else if (event.type === "user") {
        const userEvent = event as UserEvent;
        if (!Array.isArray(userEvent.message.content)) continue;
        for (const block of userEvent.message.content) {
          if (block.type === "tool_result") {
            const resultBlock = block as ToolResultBlock;
            const pending = pendingToolUses.get(resultBlock.tool_use_id);
            if (pending) {
              pairs.push({
                toolUse: pending.block,
                toolResult: resultBlock,
                assistantTimestamp: pending.timestamp,
                resultTimestamp: userEvent.timestamp,
                assistantUuid: pending.uuid,
                resultUuid: userEvent.uuid,
              });
              pendingToolUses.delete(resultBlock.tool_use_id);
            }
          }
        }
      }
    }

    // Add any unmatched tool_use calls (no result received)
    for (const [, pending] of pendingToolUses) {
      pairs.push({
        toolUse: pending.block,
        toolResult: null,
        assistantTimestamp: pending.timestamp,
        resultTimestamp: null,
        assistantUuid: pending.uuid,
        resultUuid: null,
      });
    }

    return pairs;
  }

  getAssistantEvents(): AssistantEvent[] {
    return this.events.filter(
      (e): e is AssistantEvent => e.type === "assistant"
    );
  }

  getUserEvents(): UserEvent[] {
    return this.events.filter((e): e is UserEvent => e.type === "user");
  }

  getSessionId(): string | null {
    for (const event of this.events) {
      if ("sessionId" in event && event.sessionId) {
        return event.sessionId as string;
      }
    }
    return null;
  }
}
