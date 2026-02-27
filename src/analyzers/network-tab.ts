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
import { toDisplayText, getScopeId } from "./utils.js";

interface NetworkTabResult {
  scopes: NetworkAgentScope[];
}

export function analyzeNetworkTab(tree: SessionTree): NetworkTabResult {
  const assistantsByToolUseId = indexAssistantByToolUseId(tree.getAssistantEvents());
  const allEvents = tree.getChronologicalEvents();
  const taskSubagentByToolUseId = indexTaskSubagentByToolUseId(allEvents);
  const uuidToAgentId = indexAgentIdByUuid(allEvents);
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
        ? toDisplayText(pair.toolResult.content)
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
    const timelineEvents = buildTimelineEvents(event, eventCounter, taskSubagentByToolUseId, toolUseScopeMap, uuidToAgentId);
    for (const te of timelineEvents) {
      ensureScope(te.scopeId).events.push(te);
    }
    eventCounter += timelineEvents.length || 1;
  }

  // Merge tool_result data back into tool_use timeline events,
  // and deduplicate hook pairs (command + callback).
  for (const scope of scopes.values()) {
    mergeToolResults(scope.events, tree);
    deduplicateHooks(scope.events);
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
  toolUseScopeMap: Map<string, string>,
  uuidToAgentId: Map<string, string>
): NetworkTimelineEvent[] {
  const results: NetworkTimelineEvent[] = [];

  if (event.type === "assistant") {
    const ae = event as AssistantEvent;
    const scopeId = getScopeId(ae);
    const reqId = ae.requestId ?? ae.uuid;
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
          requestId: reqId,
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
          requestId: reqId,
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
          requestId: reqId,
        });
      }
    }
  } else if (event.type === "user") {
    const ue = event as UserEvent;
    const scopeId = getScopeId(ue as any);

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
          // tool_result data is merged into the matching tool_use event
          // via mergeToolResults() after all events are collected.
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

    // Skip agent_progress (covered by the subagent's own session files)
    // and bash_progress (streaming output; the tool_use/tool_result pair covers it)
    if (data.type === "agent_progress" || data.type === "bash_progress") return results;

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
      // Resolve compaction subagent via logicalParentUuid → agentId
      const logicalParent = se.logicalParentUuid;
      const linkedSubagentId = logicalParent
        ? (uuidToAgentId.get(logicalParent) ?? null)
        : null;
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
        linkedSubagentId,
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
  // Build a tool_use_id → toolUseResult map from user events
  const toolUseResultMap = new Map<string, Record<string, unknown>>();
  for (const ue of tree.getUserEvents()) {
    if (!Array.isArray(ue.message.content)) continue;
    const meta = ue.toolUseResult as Record<string, unknown> | undefined;
    if (!meta) continue;
    for (const block of ue.message.content) {
      if (block.type === "tool_result") {
        toolUseResultMap.set((block as any).tool_use_id, meta);
      }
    }
  }

  for (const pair of tree.getToolPairs()) {
    const te = toolUseMap.get(pair.toolUse.id);
    if (te && pair.toolResult) {
      te.isError = pair.toolResult.is_error ?? false;
      te.toolResultContent = toDisplayText(pair.toolResult.content);
      te.timeMs = computeTimeMs(pair.assistantTimestamp, pair.resultTimestamp);
      te.toolUseResult = toolUseResultMap.get(pair.toolUse.id) ?? undefined;
    }
  }
}

/**
 * Deduplicate hook pairs that share the same toolUseID and hookName.
 * Hooks often come as a command event followed by a "callback" event.
 * We keep the one with the real command and drop the callback duplicate.
 * Mutates the array in place.
 */
function deduplicateHooks(events: NetworkTimelineEvent[]): void {
  // Group hooks by their toolUseId + hookName key
  const hookGroups = new Map<string, number[]>();
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (evt.kind !== "hook" || !evt.hookName) continue;
    // Use the toolUseId embedded in the event id (hook-<uuid>-<counter>)
    // but actually we need the parentToolUseID — extract from content or id
    // The hookName + timestamp combo groups them since they fire at the same time
    const key = `${evt.hookName}:${evt.timestamp}`;
    const group = hookGroups.get(key);
    if (group) {
      group.push(i);
    } else {
      hookGroups.set(key, [i]);
    }
  }

  const toRemove = new Set<number>();
  for (const indices of hookGroups.values()) {
    if (indices.length <= 1) continue;
    // Find the one with the real command (not "callback")
    let keepIdx = indices[0];
    for (const idx of indices) {
      const content = events[idx].content ?? "";
      if (!content.endsWith(": callback") && content !== "callback") {
        keepIdx = idx;
      }
    }
    // Mark all others for removal
    for (const idx of indices) {
      if (idx !== keepIdx) toRemove.add(idx);
    }
  }

  // Remove in reverse order to preserve indices
  const sortedRemove = [...toRemove].sort((a, b) => b - a);
  for (const idx of sortedRemove) {
    events.splice(idx, 1);
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

/**
 * Build a map from event uuid → agentId for all sidechain events.
 * Used to resolve logicalParentUuid on compact_boundary events
 * back to the compaction subagent that produced them.
 */
function indexAgentIdByUuid(
  events: ReturnType<SessionTree["getChronologicalEvents"]>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const event of events) {
    if (!("isSidechain" in event) || !(event as any).isSidechain) continue;
    const agentId = (event as any).agentId;
    if (typeof agentId === "string") {
      if ("uuid" in event) map.set((event as any).uuid, agentId);
      // Also index by parentUuid so compact_boundary events can resolve
      // via logicalParentUuid (which points to the parent, not the subagent's uuid)
      const parentUuid = (event as any).parentUuid;
      if (typeof parentUuid === "string" && !map.has(parentUuid)) {
        map.set(parentUuid, agentId);
      }
    }
  }
  return map;
}

function computeTimeMs(start: string, end: string | null): number | null {
  if (!end) return null;
  const time = new Date(end).getTime() - new Date(start).getTime();
  return time >= 0 ? time : null;
}

function compareScopeIds(a: NetworkAgentScope, b: NetworkAgentScope): number {
  if (a.id === "main" && b.id !== "main") return -1;
  if (b.id === "main" && a.id !== "main") return 1;
  return a.id.localeCompare(b.id);
}
