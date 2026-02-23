import chalk from "chalk";
import Table from "cli-table3";
import type {
  TimelineEntry,
  ToolStats,
  FileAccess,
  ToolPattern,
  TokenTurn,
  CompactionEvent,
  SkillFileImpact,
} from "../types.js";

export interface TerminalOptions {
  showThinking: boolean;
  toolFilter: string | null;
}

export function renderTimeline(
  timeline: TimelineEntry[],
  opts: TerminalOptions
): string {
  const lines: string[] = [chalk.bold.underline("\n Reasoning Chain\n")];

  for (const entry of timeline) {
    if (entry.type === "thinking" && !opts.showThinking) continue;

    const time = chalk.gray(formatTime(entry.timestamp));

    switch (entry.type) {
      case "thinking":
        lines.push(`${time} ${chalk.dim("💭 " + truncate(entry.content, 120))}`);
        break;
      case "text":
        lines.push(`${time} ${chalk.white("💬 " + truncate(entry.content, 120))}`);
        break;
      case "tool_use":
        lines.push(
          `${time} ${chalk.cyan("🔧 " + entry.toolName)} ${chalk.gray(truncate(entry.content.replace(`${entry.toolName}(`, "("), 100))}`
        );
        break;
      case "tool_result":
        if (entry.isError) {
          lines.push(
            `${time} ${chalk.red("❌ " + truncate(entry.content, 120))}`
          );
        } else {
          lines.push(
            `${time} ${chalk.green("✅ " + truncate(entry.content, 120))}`
          );
        }
        break;
    }
  }

  return lines.join("\n");
}

export function renderToolDashboard(
  toolStats: ToolStats[],
  fileAccess: FileAccess[],
  toolPatterns: ToolPattern[],
  opts: TerminalOptions
): string {
  const lines: string[] = [chalk.bold.underline("\n Tool Dashboard\n")];

  // Tool stats table
  const filtered = opts.toolFilter
    ? toolStats.filter(
        (s) => s.name.toLowerCase() === opts.toolFilter!.toLowerCase()
      )
    : toolStats;

  const statsTable = new Table({
    head: ["Tool", "Calls", "Success", "Fail", "Avg Duration"].map((h) =>
      chalk.bold(h)
    ),
    style: { head: [], border: [] },
  });

  for (const s of filtered) {
    statsTable.push([
      chalk.cyan(s.name),
      String(s.count),
      chalk.green(String(s.successes)),
      s.failures > 0 ? chalk.red(String(s.failures)) : "0",
      s.avgDurationMs !== null ? `${s.avgDurationMs}ms` : "-",
    ]);
  }
  lines.push(statsTable.toString());

  // File access
  if (fileAccess.length > 0) {
    lines.push(chalk.bold("\n  Files Accessed\n"));
    const fileTable = new Table({
      head: ["File", "Reads", "Writes", "Edits"].map((h) => chalk.bold(h)),
      style: { head: [], border: [] },
    });
    for (const f of fileAccess.slice(0, 15)) {
      fileTable.push([
        shortenPath(f.path),
        String(f.reads),
        String(f.writes),
        String(f.edits),
      ]);
    }
    lines.push(fileTable.toString());
    if (fileAccess.length > 15) {
      lines.push(chalk.gray(`  ... and ${fileAccess.length - 15} more files`));
    }
  }

  // Patterns
  if (toolPatterns.length > 0) {
    lines.push(chalk.bold("\n  Sequential Patterns\n"));
    for (const p of toolPatterns.slice(0, 10)) {
      lines.push(
        `  ${chalk.yellow(p.sequence.join(" → "))} ${chalk.gray(`(${p.count}x)`)}`
      );
    }
  }

  return lines.join("\n");
}

export function renderContextTracker(
  turns: TokenTurn[],
  compactions: CompactionEvent[]
): string {
  const lines: string[] = [chalk.bold.underline("\n Context Tracker\n")];

  const BAR_WIDTH = 50;

  for (const turn of turns) {
    const pct = turn.percentOfLimit;
    const filled = Math.round((pct / 100) * BAR_WIDTH);
    const bar =
      chalk.blue("█".repeat(Math.min(filled, BAR_WIDTH))) +
      chalk.gray("░".repeat(Math.max(BAR_WIDTH - filled, 0)));

    const label = `T${String(turn.turnIndex).padStart(3)}`;
    const pctStr = `${pct.toFixed(1)}%`.padStart(6);

    const breakdown = chalk.gray(
      `in:${turn.inputTokens} cache+:${turn.cacheCreationTokens} cache~:${turn.cacheReadTokens} out:${turn.outputTokens}`
    );

    lines.push(`  ${label} ${bar} ${pctStr}  ${breakdown}`);
  }

  if (compactions.length > 0) {
    lines.push(chalk.bold.yellow("\n  Compaction Events\n"));
    for (const c of compactions) {
      lines.push(
        `  After turn ${c.afterTurnIndex}: ${chalk.red(String(c.tokensBefore))} → ${chalk.green(String(c.tokensAfter))} (freed ${c.tokensFreed} tokens)`
      );
    }
  }

  if (turns.length > 0) {
    const peak = Math.max(...turns.map((t) => t.totalTokens));
    const totalOut = turns.reduce((s, t) => s + t.outputTokens, 0);
    lines.push(
      chalk.gray(
        `\n  Peak: ${peak.toLocaleString()} tokens | Total output: ${totalOut.toLocaleString()} tokens`
      )
    );
  }

  return lines.join("\n");
}

export function renderSkillImpact(impacts: SkillFileImpact[]): string {
  if (impacts.length === 0) return "";

  const lines: string[] = [chalk.bold.underline("\n Skill/Config Impact\n")];

  const table = new Table({
    head: ["File", "Type", "Est. Tokens", "Cache Spike"].map((h) =>
      chalk.bold(h)
    ),
    style: { head: [], border: [] },
  });

  for (const impact of impacts) {
    table.push([
      shortenPath(impact.filePath),
      chalk.magenta(impact.type),
      impact.estimatedTokens.toLocaleString(),
      impact.cacheCreationSpike > 0
        ? chalk.yellow(impact.cacheCreationSpike.toLocaleString())
        : chalk.gray("-"),
    ]);
  }

  lines.push(table.toString());
  return lines.join("\n");
}

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString("en-US", { hour12: false });
  } catch {
    return timestamp;
  }
}

function truncate(str: string, max: number): string {
  const oneLine = str.replace(/\n/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max) + "…";
}

function shortenPath(filePath: string): string {
  const home = process.env.HOME ?? "";
  if (home && filePath.startsWith(home)) {
    return "~" + filePath.slice(home.length);
  }
  // Show last 3 segments
  const parts = filePath.split("/");
  if (parts.length > 3) {
    return "…/" + parts.slice(-3).join("/");
  }
  return filePath;
}
