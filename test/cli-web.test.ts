import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";

describe("cli web command", () => {
  it("registers the web command", () => {
    const cliPath = path.join(import.meta.dirname, "..", "src", "cli.ts");
    const helpOutput = execSync(`npx tsx "${cliPath}" --help`, {
      encoding: "utf8",
    });
    expect(helpOutput).toContain("web");
  });

  it("sets npm start default to web mode", () => {
    const packagePath = path.join(import.meta.dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.start).toContain("web");
  });
});
