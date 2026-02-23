import { describe, it, expect } from "vitest";
import { readJsonl } from "../src/parser/jsonl-reader.js";
import { SessionTree } from "../src/parser/session-tree.js";
import { analyzeSkills } from "../src/analyzers/skill-detector.js";
import path from "node:path";

const FIXTURE = path.join(import.meta.dirname, "fixtures/small-session.jsonl");
const SKILL_FIXTURE = path.join(
  import.meta.dirname,
  "fixtures/skill-session.jsonl"
);

describe("analyzeSkills", () => {
  it("returns empty for sessions with no skill/config files", async () => {
    const events = await readJsonl(FIXTURE);
    const tree = new SessionTree(events);
    const result = analyzeSkills(tree);

    expect(result.skillImpacts.length).toBe(0);
  });

  it("detects CLAUDE.md reads", async () => {
    const events = await readJsonl(SKILL_FIXTURE);
    const tree = new SessionTree(events);
    const result = analyzeSkills(tree);

    const claudeMd = result.skillImpacts.find((s) => s.type === "claude-md");
    expect(claudeMd).toBeDefined();
    expect(claudeMd!.filePath).toContain("CLAUDE.md");
    expect(claudeMd!.estimatedTokens).toBeGreaterThan(0);
  });

  it("detects SKILL.md reads", async () => {
    const events = await readJsonl(SKILL_FIXTURE);
    const tree = new SessionTree(events);
    const result = analyzeSkills(tree);

    const skill = result.skillImpacts.find((s) => s.type === "skill");
    expect(skill).toBeDefined();
    expect(skill!.filePath).toContain("SKILL.md");
  });

  it("reports cache creation spikes near skill reads", async () => {
    const events = await readJsonl(SKILL_FIXTURE);
    const tree = new SessionTree(events);
    const result = analyzeSkills(tree);

    // At least one impact should have a cache spike
    const withSpike = result.skillImpacts.filter(
      (s) => s.cacheCreationSpike > 0
    );
    expect(withSpike.length).toBeGreaterThan(0);
  });
});
