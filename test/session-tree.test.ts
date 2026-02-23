import { describe, it, expect } from "vitest";
import { readJsonl } from "../src/parser/jsonl-reader.js";
import { SessionTree } from "../src/parser/session-tree.js";
import path from "node:path";

const FIXTURE = path.join(import.meta.dirname, "fixtures/small-session.jsonl");

describe("SessionTree", () => {
  it("builds tree with correct roots", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const roots = tree.getRoots();
    // file-history-snapshot has no uuid, so root is u1 (parentUuid: null)
    expect(roots.length).toBe(1);
    expect((roots[0] as any).uuid).toBe("u1");
  });

  it("returns events in chronological order", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const chrono = tree.getChronologicalEvents();
    for (let i = 1; i < chrono.length; i++) {
      const prev = "timestamp" in chrono[i - 1] ? chrono[i - 1].timestamp : "";
      const curr = "timestamp" in chrono[i] ? chrono[i].timestamp : "";
      expect(prev <= curr).toBe(true);
    }
  });

  it("pairs tool_use with tool_result", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const pairs = tree.getToolPairs();
    expect(pairs.length).toBe(2);

    expect(pairs[0].toolUse.name).toBe("Read");
    expect(pairs[0].toolUse.id).toBe("tool_1");
    expect(pairs[0].toolResult).not.toBeNull();
    expect(pairs[0].toolResult!.tool_use_id).toBe("tool_1");

    expect(pairs[1].toolUse.name).toBe("Edit");
    expect(pairs[1].toolUse.id).toBe("tool_2");
    expect(pairs[1].toolResult).not.toBeNull();
  });

  it("extracts session ID", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    expect(tree.getSessionId()).toBe("test-session");
  });

  it("returns children of a node", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const children = tree.getChildren("u1");
    expect(children.length).toBe(1);
    expect((children[0] as any).uuid).toBe("a1");
  });

  it("filters assistant and user events", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    expect(tree.getAssistantEvents().length).toBe(5);
    expect(tree.getUserEvents().length).toBe(3);
  });
});
