const app = document.getElementById("app");

const KIND_LABELS = {
  tool_use: "Tool",
  user_message: "User",
  assistant_text: "Assistant",
  thinking: "Thinking",
  hook: "Hook",
  system: "System",
  compaction: "Compaction",
};

const KIND_COLORS = {
  tool_use: "",
  user_message: "kind-user",
  assistant_text: "kind-assistant",
  thinking: "kind-thinking",
  hook: "kind-hook",
  system: "kind-system",
  compaction: "kind-compaction",
};

const state = {
  activeScopeId: "main",
  selectedRowId: null,
  selectedTools: new Map(),
  selectedStatuses: new Map(),
  selectedKinds: new Map(),
  searchQuery: "",
  minTimeMs: null,
  sessionKey: null,
};

const historyBackStack = [];
const historyForwardStack = [];
let lastSelectedState = null;
let currentData = null;
let currentSessions = [];

let navBackBtn = null;
let navForwardBtn = null;
let sessionPollInterval = null;
let sessionListPollInterval = null;
let lastTotalEvents = null;
const sessionModalTrigger = document.getElementById("session-modal-trigger");
const sessionCurrentLabel = document.getElementById("session-current-label");
const sessionModal = document.getElementById("session-modal");
const sessionModalList = document.getElementById("session-modal-list");
const sessionModalCloseBtn = document.getElementById("session-modal-close");
const sessionModalBackdrop = document.getElementById("session-modal-backdrop");
let sessionModalOpen = false;

function updateNavigationButtons() {
  if (navBackBtn) navBackBtn.disabled = historyBackStack.length === 0;
  if (navForwardBtn) navForwardBtn.disabled = historyForwardStack.length === 0;
}

function captureNavigationState() {
  return {
    activeScopeId: state.activeScopeId,
    selectedRowId: state.selectedRowId,
    sessionKey: state.sessionKey,
  };
}

function statesEqual(left, right) {
  return (
    left.activeScopeId === right.activeScopeId &&
    left.selectedRowId === right.selectedRowId &&
    left.sessionKey === right.sessionKey
  );
}

function normalizeNavigationState(snapshot, data, sessions) {
  const fallbackScopeId = data.network.scopes[0]?.id ?? "main";
  const activeScope =
    data.network.scopes.find((scope) => scope.id === snapshot.activeScopeId) ??
    data.network.scopes[0];
  const activeScopeId = activeScope?.id ?? fallbackScopeId;
  const selectedRowId =
    activeScope?.events.some((evt) => evt.id === snapshot.selectedRowId)
      ? snapshot.selectedRowId
      : null;
  const sessionKey = sessions.some((session) => session.sessionKey === snapshot.sessionKey)
    ? snapshot.sessionKey
    : state.sessionKey;
  return {
    activeScopeId,
    selectedRowId,
    sessionKey,
  };
}

function applyNavigationState(snapshot, data, sessions, { scrollToSelected = false, resetScroll = false } = {}) {
  const next = normalizeNavigationState(snapshot, data, sessions);
  const scopeChanged = next.activeScopeId !== state.activeScopeId;
  state.activeScopeId = next.activeScopeId;
  state.selectedRowId = next.selectedRowId;
  state.sessionKey = next.sessionKey;
  render(data, sessions, { scrollToSelected, resetScroll: resetScroll || scopeChanged });
}

function navigateToSnapshot(snapshot, data, sessions) {
  const next = normalizeNavigationState(snapshot, data, sessions);
  if (lastSelectedState && statesEqual(lastSelectedState, next)) return;
  if (lastSelectedState) {
    historyBackStack.push(lastSelectedState);
  }
  historyForwardStack.length = 0;
  lastSelectedState = next.selectedRowId ? next : null;
  applyNavigationState(next, data, sessions);
}

function handleBackNavigation() {
  if (!currentData || historyBackStack.length === 0) return;
  const previous = historyBackStack.pop();
  if (lastSelectedState) {
    historyForwardStack.push(lastSelectedState);
  }
  lastSelectedState = previous;
  applyNavigationState(previous, currentData, currentSessions, { scrollToSelected: true });
}

function handleForwardNavigation() {
  if (!currentData || historyForwardStack.length === 0) return;
  const next = historyForwardStack.pop();
  if (lastSelectedState) {
    historyBackStack.push(lastSelectedState);
  }
  lastSelectedState = next;
  applyNavigationState(next, currentData, currentSessions, { scrollToSelected: true });
}

function timeText(timeMs) {
  if (timeMs === null || timeMs === undefined) return "-";
  if (timeMs >= 1000) return `${(timeMs / 1000).toFixed(1)}s`;
  return `${timeMs}ms`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatSessionLabel(session) {
  return `${session.projectName}/${session.fileName}`;
}

function updateSessionTriggerLabel(sessions) {
  if (!sessionCurrentLabel) return;
  const selected = sessions.find((session) => session.sessionKey === state.sessionKey);
  sessionCurrentLabel.textContent = selected ? formatSessionLabel(selected) : "No session";
}

function closeSessionModal() {
  if (!sessionModal) return;
  sessionModal.classList.add("hidden");
  sessionModalOpen = false;
  if (sessionModalTrigger) sessionModalTrigger.setAttribute("aria-expanded", "false");
}

function openSessionModal() {
  if (!sessionModal || !sessionModalList) return;
  sessionModal.classList.remove("hidden");
  sessionModalOpen = true;
  if (sessionModalTrigger) sessionModalTrigger.setAttribute("aria-expanded", "true");
  const activeOption = sessionModalList.querySelector(".session-option.active");
  const firstOption = sessionModalList.querySelector(".session-option");
  const focusTarget = activeOption ?? firstOption;
  if (focusTarget instanceof HTMLElement) focusTarget.focus();
}

function renderSessionModalList(sessions) {
  if (!sessionModalList) return;
  sessionModalList.innerHTML = sessions
    .map((session, index) => {
      const isActive = session.sessionKey === state.sessionKey;
      const label = formatSessionLabel(session);
      const shortKey = session.sessionKey.slice(0, 10);
      const recencyLabel = index === 0 ? "Most recent" : `Recent #${index + 1}`;
      return `
        <button class="session-option ${isActive ? "active" : ""}" data-session-option="${session.sessionKey}">
          <div class="session-option-header">
            <span class="session-option-title">${escapeHtml(label)}</span>
            <span class="session-option-badge">${isActive ? "Active" : escapeHtml(recencyLabel)}</span>
          </div>
          <div class="session-option-meta">Project: <strong>${escapeHtml(session.projectName)}</strong> · Session: <strong>${escapeHtml(session.fileName)}</strong></div>
          <div class="session-option-meta session-option-path">${escapeHtml(session.fullPath)}</div>
          <div class="session-option-meta">Key: <code>${escapeHtml(shortKey)}…</code></div>
        </button>
      `;
    })
    .join("");
  for (const option of sessionModalList.querySelectorAll("[data-session-option]")) {
    option.addEventListener("click", async () => {
      const nextKey = option.getAttribute("data-session-option");
      await switchSession(nextKey, sessions);
    });
  }
}

function sumVisibleMetrics(rows) {
  return rows.reduce(
    (totals, row) => {
      totals.contextTokens += row.ctxSpikeTokens ?? 0;
      if (typeof row.timeMs === "number" && Number.isFinite(row.timeMs)) {
        totals.runningTimeMs += row.timeMs;
      }
      return totals;
    },
    { contextTokens: 0, runningTimeMs: 0 }
  );
}

function detailValue(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Render a JSON value as a collapsible, syntax-highlighted tree.
 * Returns an HTML string. Objects/arrays with children are collapsible.
 */
function renderJsonTree(value, key, collapsed) {
  if (value === null) return jsonLeaf(key, '<span class="jt-null">null</span>');
  if (value === undefined) return jsonLeaf(key, '<span class="jt-null">undefined</span>');
  if (typeof value === "boolean") return jsonLeaf(key, `<span class="jt-bool">${value}</span>`);
  if (typeof value === "number") return jsonLeaf(key, `<span class="jt-num">${value}</span>`);
  if (typeof value === "string") {
    const display = value.length > 300
      ? escapeHtml(value.slice(0, 300)) + '<span class="jt-ellipsis">…</span>'
      : escapeHtml(value);
    return jsonLeaf(key, `<span class="jt-str">"${display}"</span>`);
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";

  if (entries.length === 0) {
    return jsonLeaf(key, `<span class="jt-brace">${open}${close}</span>`);
  }

  const shouldCollapse = collapsed ?? false;
  const stateClass = shouldCollapse ? "jt-collapsed" : "jt-expanded";
  const keyHtml = key !== null ? `<span class="jt-key">"${escapeHtml(String(key))}"</span><span class="jt-colon">: </span>` : "";

  return `<div class="jt-node ${stateClass}">
    <span class="jt-toggle" onclick="this.parentElement.classList.toggle('jt-collapsed');this.parentElement.classList.toggle('jt-expanded')">${keyHtml}<span class="jt-brace">${open}</span><span class="jt-preview jt-ellipsis"> ${entries.length} ${isArray ? "items" : "keys"} </span></span>
    <div class="jt-children">${entries.map(([k, v]) => renderJsonTree(v, k, false)).join("")}</div>
    <span class="jt-brace">${close}</span>
  </div>`;
}

function jsonLeaf(key, valueHtml) {
  const keyHtml = key !== null ? `<span class="jt-key">"${escapeHtml(String(key))}"</span><span class="jt-colon">: </span>` : "";
  return `<div class="jt-leaf">${keyHtml}${valueHtml}</div>`;
}

function renderJsonViewer(value) {
  if (value === null || value === undefined) return "<pre>-</pre>";
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return `<pre>${escapeHtml(value)}</pre>`; }
  }
  return `<div class="json-tree">${renderJsonTree(value, null, false)}</div>`;
}


function passesFilter(filterMap, value) {
  if (filterMap.size === 0) return true;
  const hasSolo = [...filterMap.values()].some((v) => v === "solo");
  const s = filterMap.get(value);
  if (s === "exclude") return false;
  if (hasSolo && s !== "solo") return false;
  return true;
}

function pillState(filterMap, key) {
  const s = filterMap.get(key);
  if (s === "solo") return { cls: "active", prefix: "✓ ", title: "Solo — click to exclude" };
  if (s === "exclude") return { cls: "excluded", prefix: "× ", title: "Excluded — click to include" };
  return { cls: "", prefix: "", title: "Showing — click to solo" };
}

function getVisibleEvents(activeScope) {
  if (!activeScope) return [];
  return activeScope.events.filter((evt) => {
    // Kind filter
    if (!passesFilter(state.selectedKinds, evt.kind)) {
      return false;
    }
    // Tool name filter (only applies to tool_use events)
    if (state.selectedTools.size > 0) {
      if (evt.kind === "tool_use") {
        if (!passesFilter(state.selectedTools, evt.toolName)) return false;
      }
    }
    // Status filter (only applies to tool_use events)
    if (state.selectedStatuses.size > 0) {
      if (evt.kind === "tool_use") {
        const status = evt.isError ? "error" : "ok";
        if (!passesFilter(state.selectedStatuses, status)) return false;
      }
    }
    // Min time filter (only applies to tool_use events)
    if (state.minTimeMs !== null) {
      if (evt.kind === "tool_use" && (evt.timeMs ?? 0) < state.minTimeMs) {
        return false;
      }
    }
    // Search filter
    if (state.searchQuery.trim().length > 0) {
      const query = state.searchQuery.trim().toLowerCase();
      const haystack =
        `${evt.summary} ${evt.toolName ?? ""} ${evt.toolUseId ?? ""} ${evt.linkedSubagentId ?? ""} ${evt.content ?? ""} ${evt.toolResultContent ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function updateSessionUrl(sessionKey) {
  const url = new URL(window.location.href);
  if (sessionKey) {
    url.searchParams.set("session", sessionKey);
  } else {
    url.searchParams.delete("session");
  }
  window.history.replaceState({}, "", url);
}

async function loadSessionData(sessionKey) {
  const qs = sessionKey ? `?session=${encodeURIComponent(sessionKey)}` : "";
  const [sessionRes, networkRes, filtersRes] = await Promise.all([
    fetch(`/api/session${qs}`),
    fetch(`/api/network${qs}`),
    fetch(`/api/network/filters${qs}`),
  ]);
  if (!sessionRes.ok || !networkRes.ok || !filtersRes.ok) {
    throw new Error("Failed to load selected session");
  }
  return {
    session: await sessionRes.json(),
    network: await networkRes.json(),
    filters: await filtersRes.json(),
  };
}

function stopPolling() {
  if (sessionPollInterval) {
    clearInterval(sessionPollInterval);
    sessionPollInterval = null;
  }
  if (sessionListPollInterval) {
    clearInterval(sessionListPollInterval);
    sessionListPollInterval = null;
  }
}

function startPolling() {
  stopPolling();
  lastTotalEvents = currentData?.session?.totalEvents ?? null;

  sessionPollInterval = setInterval(async () => {
    if (!state.sessionKey) return;
    try {
      const data = await loadSessionData(state.sessionKey);
      if (data.session.totalEvents !== lastTotalEvents) {
        lastTotalEvents = data.session.totalEvents;
        const rowsPanel = app.querySelector(".rows-panel");
        const scrollTop = rowsPanel ? rowsPanel.scrollTop : 0;
        render(data, currentSessions);
        const newRowsPanel = app.querySelector(".rows-panel");
        if (newRowsPanel) newRowsPanel.scrollTop = scrollTop;
      }
    } catch {
      // Silently ignore poll failures
    }
  }, 1000);

  sessionListPollInterval = setInterval(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        const sessions = await res.json();
        if (JSON.stringify(sessions) !== JSON.stringify(currentSessions)) {
          currentSessions = sessions;
          updateSessionTriggerLabel(sessions);
          renderSessionModalList(sessions);
        }
      }
    } catch {
      // Silently ignore poll failures
    }
  }, 5000);
}

async function switchSession(nextKey, sessions = currentSessions) {
  if (!nextKey || nextKey === state.sessionKey) {
    closeSessionModal();
    return;
  }
  stopPolling();
  state.sessionKey = nextKey;
  state.activeScopeId = "main";
  state.selectedRowId = null;
  historyBackStack.length = 0;
  historyForwardStack.length = 0;
  lastSelectedState = null;
  updateNavigationButtons();
  updateSessionUrl(nextKey);
  updateSessionTriggerLabel(sessions);
  closeSessionModal();
  app.textContent = "Loading session...";
  try {
    const nextData = await loadSessionData(nextKey);
    state.activeScopeId = nextData.network.scopes[0]?.id ?? "main";
    render(nextData, sessions);
    startPolling();
  } catch {
    app.textContent = "Failed to switch session.";
  }
}

function buildContextLookup(tokenTurns, scopeId) {
  if (!tokenTurns || tokenTurns.length === 0) return () => null;
  const scoped = tokenTurns
    .filter((t) => (t.scopeId ?? "main") === scopeId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (scoped.length === 0) return () => null;
  return (timestamp) => {
    let best = null;
    for (const turn of scoped) {
      if (turn.timestamp <= timestamp) best = turn;
      else break;
    }
    return best;
  };
}

function ctxText(tokens) {
  if (tokens == null || tokens === 0) return "-";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toLocaleString();
}

function ctxTotalText(turn) {
  if (!turn) return "-";
  if (turn.totalTokens === 0) return "0";
  return ctxText(turn.totalTokens);
}


function renderEventRow(evt, isSelected, contextTurn, isDuplicateRequest) {
  const kindClass = KIND_COLORS[evt.kind] || "";
  const errorClass = evt.isError ? "error" : "";
  const selectedClass = isSelected ? "selected" : "";
  const dupClass = isDuplicateRequest ? "duplicate-request" : "";
  const ctxPercent = ctxTotalText(contextTurn);

  const subagentBadge = evt.linkedSubagentId
    ? ' <span class="kind-badge spawns-subagent-badge">Spawns Subagent</span>'
    : "";

  if (evt.kind === "tool_use") {
    const dupTooltip = "Additional context is shared with the previous row showing context usage";
    const ctxVal = isDuplicateRequest ? `<span class="dup-token" title="${dupTooltip}">↑</span>` : ctxText(evt.ctxSpikeTokens);
    return `<tr class="row ${errorClass} ${selectedClass} ${kindClass} ${dupClass}" data-row="${evt.id}">
      <td><span class="kind-badge kind-badge-tool_use">Tool</span>${subagentBadge} <span class="row-summary">${escapeHtml(evt.toolName)}</span></td>
      <td>${timeText(evt.timeMs)}</td>
      <td>${ctxVal}</td>
      <td>${ctxPercent}</td>
      <td>${new Date(evt.timestamp).toLocaleTimeString()}</td>
    </tr>`;
  }

  const kindLabel = KIND_LABELS[evt.kind] || evt.kind;
  const cacheTokens = evt.cacheCreationTokens ?? 0;
  const evtTime = evt.durationMs ? `${evt.durationMs}ms` : "-";
  const dupTooltip = "Additional context is shared with the previous row showing context usage";
  const ctxVal = isDuplicateRequest ? `<span class="dup-token" title="${dupTooltip}">↑</span>` : ctxText(cacheTokens);
  return `<tr class="row ${selectedClass} ${kindClass} ${dupClass}" data-row="${evt.id}">
    <td><span class="kind-badge kind-badge-${evt.kind}">${escapeHtml(kindLabel)}</span>${subagentBadge} <span class="row-summary">${escapeHtml(evt.summary)}</span></td>
    <td>${evtTime}</td>
    <td>${ctxVal}</td>
    <td>${ctxPercent}</td>
    <td>${new Date(evt.timestamp).toLocaleTimeString()}</td>
  </tr>`;
}

/**
 * Unified context info block for detail panels.
 * Shows Ctx+ and total context with a tooltip breaking down token categories.
 */
function renderContextInfo(evt, contextTurn) {
  const parts = [];

  // Ctx+ (cache creation / new context added)
  const ctxPlus = evt.ctxSpikeTokens ?? evt.cacheCreationTokens ?? 0;
  if (ctxPlus > 0) {
    parts.push(`<p><strong>Ctx+:</strong> ${ctxPlus.toLocaleString()} tokens</p>`);
  }

  // Total context with hover breakdown
  if (contextTurn) {
    const t = contextTurn;
    const tooltip = [
      `Cache read: ${t.cacheReadTokens.toLocaleString()}`,
      `Cache creation: ${t.cacheCreationTokens.toLocaleString()}`,
      `Input: ${t.inputTokens.toLocaleString()}`,
      `Output: ${t.outputTokens.toLocaleString()}`,
    ].join(" | ");
    parts.push(`<p><strong>Context:</strong> <span class="context-total" title="${tooltip}">${t.totalTokens.toLocaleString()} tokens (${t.percentOfLimit.toFixed(1)}%)</span></p>`);
  }

  return parts.join("\n");
}

function detailTimeBadge(evt) {
  const ts = new Date(evt.timestamp).toLocaleTimeString();
  const duration = evt.timeMs != null ? timeText(evt.timeMs) : null;
  const label = duration ? `${ts} · ${duration}` : ts;
  return `<span class="detail-time-badge">${label}</span>`;
}

function detailStatusBadge(evt) {
  if (evt.kind !== "tool_use") return "";
  const isErr = evt.isError;
  const cls = isErr ? "status-badge-error" : "status-badge-success";
  const label = isErr ? "Error" : "Success";
  return `<span class="status-badge ${cls}">${label}</span>`;
}

function renderDetailPanel(evt, contextTurn) {
  if (!evt) return `<p class="empty">Click a row to inspect details.</p>`;

  const ctxInfo = renderContextInfo(evt, contextTurn);
  const timeBadge = detailTimeBadge(evt);
  const statusBadge = detailStatusBadge(evt);

  if (evt.kind === "tool_use") {
    return `
      <div class="detail-header"><h3>${escapeHtml(evt.toolName)} ${timeBadge}</h3>${statusBadge}</div>
      <p><strong>Use ID:</strong> ${escapeHtml(evt.toolUseId)}</p>
      ${ctxInfo}
      ${evt.linkedSubagentId
        ? `<p><strong>Spawns subagent:</strong> <button class="subagent-link" data-jump-subagent="${evt.linkedSubagentId}">${evt.linkedSubagentId}</button></p>`
        : ""}
      <h4>Input</h4>
      ${renderJsonViewer(evt.toolInput)}
      <h4>Result</h4>
      <pre>${detailValue(evt.toolResultContent)}</pre>
      ${evt.toolUseResult ? `<h4>Metadata</h4>${renderJsonViewer(evt.toolUseResult)}` : ""}`;
  }

  if (evt.kind === "user_message") {
    return `
      <h3>User Message ${timeBadge}</h3>
      ${ctxInfo}
      <h4>Content</h4>
      <pre>${escapeHtml(evt.content)}</pre>`;
  }

  if (evt.kind === "assistant_text") {
    return `
      <h3>Assistant Response ${timeBadge}</h3>
      ${ctxInfo}
      <h4>Content</h4>
      <pre>${escapeHtml(evt.content)}</pre>`;
  }

  if (evt.kind === "thinking") {
    return `
      <h3>Thinking ${timeBadge}</h3>
      ${ctxInfo}
      <h4>Content</h4>
      <pre>${escapeHtml(evt.content)}</pre>`;
  }

  if (evt.kind === "hook") {
    return `
      <h3>Hook ${timeBadge}</h3>
      ${evt.hookName ? `<p><strong>Hook name:</strong> ${escapeHtml(evt.hookName)}</p>` : ""}
      ${ctxInfo}
      <h4>Content</h4>
      <pre>${escapeHtml(evt.content)}</pre>`;
  }

  if (evt.kind === "compaction") {
    return `
      <h3>Context Compaction ${timeBadge}</h3>
      ${evt.compactTrigger ? `<p><strong>Trigger:</strong> ${escapeHtml(evt.compactTrigger)}</p>` : ""}
      ${evt.preTokens ? `<p><strong>Pre-compaction tokens:</strong> ${evt.preTokens.toLocaleString()}</p>` : ""}
      ${ctxInfo}
      ${evt.linkedSubagentId
        ? `<p><strong>Compaction subagent:</strong> <button class="subagent-link" data-jump-subagent="${evt.linkedSubagentId}">${evt.linkedSubagentId}</button></p>`
        : ""}
      <h4>Content</h4>
      <pre>${escapeHtml(evt.content)}</pre>`;
  }

  if (evt.kind === "system") {
    return `
      <h3>System Event ${timeBadge}</h3>
      ${evt.subtype ? `<p><strong>Subtype:</strong> ${escapeHtml(evt.subtype)}</p>` : ""}
      ${evt.durationMs ? `<p><strong>Duration:</strong> ${timeText(evt.durationMs)}</p>` : ""}
      ${ctxInfo}
      <h4>Content</h4>
      <pre>${escapeHtml(evt.content)}</pre>`;
  }

  return `<p class="empty">Unknown event type.</p>`;
}

function render(data, sessions, { scrollToSelected = false, resetScroll = false } = {}) {
  currentData = data;
  currentSessions = sessions;
  const prevRowsPanel = app.querySelector(".rows-panel");
  const prevScrollTop = resetScroll ? 0 : (prevRowsPanel ? prevRowsPanel.scrollTop : 0);
  const activeScope =
    data.network.scopes.find((scope) => scope.id === state.activeScopeId) ??
    data.network.scopes[0];
  if (activeScope) state.activeScopeId = activeScope.id;
  const visibleEvents = getVisibleEvents(activeScope);
  const toolEvents = visibleEvents.filter((e) => e.kind === "tool_use");
  const visibleTotals = sumVisibleMetrics(toolEvents);
  const selectedEvent =
    visibleEvents.find((evt) => evt.id === state.selectedRowId) ?? null;
  const getContextTurn = buildContextLookup(data.session.tokenTurns, state.activeScopeId);

  // Collect unique tool names from current scope events
  const scopeToolNames = new Set();
  if (activeScope) {
    for (const evt of activeScope.events) {
      if (evt.kind === "tool_use" && evt.toolName) scopeToolNames.add(evt.toolName);
    }
  }

  app.innerHTML = `
      <section class="filter-bar">
        <div class="filter-bar-left">
          <label>Search <input id="filter-search" type="text" value="${state.searchQuery}" placeholder="tool, id, content..." /></label>
          <label>Min Time <input id="filter-time" type="text" inputmode="numeric" value="${state.minTimeMs ?? ""}" placeholder="ms" /></label>
        </div>
        <div class="filter-bar-right">
          <button id="nav-back-btn" class="nav-btn" aria-label="Go back" title="Back">
            ←
          </button>
          <button
            id="nav-forward-btn"
            class="nav-btn"
            aria-label="Go forward"
            title="Forward"
          >
            →
          </button>
        </div>
      </section>
      <section class="filter-pills">
        <div class="pill-group">
          <span>Kind</span>
          ${(data.filters.eventKinds ?? [])
            .map(
              (kind) => {
                const ps = pillState(state.selectedKinds, kind);
                return `
            <button class="pill ${ps.cls}" data-kind="${kind}" title="${ps.title}">
              ${ps.prefix}${KIND_LABELS[kind] || kind}
            </button>
          `;
              }
            )
            .join("")}
        </div>
        <div class="pill-group">
          <span>Tools</span>
          ${[...scopeToolNames].sort()
            .map(
              (tool) => {
                const ps = pillState(state.selectedTools, tool);
                return `
            <button class="pill ${ps.cls}" data-tool="${tool}" title="${ps.title}">
              ${ps.prefix}${tool}
            </button>
          `;
              }
            )
            .join("")}
        </div>
        <div class="pill-group">
          <span>Status</span>
          ${["ok", "error"]
            .map(
              (status) => {
                const ps = pillState(state.selectedStatuses, status);
                return `
            <button class="pill ${ps.cls}" data-status="${status}" title="${ps.title}">
              ${ps.prefix}${status}
            </button>
          `;
              }
            )
            .join("")}
        </div>
      </section>
      <section class="network-layout">
        <aside class="scope-tabs">
          <h3 class="panel-title">Agents</h3>
          ${data.network.scopes
            .map(
              (scope) => `
            <button class="scope-btn ${scope.id === state.activeScopeId ? "active" : ""}" data-scope="${scope.id}">
              ${scope.label}
            </button>
          `
            )
            .join("")}
        </aside>
        <div class="rows-panel">
          <div class="rows-summary">
            <span><strong>Events:</strong> ${visibleEvents.length}</span>
            <span><strong>Tool calls:</strong> ${toolEvents.length}</span>
            <span><strong>Context:</strong> ${visibleTotals.contextTokens.toLocaleString()} tokens</span>
            <span><strong>Time:</strong> ${visibleTotals.runningTimeMs.toLocaleString()}ms</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Time</th>
                <th>Ctx+</th>
                <th>Total</th>
                <th>Start</th>
              </tr>
            </thead>
            <tbody>
              ${
                visibleEvents.length === 0
                  ? `<tr><td colspan="5" class="empty">No matching events</td></tr>`
                  : (() => {
                      const seenReqIds = new Set();
                      return visibleEvents
                        .map((row) => {
                          const reqId = row.requestId;
                          const isDup = reqId ? seenReqIds.has(reqId) : false;
                          if (reqId) seenReqIds.add(reqId);
                          return renderEventRow(row, selectedEvent?.id === row.id, getContextTurn(row.timestamp), isDup);
                        })
                        .join("");
                    })()
              }
            </tbody>
          </table>
        </div>
        <aside class="detail-panel">
          ${renderDetailPanel(selectedEvent, selectedEvent ? getContextTurn(selectedEvent.timestamp) : null)}
        </aside>
      </section>
  `;
  const newRowsPanel = app.querySelector(".rows-panel");
  if (newRowsPanel) newRowsPanel.scrollTop = prevScrollTop;
  if (scrollToSelected && state.selectedRowId && newRowsPanel) {
    const selectedRow = newRowsPanel.querySelector(`[data-row="${state.selectedRowId}"]`);
    if (selectedRow) {
      const panelRect = newRowsPanel.getBoundingClientRect();
      const rowRect = selectedRow.getBoundingClientRect();
      const offset = rowRect.top - panelRect.top + newRowsPanel.scrollTop - panelRect.height / 2 + rowRect.height / 2;
      newRowsPanel.scrollTop = Math.max(0, offset);
    }
  }
  navBackBtn = app.querySelector("#nav-back-btn");
  navForwardBtn = app.querySelector("#nav-forward-btn");
  if (navBackBtn) navBackBtn.addEventListener("click", handleBackNavigation);
  if (navForwardBtn) navForwardBtn.addEventListener("click", handleForwardNavigation);
  updateSessionTriggerLabel(sessions);
  renderSessionModalList(sessions);
  updateNavigationButtons();

  // Kind filter pills (cycle: default → solo → exclude → default)
  for (const btn of app.querySelectorAll("[data-kind]")) {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-kind");
      const current = state.selectedKinds.get(kind);
      if (!current) state.selectedKinds.set(kind, "solo");
      else if (current === "solo") state.selectedKinds.set(kind, "exclude");
      else state.selectedKinds.delete(kind);
      render(data, sessions);
    });
  }
  for (const btn of app.querySelectorAll("[data-tool]")) {
    btn.addEventListener("click", () => {
      const tool = btn.getAttribute("data-tool");
      const current = state.selectedTools.get(tool);
      if (!current) state.selectedTools.set(tool, "solo");
      else if (current === "solo") state.selectedTools.set(tool, "exclude");
      else state.selectedTools.delete(tool);
      render(data, sessions);
    });
  }
  for (const btn of app.querySelectorAll("[data-status]")) {
    btn.addEventListener("click", () => {
      const status = btn.getAttribute("data-status");
      const current = state.selectedStatuses.get(status);
      if (!current) state.selectedStatuses.set(status, "solo");
      else if (current === "solo") state.selectedStatuses.set(status, "exclude");
      else state.selectedStatuses.delete(status);
      render(data, sessions);
    });
  }
  for (const btn of app.querySelectorAll("[data-scope]")) {
    btn.addEventListener("click", () => {
      const nextScopeId = btn.getAttribute("data-scope");
      if (nextScopeId === state.activeScopeId) return;
      state.activeScopeId = nextScopeId;
      state.selectedRowId = null;
      render(data, sessions, { resetScroll: true });
    });
  }
  for (const btn of app.querySelectorAll("[data-jump-subagent]")) {
    btn.addEventListener("click", () => {
      const scopeId = btn.getAttribute("data-jump-subagent");
      const targetScope = data.network.scopes.find((scope) => scope.id === scopeId);
      if (!scopeId || !targetScope) return;
      navigateToSnapshot(
        {
          ...captureNavigationState(),
          activeScopeId: scopeId,
          selectedRowId: targetScope.events[0]?.id ?? null,
        },
        data,
        sessions
      );
    });
  }
  for (const row of app.querySelectorAll("[data-row]")) {
    row.addEventListener("click", () => {
      navigateToSnapshot(
        {
          ...captureNavigationState(),
          selectedRowId: row.getAttribute("data-row"),
        },
        data,
        sessions
      );
    });
  }
  const searchInput = app.querySelector("#filter-search");
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      state.searchQuery = event.target.value;
      render(data, sessions);
      const nextSearchInput = app.querySelector("#filter-search");
      if (nextSearchInput) {
        nextSearchInput.focus();
        const cursor = state.searchQuery.length;
        nextSearchInput.setSelectionRange(cursor, cursor);
      }
    });
  }
  const timeInput = app.querySelector("#filter-time");
  if (timeInput) {
    timeInput.addEventListener("input", (event) => {
      const value = event.target.value.trim();
      const digitsOnly = value.replace(/\D/g, "");
      state.minTimeMs = digitsOnly === "" ? null : Number(digitsOnly);
      render(data, sessions);
      const nextTimeInput = app.querySelector("#filter-time");
      if (nextTimeInput) {
        nextTimeInput.focus();
        const cursor = nextTimeInput.value.length;
        nextTimeInput.setSelectionRange(cursor, cursor);
      }
    });
  }
}

if (sessionModalTrigger) {
  sessionModalTrigger.addEventListener("click", () => {
    if (sessionModalOpen) closeSessionModal();
    else openSessionModal();
  });
}

if (sessionModalCloseBtn) {
  sessionModalCloseBtn.addEventListener("click", () => {
    closeSessionModal();
  });
}

if (sessionModalBackdrop) {
  sessionModalBackdrop.addEventListener("click", () => {
    closeSessionModal();
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sessionModalOpen) {
    closeSessionModal();
  }
});

async function boot() {
  const sessionsRes = await fetch("/api/sessions");
  if (!sessionsRes.ok) {
    app.textContent = "Failed to load session data.";
    return;
  }
  const sessions = await sessionsRes.json();
  if (sessions.length === 0) {
    app.textContent = "No sessions found in ~/.claude/projects.";
    return;
  }
  const url = new URL(window.location.href);
  const requested = url.searchParams.get("session");
  state.sessionKey = sessions.some((s) => s.sessionKey === requested)
    ? requested
    : sessions[0].sessionKey;
  updateSessionUrl(state.sessionKey);
  const data = await loadSessionData(state.sessionKey);
  state.activeScopeId = data.network.scopes[0]?.id ?? "main";
  render(data, sessions);
  startPolling();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPolling();
  } else {
    startPolling();
  }
});

boot().catch(() => {
  app.textContent = "Failed to initialize app.";
});
