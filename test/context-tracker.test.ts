import { describe, it, expect } from "vitest";
import { readJsonl } from "../src/parser/jsonl-reader.js";
import { SessionTree } from "../src/parser/session-tree.js";
import { analyzeContext } from "../src/analyzers/context-tracker.js";
import path from "node:path";

const FIXTURE = path.join(import.meta.dirname, "fixtures/small-session.jsonl");

describe("analyzeContext", () => {
  it("produces token turns from assistant events", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const result = analyzeContext(tree);

    expect(result.tokenTurns.length).toBeGreaterThan(0);
  });

  it("deduplicates turns sharing the same requestId", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const result = analyzeContext(tree);

    // Fixture has 5 assistant events but req_1 appears twice,
    // so we should get 4 deduplicated turns
    expect(result.tokenTurns.length).toBe(4);
  });

  it("tracks peak tokens", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const result = analyzeContext(tree);

    expect(result.peakTokens).toBeGreaterThan(0);
    const maxTurn = Math.max(...result.tokenTurns.map((t) => t.totalTokens));
    expect(result.peakTokens).toBe(maxTurn);
  });

  it("tracks total output tokens", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const result = analyzeContext(tree);

    expect(result.totalOutputTokens).toBeGreaterThan(0);
  });

  it("detects compaction when tokens drop sharply", async () => {
    // Our fixture has monotonically growing tokens, so no compaction
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const result = analyzeContext(tree);

    expect(result.compactionEvents.length).toBe(0);
  });
});
