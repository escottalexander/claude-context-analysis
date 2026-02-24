import { describe, it, expect } from "vitest";
import { renderNetworkFrame } from "../src/output/network-tui.js";
import { createNetworkState } from "../src/output/network-state.js";
import type { NetworkAgentScope } from "../src/types.js";

describe("renderNetworkFrame", () => {
  it("renders active scope tab and request table columns", () => {
    const scopes: NetworkAgentScope[] = [
      {
        id: "main",
        label: "main",
        requests: [
          {
            toolUseId: "tool_1",
            toolName: "Read",
            scopeId: "main",
            startTimestamp: "2026-01-01T00:00:00.000Z",
            endTimestamp: "2026-01-01T00:00:01.200Z",
            latencyMs: 1200,
            ctxSpikeTokens: 5000,
            isError: false,
            toolInput: { file_path: "/tmp/main.ts" },
            toolResultContent: "ok",
          },
        ],
      },
      {
        id: "agent_1",
        label: "agent_1",
        requests: [],
      },
    ];

    const output = renderNetworkFrame({
      scopes,
      state: createNetworkState(["main", "agent_1"]),
    });

    expect(output).toContain("main");
    expect(output).toContain("agent_1");
    expect(output).toContain("Latency");
    expect(output).toContain("Ctx+");
  });

  it("shows only one scope timeline at a time", () => {
    const output = renderNetworkFrame({
      scopes: [
        {
          id: "main",
          label: "main",
          requests: [
            {
              toolUseId: "tool_main",
              toolName: "Read",
              scopeId: "main",
              startTimestamp: "2026-01-01T00:00:00.000Z",
              endTimestamp: "2026-01-01T00:00:01.000Z",
              latencyMs: 1000,
              ctxSpikeTokens: 100,
              isError: false,
              toolInput: {},
              toolResultContent: "ok",
            },
          ],
        },
        {
          id: "agent_1",
          label: "agent_1",
          requests: [
            {
              toolUseId: "tool_agent",
              toolName: "agent_1-only-event",
              scopeId: "agent_1",
              startTimestamp: "2026-01-01T00:00:02.000Z",
              endTimestamp: "2026-01-01T00:00:03.000Z",
              latencyMs: 1000,
              ctxSpikeTokens: 20,
              isError: false,
              toolInput: {},
              toolResultContent: "done",
            },
          ],
        },
      ],
      state: createNetworkState(["main", "agent_1"]),
    });

    expect(output).toContain("Read");
    expect(output).not.toContain("agent_1-only-event");
  });

  it("shows '-' when latency is unknown in detail pane", () => {
    const state = createNetworkState(["main"]);
    state.detailOpen = true;
    const output = renderNetworkFrame({
      scopes: [
        {
          id: "main",
          label: "main",
          requests: [
            {
              toolUseId: "tool_main",
              toolName: "Read",
              scopeId: "main",
              startTimestamp: "2026-01-01T00:00:00.000Z",
              endTimestamp: null,
              latencyMs: null,
              ctxSpikeTokens: 0,
              isError: false,
              toolInput: {},
              toolResultContent: null,
            },
          ],
        },
      ],
      state,
    });

    expect(output).toContain("Latency: -");
    expect(output).not.toContain("Latency: -ms");
  });
});
