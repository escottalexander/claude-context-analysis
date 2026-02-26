const app = document.getElementById("app");

const state = {
  activeScopeId: "main",
  selectedRowId: null,
  selectedTools: new Set(),
  selectedStatuses: new Set(),
  searchQuery: "",
  minTimeMs: null,
  sessionKey: null,
};

const historyBackStack = [];
const historyForwardStack = [];
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
    activeScope?.requests.some((row) => row.toolUseId === snapshot.selectedRowId)
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

function applyNavigationState(snapshot, data, sessions) {
  const next = normalizeNavigationState(snapshot, data, sessions);
  state.activeScopeId = next.activeScopeId;
  state.selectedRowId = next.selectedRowId;
  state.sessionKey = next.sessionKey;
  render(data, sessions);
}

function navigateToSnapshot(snapshot, data, sessions) {
  const current = captureNavigationState();
  const next = normalizeNavigationState(snapshot, data, sessions);
  if (statesEqual(current, next)) return;
  historyBackStack.push(current);
  historyForwardStack.length = 0;
  applyNavigationState(next, data, sessions);
}

function handleBackNavigation() {
  if (!currentData || historyBackStack.length === 0) return;
  const previous = historyBackStack.pop();
  historyForwardStack.push(captureNavigationState());
  applyNavigationState(previous, currentData, currentSessions);
}

function handleForwardNavigation() {
  if (!currentData || historyForwardStack.length === 0) return;
  const next = historyForwardStack.pop();
  historyBackStack.push(captureNavigationState());
  applyNavigationState(next, currentData, currentSessions);
}

function timeText(timeMs) {
  return timeMs === null ? "-" : `${timeMs}ms`;
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

function getVisibleRows(activeScope) {
  if (!activeScope) return [];
  return activeScope.requests.filter((row) => {
    if (state.selectedTools.size > 0 && !state.selectedTools.has(row.toolName)) {
      return false;
    }
    const status = row.isError ? "error" : "ok";
    if (state.selectedStatuses.size > 0 && !state.selectedStatuses.has(status)) {
      return false;
    }
    if (state.minTimeMs !== null && (row.timeMs ?? 0) < state.minTimeMs) {
      return false;
    }
    if (state.searchQuery.trim().length > 0) {
      const query = state.searchQuery.trim().toLowerCase();
      const haystack =
        `${row.toolName} ${row.toolUseId} ${row.linkedSubagentId ?? ""} ${row.toolResultContent ?? ""}`.toLowerCase();
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

function render(data, sessions) {
  currentData = data;
  currentSessions = sessions;
  const activeScope =
    data.network.scopes.find((scope) => scope.id === state.activeScopeId) ??
    data.network.scopes[0];
  if (activeScope) state.activeScopeId = activeScope.id;
  const visibleRows = getVisibleRows(activeScope);
  const visibleTotals = sumVisibleMetrics(visibleRows);
  const selectedRow =
    visibleRows.find((row) => row.toolUseId === state.selectedRowId) ?? null;

  app.innerHTML = `
      <section class="filter-bar">
        <div class="filter-bar-left">
          <label>Search <input id="filter-search" type="text" value="${state.searchQuery}" placeholder="tool, id, result..." /></label>
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
          <span>Tools</span>
          ${data.filters.toolNames
            .map(
              (tool) => `
            <button class="pill ${state.selectedTools.has(tool) ? "active" : ""}" data-tool="${tool}">
              ${tool}
            </button>
          `
            )
            .join("")}
        </div>
        <div class="pill-group">
          <span>Status</span>
          ${["ok", "error"]
            .map(
              (status) => `
            <button class="pill ${state.selectedStatuses.has(status) ? "active" : ""}" data-status="${status}">
              ${status}
            </button>
          `
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
            <span><strong>Visible tool calls:</strong> ${visibleRows.length}</span>
            <span><strong>Total context:</strong> ${visibleTotals.contextTokens.toLocaleString()} tokens</span>
            <span><strong>Total running time:</strong> ${visibleTotals.runningTimeMs.toLocaleString()}ms</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Time</th>
                <th>Ctx+</th>
                <th>Start</th>
              </tr>
            </thead>
            <tbody>
              ${
                visibleRows.length === 0
                  ? `<tr><td colspan="4" class="empty">No matching requests</td></tr>`
                  : visibleRows
                      .map(
                        (row) => `
                    <tr class="row ${row.isError ? "error" : ""} ${selectedRow?.toolUseId === row.toolUseId ? "selected" : ""}" data-row="${row.toolUseId}">
                      <td>${row.toolName}</td>
                      <td>${timeText(row.timeMs)}</td>
                      <td>${row.ctxSpikeTokens.toLocaleString()}</td>
                      <td>${new Date(row.startTimestamp).toLocaleTimeString()}</td>
                    </tr>
                  `
                      )
                      .join("")
              }
            </tbody>
          </table>
        </div>
        <aside class="detail-panel">
          ${
            selectedRow
              ? `
            <h3>${selectedRow.toolName}</h3>
            <p><strong>Use ID:</strong> ${selectedRow.toolUseId}</p>
            <p><strong>Status:</strong> ${selectedRow.isError ? "error" : "ok"}</p>
            <p><strong>Time:</strong> ${timeText(selectedRow.timeMs)}</p>
            <p><strong>Ctx+:</strong> ${selectedRow.ctxSpikeTokens.toLocaleString()}</p>
            ${
              selectedRow.linkedSubagentId
                ? `<p><strong>Spawns subagent session:</strong> <button class="subagent-link" data-jump-subagent="${selectedRow.linkedSubagentId}">${selectedRow.linkedSubagentId}</button></p>`
                : ""
            }
            <h4>Input</h4>
            <pre>${detailValue(selectedRow.toolInput)}</pre>
            <h4>Result</h4>
            <pre>${detailValue(selectedRow.toolResultContent)}</pre>
          `
              : `<p class="empty">Click a row to inspect details.</p>`
          }
        </aside>
      </section>
  `;
  navBackBtn = app.querySelector("#nav-back-btn");
  navForwardBtn = app.querySelector("#nav-forward-btn");
  if (navBackBtn) navBackBtn.addEventListener("click", handleBackNavigation);
  if (navForwardBtn) navForwardBtn.addEventListener("click", handleForwardNavigation);
  updateSessionTriggerLabel(sessions);
  renderSessionModalList(sessions);
  updateNavigationButtons();
  for (const btn of app.querySelectorAll("[data-tool]")) {
    btn.addEventListener("click", () => {
      const tool = btn.getAttribute("data-tool");
      if (state.selectedTools.has(tool)) state.selectedTools.delete(tool);
      else state.selectedTools.add(tool);
      render(data, sessions);
    });
  }
  for (const btn of app.querySelectorAll("[data-status]")) {
    btn.addEventListener("click", () => {
      const status = btn.getAttribute("data-status");
      if (state.selectedStatuses.has(status)) state.selectedStatuses.delete(status);
      else state.selectedStatuses.add(status);
      render(data, sessions);
    });
  }
  for (const btn of app.querySelectorAll("[data-scope]")) {
    btn.addEventListener("click", () => {
      const nextScopeId = btn.getAttribute("data-scope");
      navigateToSnapshot(
        {
          ...captureNavigationState(),
          activeScopeId: nextScopeId,
          selectedRowId: null,
        },
        data,
        sessions
      );
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
          selectedRowId: targetScope.requests[0]?.toolUseId ?? null,
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
