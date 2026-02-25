import type { NetworkAgentScope, NetworkRequestEntry } from "../types.js";

export interface WebUiState {
  activeScopeId: string;
  selectedToolNames: string[];
  selectedStatuses: Array<"ok" | "error">;
  searchQuery: string;
  minTimeMs: number | null;
  selectedRowId: string | null;
}

export function createWebUiState(scopes: NetworkAgentScope[]): WebUiState {
  return {
    activeScopeId: scopes[0]?.id ?? "main",
    selectedToolNames: [],
    selectedStatuses: [],
    searchQuery: "",
    minTimeMs: null,
    selectedRowId: null,
  };
}

export function setActiveScope(state: WebUiState, scopeId: string): WebUiState {
  return { ...state, activeScopeId: scopeId, selectedRowId: null };
}

export function setSelectedToolNames(
  state: WebUiState,
  toolNames: string[]
): WebUiState {
  return { ...state, selectedToolNames: [...toolNames] };
}

export function setSelectedStatuses(
  state: WebUiState,
  statuses: Array<"ok" | "error">
): WebUiState {
  return { ...state, selectedStatuses: [...statuses] };
}

export function setSearchQuery(state: WebUiState, query: string): WebUiState {
  return { ...state, searchQuery: query };
}

export function setMinTimeMs(
  state: WebUiState,
  minTimeMs: number | null
): WebUiState {
  return { ...state, minTimeMs };
}

export function setSelectedRow(
  state: WebUiState,
  rowId: string | null
): WebUiState {
  return { ...state, selectedRowId: rowId };
}

export function getVisibleRows(
  scopes: NetworkAgentScope[],
  state: WebUiState
): NetworkRequestEntry[] {
  const activeScope = scopes.find((scope) => scope.id === state.activeScopeId);
  if (!activeScope) return [];

  const search = state.searchQuery.trim().toLowerCase();

  return activeScope.requests.filter((row) => {
    if (
      state.selectedToolNames.length > 0 &&
      !state.selectedToolNames.includes(row.toolName)
    ) {
      return false;
    }

    const status = row.isError ? "error" : "ok";
    if (state.selectedStatuses.length > 0 && !state.selectedStatuses.includes(status)) {
      return false;
    }

    if (state.minTimeMs !== null) {
      const time = row.timeMs ?? 0;
      if (time < state.minTimeMs) return false;
    }

    if (search.length > 0) {
      const haystack =
        `${row.toolName} ${row.toolUseId} ${row.linkedSubagentId ?? ""} ${row.toolResultContent ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });
}

export function getSelectedRow(
  scopes: NetworkAgentScope[],
  state: WebUiState
): NetworkRequestEntry | null {
  if (!state.selectedRowId) return null;
  for (const scope of scopes) {
    const row = scope.requests.find((request) => request.toolUseId === state.selectedRowId);
    if (row) return row;
  }
  return null;
}
