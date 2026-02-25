import type { NetworkAgentScope } from "../types.js";
import type { NetworkState } from "./network-state.js";

export interface NetworkRenderModel {
  scopes: NetworkAgentScope[];
  state: NetworkState;
}

export function renderNetworkFrame(model: NetworkRenderModel): string {
  const activeScope =
    model.scopes.find((scope) => scope.id === model.state.activeScopeId) ??
    model.scopes[0] ?? {
      id: "main",
      label: "main",
      requests: [],
    };

  const lines: string[] = [];
  lines.push(renderScopeTabs(model.scopes, model.state.activeScopeId));
  lines.push("");
  lines.push("Tool          Time   Ctx+   Status  Subagent");
  lines.push("------------------------------------------------");

  const rows = activeScope.requests;
  if (rows.length === 0) {
    lines.push("(no requests)");
  } else {
    const selectedIndex = model.state.selectionByScope[activeScope.id] ?? 0;
    rows.forEach((request, index) => {
      const marker = index === selectedIndex ? ">" : " ";
      const time = request.timeMs === null ? "-" : `${request.timeMs}ms`;
      const ctx = request.ctxSpikeTokens.toLocaleString();
      const status = request.isError ? "error" : "ok";
      const subagent = request.linkedSubagentId ?? "-";
      lines.push(
        `${marker} ${pad(request.toolName, 12)} ${pad(time, 8)} ${pad(ctx, 6)} ${pad(status, 6)} ${subagent}`
      );
    });
  }

  if (model.state.detailOpen && rows.length > 0) {
    const selectedIndex = model.state.selectionByScope[activeScope.id] ?? 0;
    const selected = rows[Math.min(selectedIndex, rows.length - 1)];
    lines.push("");
    lines.push("Detail");
    lines.push("------");
    lines.push(`Tool: ${selected.toolName}`);
    lines.push(`Use ID: ${selected.toolUseId}`);
    lines.push(`Started: ${selected.startTimestamp}`);
    lines.push(`Ended: ${selected.endTimestamp ?? "-"}`);
    lines.push(`Time: ${selected.timeMs === null ? "-" : `${selected.timeMs}ms`}`);
    lines.push(`Ctx+: ${selected.ctxSpikeTokens.toLocaleString()}`);
    lines.push(`Subagent session: ${selected.linkedSubagentId ?? "-"}`);
    lines.push(`Input: ${safeJson(selected.toolInput)}`);
    lines.push(`Result: ${selected.toolResultContent ?? ""}`);
  }

  return lines.join("\n");
}

function renderScopeTabs(scopes: NetworkAgentScope[], activeScopeId: string): string {
  if (scopes.length === 0) return "Scopes: [main]";
  const tabs = scopes.map((scope) =>
    scope.id === activeScopeId ? `[${scope.label}]` : scope.label
  );
  return `Scopes: ${tabs.join(" | ")}`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, " ");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
