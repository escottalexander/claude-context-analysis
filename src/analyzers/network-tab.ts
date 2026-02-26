import type { SessionTree } from "../parser/session-tree.js";
import type {
  AssistantEvent,
  UserEvent,
  ProgressEvent,
  SystemEvent,
  SessionEvent,
  NetworkAgentScope,
  NetworkRequestEntry,
  NetworkTimelineEvent,
  NetworkEventKind,
} from "../types.js";

interface NetworkTabResult {
  scopes: NetworkAgentScope[];
}

export function analyzeNetworkTab(tree: SessionTree): NetworkTabResult {
  const assistantsByToolUseId = indexAssistantByToolUseId(tree.getAssistantEvents());
  const taskSubagentByToolUseId = indexTaskSubagentByToolUseId(
    tree.getChronologicalEvents()
  );
  const scopes = new Map<string, NetworkAgentScope>();

  const ensureScope = (scopeId: string): NetworkAgentScope => {
    let scope = scopes.get(scopeId);
    if (!scope) {
      scope = { id: scopeId, label: scopeId, requests: [], events: [] };
      scopes.set(scopeId, scope);
    }
    return scope;
  };

  // Build tool_use requests (existing logic)
  for (const pair of tree.getToolPairs()) {
    const assistant = assistantsByToolUseId.get(pair.toolUse.id);
    const scopeId = assistant ? getScopeId(assistant) : "main";
    const scope = ensureScope(scopeId);

    scope.requests.push({
      toolUseId: pair.toolUse.id,
      toolName: pair.toolUse.name,
      scopeId,
      linkedSubagentId:
        pair.toolUse.name === "Task"
          ? (taskSubagentByToolUseId.get(pair.toolUse.id) ?? null)
          : null,
      startTimestamp: pair.assistantTimestamp,
      endTimestamp: pair.resultTimestamp,
      timeMs: computeTimeMs(pair.assistantTimestamp, pair.resultTimestamp),
      ctxSpikeTokens: assistant?.message.usage.cache_creation_input_tokens ?? 0,
      isError: pair.toolResult?.is_error ?? false,
      toolInput: pair.toolUse.input,
      toolResultContent: pair.toolResult
        ? normalizeResultContent(pair.toolResult.content)
        : null,
    });
  }

  // Build a toolUseId → scopeId map from assistant events
  const toolUseScopeMap = new Map<string, string>();
  for (const ae of tree.getAssistantEvents()) {
    const scopeId = getScopeId(ae);
    for (const block of ae.message.content) {
      if (block.type === "tool_use") {
        toolUseScopeMap.set(block.id, scopeId);
      }
    }
  }

  // Build unified event timeline from ALL chronological events
  let eventCounter = 0;
  for (const event of tree.getChronologicalEvents()) {
    const timelineEvents = buildTimelineEvents(event, eventCounter, taskSubagentByToolUseId, toolUseScopeMap);
    for (const te of timelineEvents) {
      ensureScope(te.scopeId).events.push(te);
    }
    eventCounter += timelineEvents.length || 1;
  }

  // Merge tool_result data back into tool_use timeline events
  for (const scope of scopes.values()) {
    mergeToolResults(scope.events, tree);
  }

  return {
    scopes: [...scopes.values()]
      .map((scope) => ({
        ...scope,
        requests: [...scope.requests].sort((a, b) =>
          a.startTimestamp.localeCompare(b.startTimestamp)
        ),
        events: [...scope.events].sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp)
        ),
      }))
      .sort(compareScopeIds),
  };
}

function buildTimelineEvents(
  event: SessionEvent,
  counter: number,
  taskSubagentMap: Map<string, string>,
  toolUseScopeMap: Map<string, string>
): NetworkTimelineEvent[] {
  const results: NetworkTimelineEvent[] = [];

  if (event.type === "assistant") {
    const ae = event as AssistantEvent;
    const scopeId = getScopeId(ae);
    for (const block of ae.message.content) {
      if (block.type === "thinking") {
        const preview = block.thinking.slice(0, 200);
        results.push({
          id: `thinking-${ae.uuid}-${counter++}`,
          kind: "thinking",
          timestamp: ae.timestamp,
          scopeId,
          summary: preview.split("\n")[0]?.slice(0, 80) || "Thinking...",
          content: block.thinking,
          inputTokens: ae.message.usage.input_tokens,
          outputTokens: ae.message.usage.output_tokens,
          cacheCreationTokens: ae.message.usage.cache_creation_input_tokens,
          cacheReadTokens: ae.message.usage.cache_read_input_tokens,
        });
      } else if (block.type === "text") {
        const preview = block.text.slice(0, 200);
        results.push({
          id: `text-${ae.uuid}-${counter++}`,
          kind: "assistant_text",
          timestamp: ae.timestamp,
          scopeId,
          summary: preview.split("\n")[0]?.slice(0, 80) || "Text response",
          content: block.text,
          inputTokens: ae.message.usage.input_tokens,
          outputTokens: ae.message.usage.output_tokens,
          cacheCreationTokens: ae.message.usage.cache_creation_input_tokens,
          cacheReadTokens: ae.message.usage.cache_read_input_tokens,
        });
      } else if (block.type === "tool_use") {
        const linkedSubagentId =
          block.name === "Task"
            ? (taskSubagentMap.get(block.id) ?? null)
            : null;
        results.push({
          id: `tool-${block.id}`,
          kind: "tool_use",
          timestamp: ae.timestamp,
          scopeId,
          summary: block.name,
          content: "",
          toolName: block.name,
          toolUseId: block.id,
          linkedSubagentId,
          ctxSpikeTokens: ae.message.usage.cache_creation_input_tokens,
          isError: false,
          toolInput: block.input,
          toolResultContent: null,
        });
      }
    }
  } else if (event.type === "user") {
    const ue = event as UserEvent;
    const scopeId = ue.isSidechain ? ((ue as any).agentId ?? "unknown") : "main";

    if (typeof ue.message.content === "string") {
      // User text message
      const text = ue.message.content;
      results.push({
        id: `user-${ue.uuid}-${counter}`,
        kind: "user_message",
        timestamp: ue.timestamp,
        scopeId,
        summary: text.split("\n")[0]?.slice(0, 80) || "User message",
        content: text,
      });
    } else if (Array.isArray(ue.message.content)) {
      // Tool results - match them back to existing tool_use events in the scope
      for (const block of ue.message.content) {
        if (block.type === "tool_result") {
          // We don't create a separate event for tool_result; it's merged into tool_use events.
          // But we do need to patch the tool_use event with result data.
          // This is handled below after all events are collected.
        } else if (block.type === "text") {
          results.push({
            id: `user-text-${ue.uuid}-${counter++}`,
            kind: "user_message",
            timestamp: ue.timestamp,
            scopeId,
            summary: (block as any).text?.split("\n")[0]?.slice(0, 80) || "User text",
            content: (block as any).text ?? "",
          });
        }
      }
    }
  } else if (event.type === "progress") {
    const pe = event as ProgressEvent;
    const data = pe.data;

    // Skip agent_progress — covered by the subagent's own session files
    if (data.type === "agent_progress") return results;

    // hook_progress: resolve scope from parent tool use ID
    const parentToolId = pe.parentToolUseID ?? pe.toolUseID;
    const resolvedScope = parentToolId ? toolUseScopeMap.get(parentToolId) : undefined;
    const scopeId = resolvedScope ?? (pe.isSidechain ? "unknown" : "main");
    const hookName = data.hookName ?? data.hookEvent ?? "hook";
    const command = (data as any).command ?? "";
    results.push({
      id: `hook-${pe.uuid}-${counter}`,
      kind: "hook",
      timestamp: pe.timestamp,
      scopeId,
      summary: hookName,
      content: command ? `${hookName}: ${command}` : hookName,
      hookEvent: data.hookEvent,
      hookName: data.hookName,
      progressType: data.type,
    });
  } else if (event.type === "system") {
    const se = event as SystemEvent;
    const scopeId = se.isSidechain ? "unknown" : "main";
    const subtype = se.subtype ?? "system";
    const durationMs = (se as any).durationMs ?? undefined;

    if (subtype === "compact_boundary") {
      const preTokens = se.compactMetadata?.preTokens ?? undefined;
      const trigger = se.compactMetadata?.trigger ?? undefined;
      results.push({
        id: `compaction-${se.uuid}-${counter}`,
        kind: "compaction",
        timestamp: se.timestamp,
        scopeId,
        summary: `Compaction${trigger ? ` (${trigger})` : ""}`,
        content: se.content ?? "Conversation compacted",
        subtype,
        compactTrigger: trigger,
        preTokens,
      });
    } else {
      results.push({
        id: `system-${se.uuid}-${counter}`,
        kind: "system",
        timestamp: se.timestamp,
        scopeId,
        summary: subtype,
        content: se.content ?? (durationMs ? `Turn duration: ${durationMs}ms` : subtype),
        subtype,
        durationMs,
      });
    }
  }

  return results;
}

/**
 * Post-process: merge tool_result data back into tool_use timeline events.
 * Called after all events have been collected.
 */
function mergeToolResults(
  events: NetworkTimelineEvent[],
  tree: SessionTree
): void {
  const toolUseMap = new Map<string, NetworkTimelineEvent>();
  for (const evt of events) {
    if (evt.kind === "tool_use" && evt.toolUseId) {
      toolUseMap.set(evt.toolUseId, evt);
    }
  }
  for (const pair of tree.getToolPairs()) {
    const te = toolUseMap.get(pair.toolUse.id);
    if (te && pair.toolResult) {
      te.isError = pair.toolResult.is_error ?? false;
      te.toolResultContent = normalizeResultContent(pair.toolResult.content);
      te.timeMs = computeTimeMs(pair.assistantTimestamp, pair.resultTimestamp);
    }
  }
}

function indexAssistantByToolUseId(
  assistantEvents: AssistantEvent[]
): Map<string, AssistantEvent> {
  const map = new Map<string, AssistantEvent>();
  for (const event of assistantEvents) {
    for (const block of event.message.content) {
      if (block.type === "tool_use") {
        map.set(block.id, event);
      }
    }
  }
  return map;
}

function indexTaskSubagentByToolUseId(
  events: ReturnType<SessionTree["getChronologicalEvents"]>
): Map<string, string> {
  const map = new Map<string, string>();

  for (const event of events) {
    if (event.type === "progress") {
      const toolUseId = event.parentToolUseID ?? event.toolUseID;
      const data = event.data as Record<string, unknown>;
      const agentId = data.agentId;
      if (
        toolUseId &&
        typeof toolUseId === "string" &&
        typeof agentId === "string" &&
        !map.has(toolUseId)
      ) {
        map.set(toolUseId, agentId);
      }
      continue;
    }

    if (event.type === "user") {
      if (!Array.isArray(event.message.content)) continue;
      const toolUseResult = event.toolUseResult as Record<string, unknown> | undefined;
      const agentId = toolUseResult?.agentId;
      if (typeof agentId !== "string") continue;
      for (const block of event.message.content) {
        if (
          block.type === "tool_result" &&
          typeof block.tool_use_id === "string" &&
          !map.has(block.tool_use_id)
        ) {
          map.set(block.tool_use_id, agentId);
        }
      }
    }
  }

  return map;
}

function getScopeId(event: AssistantEvent): string {
  return event.isSidechain ? (event.agentId ?? "unknown") : "main";
}

function computeTimeMs(start: string, end: string | null): number | null {
  if (!end) return null;
  const time = new Date(end).getTime() - new Date(start).getTime();
  return time >= 0 ? time : null;
}

function normalizeResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    return content.map((item) => normalizeResultContent(item)).join(" ");
  }
  if (typeof content === "object") {
    if (
      "text" in content &&
      typeof (content as { text?: unknown }).text === "string"
    ) {
      return (content as { text: string }).text;
    }
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

function compareScopeIds(a: NetworkAgentScope, b: NetworkAgentScope): number {
  if (a.id === "main" && b.id !== "main") return -1;
  if (b.id === "main" && a.id !== "main") return 1;
  return a.id.localeCompare(b.id);
}
