import { describe, it, expect } from "vitest";
import { readJsonl } from "../src/parser/jsonl-reader.js";
import { SessionTree } from "../src/parser/session-tree.js";
import { analyzeToolDashboard } from "../src/analyzers/tool-dashboard.js";
import path from "node:path";
import type { SessionEvent } from "../src/types.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures/small-session.jsonl");

describe("analyzeToolDashboard", () => {
  it("computes per-tool stats", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const { toolStats } = analyzeToolDashboard(tree);

    expect(toolStats.length).toBe(2);

    const readStats = toolStats.find((s) => s.name === "Read");
    expect(readStats).toBeDefined();
    expect(readStats!.count).toBe(1);
    expect(readStats!.successes).toBe(1);
    expect(readStats!.failures).toBe(0);

    const editStats = toolStats.find((s) => s.name === "Edit");
    expect(editStats).toBeDefined();
    expect(editStats!.count).toBe(1);
    expect(editStats!.successes).toBe(1);
  });

  it("tracks file access", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const { fileAccess } = analyzeToolDashboard(tree);

    const testFile = fileAccess.find((f) => f.path === "/tmp/test.ts");
    expect(testFile).toBeDefined();
    expect(testFile!.reads).toBe(1);
    expect(testFile!.edits).toBe(1);
    expect(testFile!.writes).toBe(0);
  });

  it("computes average duration", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const { toolStats } = analyzeToolDashboard(tree);

    const readStats = toolStats.find((s) => s.name === "Read");
    expect(readStats!.avgDurationMs).not.toBeNull();
    // Timestamps are 1 second apart in fixture
    expect(readStats!.avgDurationMs).toBe(1000);
  });

  it("detects sequential patterns when present", async () => {
    // With only 2 tool calls, no 3-length pattern repeats
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const { toolPatterns } = analyzeToolDashboard(tree);
    // Only 2 tools total, can't form a window of 3
    expect(toolPatterns.length).toBe(0);
  });

  it("attributes tokens once per deduped assistant turn", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
        requestId: "req_1",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "working" }],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 2,
          },
        },
      },
      {
        type: "assistant",
        uuid: "a2",
        parentUuid: "a1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:02.000Z",
        requestId: "req_1",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "Read",
              input: { file_path: "/tmp/a.ts" },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 50,
            cache_read_input_tokens: 100,
            output_tokens: 20,
          },
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a2",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:03.000Z",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: "ok",
              is_error: false,
            },
          ],
        },
      },
    ];

    const { toolStats } = analyzeToolDashboard(new SessionTree(events));
    const read = toolStats.find((s) => s.name === "Read");
    expect(read).toBeDefined();
    expect(read!.attributedInputTokens).toBe(10);
    expect(read!.attributedCacheCreationTokens).toBe(50);
    expect(read!.attributedCacheReadTokens).toBe(100);
    expect(read!.attributedOutputTokens).toBe(20);
    expect(read!.attributedTotalTokens).toBe(180);
  });

  it("splits a turn's tokens across multiple tool calls", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
        requestId: "req_1",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "Read",
              input: { file_path: "/tmp/a.ts" },
            },
            {
              type: "tool_use",
              id: "tool_2",
              name: "Write",
              input: { file_path: "/tmp/b.ts", content: "x" },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 20,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 10,
          },
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:02.000Z",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: "ok",
              is_error: false,
            },
            {
              type: "tool_result",
              tool_use_id: "tool_2",
              content: "ok",
              is_error: false,
            },
          ],
        },
      },
    ];

    const { toolStats } = analyzeToolDashboard(new SessionTree(events));
    const read = toolStats.find((s) => s.name === "Read");
    const write = toolStats.find((s) => s.name === "Write");
    expect(read).toBeDefined();
    expect(write).toBeDefined();
    expect(read!.attributedTotalTokens).toBe(15);
    expect(write!.attributedTotalTokens).toBe(15);
  });
});
