import { describe, it, expect } from "vitest";
import { readJsonl } from "../src/parser/jsonl-reader.js";
import { SessionTree } from "../src/parser/session-tree.js";
import { analyzeReasoningChain } from "../src/analyzers/reasoning-chain.js";
import path from "node:path";
import type { SessionEvent } from "../src/types.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures/small-session.jsonl");

describe("analyzeReasoningChain", () => {
  it("produces a chronological timeline", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const timeline = analyzeReasoningChain(tree);

    expect(timeline.length).toBeGreaterThan(0);

    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].timestamp >= timeline[i - 1].timestamp).toBe(true);
    }
  });

  it("extracts thinking, text, tool_use, and tool_result entries", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const timeline = analyzeReasoningChain(tree);

    const types = new Set(timeline.map((e) => e.type));
    expect(types.has("thinking")).toBe(true);
    expect(types.has("text")).toBe(true);
    expect(types.has("tool_use")).toBe(true);
    expect(types.has("tool_result")).toBe(true);
  });

  it("links tool_use and tool_result via toolUseId", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const timeline = analyzeReasoningChain(tree);

    const toolUses = timeline.filter((e) => e.type === "tool_use");
    const toolResults = timeline.filter((e) => e.type === "tool_result");

    expect(toolUses.length).toBe(2);
    expect(toolResults.length).toBe(2);

    expect(toolUses[0].toolUseId).toBe("tool_1");
    expect(toolResults[0].toolUseId).toBe("tool_1");
    expect(toolUses[1].toolUseId).toBe("tool_2");
    expect(toolResults[1].toolUseId).toBe("tool_2");
  });

  it("includes tool name in tool_use entries", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const timeline = analyzeReasoningChain(tree);

    const readCall = timeline.find(
      (e) => e.type === "tool_use" && e.toolName === "Read"
    );
    expect(readCall).toBeDefined();
    expect(readCall!.content).toContain("Read");
  });

  it("summarizes Skill and Write calls with clear targets", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_skill",
              name: "Skill",
              input: {
                skill_path: "/Users/me/.cursor/skills/brainstorming/SKILL.md",
              },
            },
            {
              type: "tool_use",
              id: "tool_write",
              name: "Write",
              input: {
                file_path: "/tmp/output.ts",
              },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 1,
          },
        },
      },
    ];

    const timeline = analyzeReasoningChain(new SessionTree(events));
    const skillCall = timeline.find(
      (e) => e.type === "tool_use" && e.toolName === "Skill"
    );
    const writeCall = timeline.find(
      (e) => e.type === "tool_use" && e.toolName === "Write"
    );

    expect(skillCall).toBeDefined();
    expect(skillCall!.content).toContain("skill: brainstorming");

    expect(writeCall).toBeDefined();
    expect(writeCall!.content).toContain("file: output.ts");
  });

  it("normalizes non-string tool_result content into timeline-safe text", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
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
            input_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 1,
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
              content: [{ type: "text", text: "done" }] as unknown as string,
              is_error: false,
            },
          ],
        },
      },
    ];

    const timeline = analyzeReasoningChain(new SessionTree(events));
    const resultEntry = timeline.find((e) => e.type === "tool_result");
    expect(resultEntry).toBeDefined();
    expect(typeof resultEntry!.content).toBe("string");
    expect(resultEntry!.content).toContain("done");
  });

  it("attaches cache-creation ctx spike to assistant actions", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          type: "message",
          role: "assistant",
          content: [
            { type: "text", text: "Working on it" },
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
            cache_creation_input_tokens: 4321,
            cache_read_input_tokens: 0,
            output_tokens: 5,
          },
        },
      },
    ];

    const timeline = analyzeReasoningChain(new SessionTree(events));
    const textEntry = timeline.find((e) => e.type === "text");
    const toolEntry = timeline.find((e) => e.type === "tool_use");

    expect(textEntry).toBeDefined();
    expect(textEntry!.ctxSpikeTokens).toBe(4321);
    expect(toolEntry).toBeDefined();
    expect(toolEntry!.ctxSpikeTokens).toBe(4321);
  });

  it("shortens paths relative to cwd in tool summaries", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
        isSidechain: false,
        cwd: "/Users/me/project",
        message: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "Write",
              input: {
                file_path: "/Users/me/project/src/output/very-long-file.ts",
              },
            },
          ],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 1,
          },
        },
      },
    ];

    const timeline = analyzeReasoningChain(new SessionTree(events));
    const writeCall = timeline.find(
      (e) => e.type === "tool_use" && e.toolName === "Write"
    );
    expect(writeCall).toBeDefined();
    expect(writeCall!.content).toContain("file: src/output/very-long-file.ts");
    expect(writeCall!.content).not.toContain("/Users/me/project/");
  });

});
