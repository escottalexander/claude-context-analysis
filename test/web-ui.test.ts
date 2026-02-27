import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NetworkAgentScope } from "../src/types.js";
import {
  createWebUiState,
  getVisibleRows,
  setActiveScope,
  setSelectedToolNames,
  setSelectedStatuses,
  setSearchQuery,
  setMinTimeMs,
  setSelectedRow,
  getSelectedRow,
} from "../src/web/ui-model.js";

const scopes: NetworkAgentScope[] = [
  {
    id: "main",
    label: "main",
    requests: [
      {
        toolUseId: "r1",
        toolName: "Read",
        scopeId: "main",
        linkedSubagentId: null,
        startTimestamp: "2026-01-01T00:00:00.000Z",
        endTimestamp: "2026-01-01T00:00:00.400Z",
        timeMs: 400,
        ctxSpikeTokens: 1000,
        isError: false,
        toolInput: { file_path: "/tmp/a.ts" },
        toolResultContent: "ok",
      },
      {
        toolUseId: "r2",
        toolName: "Write",
        scopeId: "main",
        linkedSubagentId: null,
        startTimestamp: "2026-01-01T00:00:01.000Z",
        endTimestamp: "2026-01-01T00:00:03.000Z",
        timeMs: 2000,
        ctxSpikeTokens: 300,
        isError: true,
        toolInput: { file_path: "/tmp/a.ts" },
        toolResultContent: "failed",
      },
    ],
  },
  {
    id: "agent_1",
    label: "agent_1",
    requests: [
      {
        toolUseId: "r3",
        toolName: "Edit",
        scopeId: "agent_1",
        linkedSubagentId: "agent_1",
        startTimestamp: "2026-01-01T00:00:10.000Z",
        endTimestamp: "2026-01-01T00:00:11.000Z",
        timeMs: 1000,
        ctxSpikeTokens: 50,
        isError: false,
        toolInput: { file_path: "/tmp/b.ts" },
        toolResultContent: "done",
      },
    ],
  },
];

describe("web ui model", () => {
  it("renders Agents heading and omits redundant Scope column in network table", () => {
    const appJsPath = path.join(
      import.meta.dirname,
      "..",
      "src",
      "web",
      "public",
      "app.js"
    );
    const appSource = readFileSync(appJsPath, "utf8");
    expect(appSource).toContain("Agents");
    expect(appSource).not.toContain("<th>Scope</th>");
    expect(appSource).not.toContain("<th>Subagent</th>");
    expect(appSource).not.toContain("<th>Status</th>");
    expect(appSource).not.toContain("Overview");
    expect(appSource).not.toContain("data-tab=");
    expect(appSource).toContain("data-jump-subagent");
    expect(appSource).toContain("Context:");
    expect(appSource).toContain("<th>Time</th>");
    expect(appSource).toContain("evt.isError ? \"error\" : \"\"");
  });

  it("uses pane-level scrolling and tighter middle table layout", () => {
    const stylesPath = path.join(
      import.meta.dirname,
      "..",
      "src",
      "web",
      "public",
      "styles.css"
    );
    const css = readFileSync(stylesPath, "utf8");
    expect(css).toContain("overflow: hidden");
    expect(css).toContain("height: calc(100vh -");
    expect(css).toContain("table-layout: fixed");
    expect(css).toContain(".panel-title");
    expect(css).toContain(".scope-tabs");
    expect(css).toContain(".detail-panel");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("grid-template-columns: 180px");
  });

  it("preserves search input focus after input-driven rerender", () => {
    const appJsPath = path.join(
      import.meta.dirname,
      "..",
      "src",
      "web",
      "public",
      "app.js"
    );
    const appSource = readFileSync(appJsPath, "utf8");
    expect(appSource).toContain("next.focus()");
    expect(appSource).toContain("inputmode=\"numeric\"");
    expect(appSource).toContain("value.trim().replace(/\\D/g, \"\")");
  });

  it("uses URL query param session state for tab/window independence", () => {
    const appJsPath = path.join(
      import.meta.dirname,
      "..",
      "src",
      "web",
      "public",
      "app.js"
    );
    const appSource = readFileSync(appJsPath, "utf8");
    expect(appSource).toContain("window.location.href");
    expect(appSource).toContain("url.searchParams.set(\"session\"");
    expect(appSource).toContain("window.history.replaceState");
    expect(appSource).toContain("fetch(\"/api/sessions\")");
    expect(appSource).toContain("loadSessionData(state.sessionKey)");
  });

  it("exposes back and forward controls for cross-scope drilldown history", () => {
    const appJsPath = path.join(
      import.meta.dirname,
      "..",
      "src",
      "web",
      "public",
      "app.js"
    );
    const indexHtmlPath = path.join(
      import.meta.dirname,
      "..",
      "src",
      "web",
      "public",
      "index.html"
    );
    const appSource = readFileSync(appJsPath, "utf8");
    expect(appSource).toContain("nav-back-btn");
    expect(appSource).toContain("nav-forward-btn");
    expect(appSource).toContain("historyBackStack");
    expect(appSource).toContain("historyForwardStack");
    expect(appSource).toContain("data-jump-subagent");
  });

  it("tracks normal row navigation in history, not only subagent jumps", () => {
    const appJsPath = path.join(
      import.meta.dirname,
      "..",
      "src",
      "web",
      "public",
      "app.js"
    );
    const appSource = readFileSync(appJsPath, "utf8");
    expect(appSource).toContain("for (const row of app.querySelectorAll(\"[data-row]\"))");
    expect(appSource).toContain("navigateToSnapshot(");
    expect(appSource).toContain("selectedRowId: row.getAttribute(\"data-row\")");
  });

  it("filters by tool, status, search text, and min time", () => {
    let state = createWebUiState(scopes);
    state = setSelectedToolNames(state, ["Write"]);
    state = setSelectedStatuses(state, ["error"]);
    state = setSearchQuery(state, "fail");
    state = setMinTimeMs(state, 1000);

    const rows = getVisibleRows(scopes, state);
    expect(rows.map((row) => row.toolUseId)).toEqual(["r2"]);
  });

  it("shows only active scope rows", () => {
    let state = createWebUiState(scopes);
    expect(getVisibleRows(scopes, state).map((row) => row.toolUseId)).toEqual([
      "r1",
      "r2",
    ]);
    state = setActiveScope(state, "agent_1");
    expect(getVisibleRows(scopes, state).map((row) => row.toolUseId)).toEqual([
      "r3",
    ]);
  });

  it("supports row drilldown selection", () => {
    let state = createWebUiState(scopes);
    state = setSelectedRow(state, "r1");
    const row = getSelectedRow(scopes, state);
    expect(row?.toolName).toBe("Read");
    expect(row?.toolResultContent).toContain("ok");
  });
});
