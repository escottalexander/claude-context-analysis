import { describe, it, expect } from "vitest";
import { readJsonl } from "../src/parser/jsonl-reader.js";
import { SessionTree } from "../src/parser/session-tree.js";
import { analyzeToolDashboard } from "../src/analyzers/tool-dashboard.js";
import path from "node:path";

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
});
