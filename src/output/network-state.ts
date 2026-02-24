export interface NetworkState {
  scopeIds: string[];
  activeScopeId: string;
  selectionByScope: Record<string, number>;
  detailOpen: boolean;
  shouldQuit: boolean;
}

export type NetworkAction =
  | { type: "next-scope" }
  | { type: "prev-scope" }
  | { type: "move-up" }
  | { type: "move-down"; maxIndex: number }
  | { type: "open-detail" }
  | { type: "close-detail" }
  | { type: "quit" };

export function createNetworkState(scopeIds: string[]): NetworkState {
  const normalizedScopeIds = scopeIds.length > 0 ? scopeIds : ["main"];
  const selectionByScope: Record<string, number> = {};
  for (const id of normalizedScopeIds) {
    selectionByScope[id] = 0;
  }

  return {
    scopeIds: normalizedScopeIds,
    activeScopeId: normalizedScopeIds[0],
    selectionByScope,
    detailOpen: false,
    shouldQuit: false,
  };
}

export function reduceNetworkState(
  state: NetworkState,
  action: NetworkAction
): NetworkState {
  switch (action.type) {
    case "next-scope":
      return withActiveScope(state, +1);
    case "prev-scope":
      return withActiveScope(state, -1);
    case "move-up":
      return withSelectionDelta(state, -1);
    case "move-down":
      return withSelectionDelta(state, +1, action.maxIndex);
    case "open-detail":
      return { ...state, detailOpen: true };
    case "close-detail":
      return { ...state, detailOpen: false };
    case "quit":
      return { ...state, shouldQuit: true };
    default:
      return state;
  }
}

function withActiveScope(state: NetworkState, delta: number): NetworkState {
  const currentIndex = state.scopeIds.indexOf(state.activeScopeId);
  const length = state.scopeIds.length;
  const nextIndex = (currentIndex + delta + length) % length;
  return {
    ...state,
    activeScopeId: state.scopeIds[nextIndex],
    detailOpen: false,
  };
}

function withSelectionDelta(
  state: NetworkState,
  delta: number,
  maxIndex: number = Number.MAX_SAFE_INTEGER
): NetworkState {
  const scopeId = state.activeScopeId;
  const current = state.selectionByScope[scopeId] ?? 0;
  const next = clamp(current + delta, 0, Math.max(0, maxIndex));
  return {
    ...state,
    selectionByScope: {
      ...state.selectionByScope,
      [scopeId]: next,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
