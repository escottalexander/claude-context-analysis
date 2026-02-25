#!/usr/bin/env npx tsx
import { Command } from "commander";
import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { readSessionBundle } from "./parser/jsonl-reader.js";
import { SessionTree } from "./parser/session-tree.js";
import { analyzeReasoningChain } from "./analyzers/reasoning-chain.js";
import { analyzeToolDashboard } from "./analyzers/tool-dashboard.js";
import { analyzeContext } from "./analyzers/context-tracker.js";
import { analyzeSkills } from "./analyzers/skill-detector.js";
import { analyzeNetworkTab } from "./analyzers/network-tab.js";
import {
  renderTimeline,
  renderToolDashboard,
  renderContextTracker,
  renderSkillImpact,
  renderSessionTable,
  type TerminalOptions,
} from "./output/terminal.js";
import {
  createNetworkState,
  reduceNetworkState,
  type NetworkState,
} from "./output/network-state.js";
import { renderNetworkFrame } from "./output/network-tui.js";
import { buildAnalysisResult, writeJsonSummary } from "./output/json-summary.js";
import { startHookServer } from "./hooks/hook-server.js";

const program = new Command();

program
  .name("cca")
  .description("Claude Code Session Analyzer")
  .version("0.1.0");

// --- Shared session discovery ---

interface SessionInfo {
  project: string;
  file: string;
  fullPath: string;
  size: number;
  mtime: Date;
}

async function discoverSessions(): Promise<SessionInfo[]> {
  const baseDir = join(homedir(), ".claude", "projects");
  let projects: string[];
  try {
    projects = await readdir(baseDir);
  } catch {
    return [];
  }

  const sessions: SessionInfo[] = [];

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
  return sessions;
}

async function promptSessionPicker(): Promise<string> {
  const sessions = await discoverSessions();
  if (sessions.length === 0) {
    console.error(chalk.red("No sessions found in ~/.claude/projects/"));
    process.exit(1);
  }

  const shown = sessions.slice(0, 30);
  const rows = shown.map((s, i) => ({
    index: i + 1,
    project: shortenProject(s.project),
    session: s.file.slice(0, 12) + "…",
    size: formatBytes(s.size),
    modified: s.mtime.toLocaleDateString(),
  }));

  console.log(chalk.bold(`\n Found ${sessions.length} sessions\n`));
  console.log(renderSessionTable(rows));

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.bold("\n  Select session number: "), resolve);
  });
  rl.close();

  const index = parseInt(answer, 10) - 1;
  if (isNaN(index) || index < 0 || index >= shown.length) {
    console.error(chalk.red(`Invalid selection: ${answer}`));
    process.exit(1);
  }

  return shown[index].fullPath;
}

// --- Commands ---

program
  .command("analyze")
  .description("Analyze a JSONL session file (prompts for selection if no path given)")
  .argument("[path]", "Path to the JSONL session file")
  .option("--json", "Output JSON instead of terminal display")
  .option("--output <path>", "Write JSON to a specific file")
  .option("--tool-filter <name>", "Filter tool dashboard by tool name")
  .option("--no-thinking", "Hide thinking blocks in timeline")
  .action(async (filePath: string | undefined, opts: Record<string, unknown>) => {
    if (!filePath) {
      filePath = await promptSessionPicker();
    }

    const events = await readSessionBundle(filePath);
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
    const sessions = await discoverSessions();

    if (sessions.length === 0) {
      console.log(chalk.yellow("No sessions found."));
      return;
    }

    const shown = sessions.slice(0, 30);
    const rows = shown.map((s, i) => ({
      index: i + 1,
      project: shortenProject(s.project),
      session: s.file.slice(0, 12) + "…",
      size: formatBytes(s.size),
      modified: s.mtime.toLocaleDateString(),
    }));

    console.log(chalk.bold(`\n Found ${sessions.length} sessions\n`));
    console.log(renderSessionTable(rows));

    if (sessions.length > 0) {
      console.log(
        chalk.gray(`\n  Analyze a session: npx tsx src/cli.ts analyze\n`)
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

program
  .command("network")
  .description("Interactive network-tab style request inspector")
  .argument("[path]", "Path to the JSONL session file")
  .action(async (filePath?: string) => {
    if (!filePath) {
      filePath = await promptSessionPicker();
    }

    const events = await readJsonl(filePath);
    if (events.length === 0) {
      console.error(chalk.red("No events found in file."));
      process.exit(1);
    }

    const tree = new SessionTree(events);
    const network = analyzeNetworkTab(tree);
    let state = createNetworkState(network.scopes.map((scope) => scope.id));
    const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

    const render = (currentState: NetworkState): void => {
      const frame = renderNetworkFrame({ scopes: network.scopes, state: currentState });
      process.stdout.write("\x1Bc");
      process.stdout.write(
        `${chalk.bold("Network View")}  ${chalk.gray("←/→ scope  ↑/↓ rows  Enter details  Esc close  q quit")}\n\n`
      );
      process.stdout.write(frame + "\n");
    };

    if (!isInteractive) {
      render(state);
      return;
    }

    render(state);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const cleanUp = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onKeypress);
      process.stdout.write("\n");
    };

    const onKeypress = (chunk: string): void => {
      const activeScope = network.scopes.find((scope) => scope.id === state.activeScopeId);
      const maxIndex = Math.max(0, (activeScope?.requests.length ?? 1) - 1);

      if (chunk === "q" || chunk === "\u0003") {
        state = reduceNetworkState(state, { type: "quit" });
      } else if (chunk === "\u001b[C") {
        state = reduceNetworkState(state, { type: "next-scope" });
      } else if (chunk === "\u001b[D") {
        state = reduceNetworkState(state, { type: "prev-scope" });
      } else if (chunk === "\u001b[A") {
        state = reduceNetworkState(state, { type: "move-up" });
      } else if (chunk === "\u001b[B") {
        state = reduceNetworkState(state, { type: "move-down", maxIndex });
      } else if (chunk === "\r") {
        state = reduceNetworkState(state, { type: "open-detail" });
      } else if (chunk === "\u001b") {
        state = reduceNetworkState(state, { type: "close-detail" });
      } else {
        return;
      }

      if (state.shouldQuit) {
        cleanUp();
        return;
      }
      render(state);
    };

    process.stdin.on("data", onKeypress);
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        process.stdin.removeListener("data", exitListener);
        resolve();
      };
      const exitListener = (chunk: string): void => {
        if (chunk === "q" || chunk === "\u0003") {
          finish();
        }
      };
      process.stdin.on("data", exitListener);
    });
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
