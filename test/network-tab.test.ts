import { describe, it, expectTypeOf } from "vitest";
import type { NetworkAgentScope, NetworkRequestEntry } from "../src/types.js";
import type { SessionEvent } from "../src/types.js";
import { SessionTree } from "../src/parser/session-tree.js";
import { analyzeNetworkTab } from "../src/analyzers/network-tab.js";
import { expect } from "vitest";

describe("network types", () => {
  it("defines agent-scoped request shape", () => {
    expectTypeOf<NetworkAgentScope>().toMatchTypeOf<{
      id: string;
      label: string;
      requests: NetworkRequestEntry[];
    }>();
  });
});

describe("analyzeNetworkTab", () => {
  it("partitions requests by agent scope and computes time/context", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant",
        uuid: "a_main",
        parentUuid: "u1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00.000Z",
        requestId: "req_main",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_main",
              name: "Read",
              input: { file_path: "/tmp/main.ts" },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 5000,
            cache_read_input_tokens: 0,
            output_tokens: 20,
          },
        },
      },
      {
        type: "assistant",
        uuid: "a_agent",
        parentUuid: "u1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:05.000Z",
        requestId: "req_agent",
        isSidechain: true,
        agentId: "agent_1",
        cwd: "/tmp",
        message: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_agent",
              name: "Write",
              input: { file_path: "/tmp/agent.ts" },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 4,
            cache_creation_input_tokens: 250,
            cache_read_input_tokens: 0,
            output_tokens: 10,
          },
        },
      },
      {
        type: "user",
        uuid: "u_main_result",
        parentUuid: "a_main",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.200Z",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_main",
              content: "ok",
              is_error: false,
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "u_agent_result",
        parentUuid: "a_agent",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:06.500Z",
        isSidechain: true,
        cwd: "/tmp",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_agent",
              content: "done",
              is_error: false,
            },
          ],
        },
      },
    ];

    const result = analyzeNetworkTab(new SessionTree(events));
    expect(result.scopes.map((s) => s.id)).toEqual(["main", "agent_1"]);
    expect(result.scopes[0].requests[0].timeMs).toBe(1200);
    expect(result.scopes[0].requests[0].ctxSpikeTokens).toBe(5000);
  });

  it("links Task calls to their subagent session id", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant",
        uuid: "a_task",
        parentUuid: "u1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00.000Z",
        requestId: "req_task",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_task",
              name: "Task",
              input: { description: "Investigate" },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 0,
            output_tokens: 5,
          },
        },
      },
      {
        type: "progress",
        uuid: "p_agent",
        parentUuid: "a_task",
        parentToolUseID: "tool_task",
        toolUseID: "agent_msg_1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00.100Z",
        isSidechain: false,
        data: {
          type: "agent_progress",
          agentId: "agent_abc123",
        },
      } as SessionEvent,
      {
        type: "user",
        uuid: "u_task_result",
        parentUuid: "a_task",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00.900Z",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_task",
              content: "done",
              is_error: false,
            },
          ],
        },
      },
    ];

    const result = analyzeNetworkTab(new SessionTree(events));
    const mainScope = result.scopes.find((s) => s.id === "main");
    expect(mainScope).toBeDefined();
    expect(mainScope!.requests).toHaveLength(1);
    expect(mainScope!.requests[0].toolName).toBe("Task");
    expect(mainScope!.requests[0].linkedSubagentId).toBe("agent_abc123");
    // agent_progress events are dropped entirely (covered by subagent session files)
    const allEvents = result.scopes.flatMap((s) => s.events);
    expect(allEvents.every((e) => e.progressType !== "agent_progress")).toBe(true);
  });
});
