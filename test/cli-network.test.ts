import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

describe("cli network command", () => {
  it("registers the network command", () => {
    const cliPath = path.join(import.meta.dirname, "..", "src", "cli.ts");
    const helpOutput = execSync(`npx tsx "${cliPath}" --help`, {
      encoding: "utf8",
    });
    expect(helpOutput).toContain("network");
  });

  it("runs network command with a fixture path", () => {
    const cliPath = path.join(import.meta.dirname, "..", "src", "cli.ts");
    const fixturePath = path.join(
      import.meta.dirname,
      "fixtures",
      "small-session.jsonl"
    );
    const output = execSync(`npx tsx "${cliPath}" network "${fixturePath}"`, {
      encoding: "utf8",
    });
    expect(output).toContain("Network View");
    expect(output).toContain("Time");
    expect(output).toContain("Ctx+");
  });
});
