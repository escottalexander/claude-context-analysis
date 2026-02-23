import { describe, it, expect } from "vitest";
import { readJsonl } from "../src/parser/jsonl-reader.js";
import { SessionTree } from "../src/parser/session-tree.js";
import { analyzeReasoningChain } from "../src/analyzers/reasoning-chain.js";
import path from "node:path";

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
});
