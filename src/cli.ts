#!/usr/bin/env npx tsx
import { Command } from "commander";
import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import Table from "cli-table3";
import { readJsonl } from "./parser/jsonl-reader.js";
import { SessionTree } from "./parser/session-tree.js";
import { analyzeReasoningChain } from "./analyzers/reasoning-chain.js";
import { analyzeToolDashboard } from "./analyzers/tool-dashboard.js";
import { analyzeContext } from "./analyzers/context-tracker.js";
import { analyzeSkills } from "./analyzers/skill-detector.js";
import {
  renderTimeline,
  renderToolDashboard,
  renderContextTracker,
  renderSkillImpact,
  type TerminalOptions,
} from "./output/terminal.js";
import { buildAnalysisResult, writeJsonSummary } from "./output/json-summary.js";
import { startHookServer } from "./hooks/hook-server.js";

const program = new Command();

program
  .name("cca")
  .description("Claude Code Session Analyzer")
  .version("0.1.0");

program
  .command("analyze")
  .description("Analyze a single JSONL session file")
  .argument("<path>", "Path to the JSONL session file")
  .option("--json", "Output JSON instead of terminal display")
  .option("--output <path>", "Write JSON to a specific file")
  .option("--tool-filter <name>", "Filter tool dashboard by tool name")
  .option("--no-thinking", "Hide thinking blocks in timeline")
  .action(async (filePath: string, opts: Record<string, unknown>) => {
    const events = await readJsonl(filePath);
    if (events.length === 0) {
      console.error(chalk.red("No events found in file."));
      process.exit(1);
    }

    const tree = new SessionTree(events);

    // JSON output mode
    if (opts.json || opts.output) {
      const result = buildAnalysisResult(tree);
      if (opts.output) {
        await writeJsonSummary(result, opts.output as string);
        console.log(chalk.green(`Written to ${opts.output}`));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      return;
    }

    // Terminal output mode
    const termOpts: TerminalOptions = {
      showThinking: opts.thinking !== false,
      toolFilter: (opts.toolFilter as string) ?? null,
    };

    const timeline = analyzeReasoningChain(tree);
    const { toolStats, fileAccess, toolPatterns } = analyzeToolDashboard(tree);
    const { tokenTurns, compactionEvents } = analyzeContext(tree);
    const { skillImpacts } = analyzeSkills(tree);

    const sessionId = tree.getSessionId() ?? "unknown";
    console.log(
      chalk.bold(`\n Session: ${chalk.cyan(sessionId)} (${events.length} events)\n`)
    );

    console.log(renderTimeline(timeline, termOpts));
    console.log(renderToolDashboard(toolStats, fileAccess, toolPatterns, termOpts));
    console.log(renderContextTracker(tokenTurns, compactionEvents));
    const skillOutput = renderSkillImpact(skillImpacts);
    if (skillOutput) console.log(skillOutput);
    console.log();
  });

program
  .command("list")
  .description("Browse all sessions in ~/.claude/projects/")
  .action(async () => {
    const baseDir = join(homedir(), ".claude", "projects");
    let projects: string[];
    try {
      projects = await readdir(baseDir);
    } catch {
      console.error(
        chalk.red(`Cannot read ${baseDir}. Is Claude Code installed?`)
      );
      process.exit(1);
    }

    const sessions: {
      project: string;
      file: string;
      fullPath: string;
      size: number;
      mtime: Date;
    }[] = [];

    for (const project of projects) {
      const projectDir = join(baseDir, project);
      const projectStat = await stat(projectDir).catch(() => null);
      if (!projectStat?.isDirectory()) continue;

      const files = await readdir(projectDir).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const fullPath = join(projectDir, file);
        const fileStat = await stat(fullPath).catch(() => null);
        if (!fileStat) continue;
        sessions.push({
          project,
          file: basename(file, ".jsonl"),
          fullPath,
          size: fileStat.size,
          mtime: fileStat.mtime,
        });
      }
    }

    sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (sessions.length === 0) {
      console.log(chalk.yellow("No sessions found."));
      return;
    }

    const table = new Table({
      head: ["#", "Project", "Session", "Size", "Modified"].map((h) =>
        chalk.bold(h)
      ),
      style: { head: [], border: [] },
    });

    for (let i = 0; i < Math.min(sessions.length, 30); i++) {
      const s = sessions[i];
      table.push([
        String(i + 1),
        shortenProject(s.project),
        s.file.slice(0, 12) + "…",
        formatBytes(s.size),
        s.mtime.toLocaleDateString(),
      ]);
    }

    console.log(chalk.bold(`\n Found ${sessions.length} sessions\n`));
    console.log(table.toString());

    if (sessions.length > 0) {
      console.log(
        chalk.gray(
          `\n  Analyze with: npx tsx src/cli.ts analyze ${sessions[0].fullPath}\n`
        )
      );
    }
  });

program
  .command("serve")
  .description("Start hook receiver server for real-time analysis")
  .option("--port <number>", "Port number", "3456")
  .action(async (opts: { port: string }) => {
    const port = parseInt(opts.port, 10);
    startHookServer(port);
  });

program.parse();

function shortenProject(name: string): string {
  // Project dirs look like -Users-elliott-dev-project
  return name.replace(/^-/, "").replace(/-/g, "/");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
