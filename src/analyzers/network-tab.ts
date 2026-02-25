import type { SessionTree } from "../parser/session-tree.js";
import type { AssistantEvent, NetworkAgentScope, NetworkRequestEntry } from "../types.js";

interface NetworkTabResult {
  scopes: NetworkAgentScope[];
}

export function analyzeNetworkTab(tree: SessionTree): NetworkTabResult {
  const assistantsByToolUseId = indexAssistantByToolUseId(tree.getAssistantEvents());
  const scopes = new Map<string, NetworkAgentScope>();

  for (const pair of tree.getToolPairs()) {
    const assistant = assistantsByToolUseId.get(pair.toolUse.id);
    const scopeId = assistant ? getScopeId(assistant) : "main";
    const scope = scopes.get(scopeId) ?? {
      id: scopeId,
      label: scopeId,
      requests: [],
    };

    scope.requests.push({
      toolUseId: pair.toolUse.id,
      toolName: pair.toolUse.name,
      scopeId,
      startTimestamp: pair.assistantTimestamp,
      endTimestamp: pair.resultTimestamp,
      latencyMs: computeLatencyMs(pair.assistantTimestamp, pair.resultTimestamp),
      ctxSpikeTokens: assistant?.message.usage.cache_creation_input_tokens ?? 0,
      isError: pair.toolResult?.is_error ?? false,
      toolInput: pair.toolUse.input,
      toolResultContent: pair.toolResult
        ? normalizeResultContent(pair.toolResult.content)
        : null,
    });

    scopes.set(scopeId, scope);
  }

  return {
    scopes: [...scopes.values()]
      .map((scope) => ({
        ...scope,
        requests: [...scope.requests].sort((a, b) =>
          a.startTimestamp.localeCompare(b.startTimestamp)
        ),
      }))
      .sort(compareScopeIds),
  };
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

function getScopeId(event: AssistantEvent): string {
  return event.isSidechain ? (event.agentId ?? "unknown") : "main";
}

function computeLatencyMs(start: string, end: string | null): number | null {
  if (!end) return null;
  const latency = new Date(end).getTime() - new Date(start).getTime();
  return latency >= 0 ? latency : null;
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
