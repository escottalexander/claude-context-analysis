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

function getTermWidth(): number {
  return process.stdout.columns || 100;
}

export function renderTimeline(
  timeline: TimelineEntry[],
  opts: TerminalOptions
): string {
  const lines: string[] = [
    chalk.bold.underline("\n Reasoning Chain\n"),
    chalk.gray("  Legend: ┌─ group start, │ shared action, └─ group end/context"),
  ];
  // 10 chars for timestamp + space + icon + space = ~15 overhead
  const contentMax = Math.max(40, getTermWidth() - 16);
  const visibleTimeline = timeline.filter(
    (entry) => !(entry.type === "thinking" && !opts.showThinking)
  );

  for (let i = 0; i < visibleTimeline.length; i++) {
    const entry = visibleTimeline[i];
    const time = chalk.gray(formatTime(entry.timestamp));
    const connector = getCtxConnector(visibleTimeline, i);
    const prefix = `${time} ${chalk.gray(connector)} `;
    const baseMax = Math.max(20, contentMax - 3);

    switch (entry.type) {
      case "thinking":
        lines.push(
          `${prefix}${chalk.dim("💭 " + truncate(entry.content, baseMax))}`
        );
        break;
      case "text":
        lines.push(
          `${prefix}${chalk.white("💬 " + truncate(entry.content, baseMax))}`
        );
        break;
      case "tool_use": {
        const nameLen = (entry.toolName ?? "").length + 3; // icon + space + name + space
        const inputMax = Math.max(20, baseMax - nameLen);
        lines.push(
          `${prefix}${chalk.cyan("🔧 " + entry.toolName)} ${chalk.gray(truncate(entry.content.replace(`${entry.toolName}(`, "("), inputMax))}`
        );
        break;
      }
      case "tool_result":
        if (entry.isError) {
          lines.push(
            `${prefix}${chalk.red("❌ " + truncate(entry.content, baseMax))}`
          );
        } else {
          lines.push(
            `${prefix}${chalk.green("✅ " + truncate(entry.content, baseMax))}`
          );
        }
        break;
    }

    const ctxLine = formatCtxGroupLine(visibleTimeline, i);
    if (ctxLine) {
      lines.push(`${time} ${chalk.gray("└─")} ${ctxLine}`);
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
  const termWidth = getTermWidth();

  // Tool stats table — fixed-width columns, always fits
  const filtered = opts.toolFilter
    ? toolStats.filter(
        (s) => s.name.toLowerCase() === opts.toolFilter!.toLowerCase()
      )
    : toolStats;

  const statsTable = new Table({
    head: ["Tool", "Calls", "Success", "Fail", "Avg Duration", "Tokens"].map((h) =>
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
      s.attributedTotalTokens > 0
        ? s.attributedTotalTokens.toLocaleString()
        : "-",
    ]);
  }
  lines.push(statsTable.toString());

  // File access — constrain file column to fit terminal
  if (fileAccess.length > 0) {
    lines.push(chalk.bold("\n  Files Accessed\n"));
    // 3 numeric cols ~7 chars each + borders ~20 chars
    const fileColWidth = Math.max(20, termWidth - 42);
    const fileTable = new Table({
      head: ["File", "Reads", "Writes", "Edits"].map((h) => chalk.bold(h)),
      style: { head: [], border: [] },
      colWidths: [fileColWidth, null, null, null],
      wordWrap: true,
    });
    for (const f of fileAccess.slice(0, 15)) {
      fileTable.push([
        shortenPath(f.path, fileColWidth - 2),
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
  const termWidth = getTermWidth();

  // Scale bar to fit: label(6) + space + bar + space + pct(6) + space + breakdown(~55) + pad(4)
  const breakdownWidth = 55;
  const fixedWidth = 6 + 1 + 1 + 6 + 2 + breakdownWidth + 4;
  const barWidth = Math.max(10, Math.min(50, termWidth - fixedWidth));

  for (const turn of turns) {
    const pct = turn.percentOfLimit;
    const filled = Math.round((pct / 100) * barWidth);
    const bar =
      chalk.blue("█".repeat(Math.min(filled, barWidth))) +
      chalk.gray("░".repeat(Math.max(barWidth - filled, 0)));

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
  const termWidth = getTermWidth();

  // Type(~12) + Est.Tokens(~14) + Cache Spike(~14) + borders(~20)
  const fileColWidth = Math.max(20, termWidth - 60);
  const table = new Table({
    head: ["File", "Type", "Est. Tokens", "Cache Spike"].map((h) =>
      chalk.bold(h)
    ),
    style: { head: [], border: [] },
    colWidths: [fileColWidth, null, null, null],
    wordWrap: true,
  });

  for (const impact of impacts) {
    table.push([
      shortenPath(impact.filePath, fileColWidth - 2),
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

// Also export for use by cli.ts session tables
export function renderSessionTable(
  rows: { index: number; project: string; session: string; size: string; modified: string }[]
): string {
  const termWidth = getTermWidth();
  // #(4) + Session(16) + Size(10) + Modified(12) + borders(~22)
  const projectColWidth = Math.max(15, termWidth - 64);

  const table = new Table({
    head: ["#", "Project", "Session", "Size", "Modified"].map((h) =>
      chalk.bold(h)
    ),
    style: { head: [], border: [] },
    colWidths: [4, projectColWidth, 16, 10, 12],
    wordWrap: true,
  });

  for (const r of rows) {
    table.push([
      String(r.index),
      truncate(r.project, projectColWidth - 2),
      r.session,
      r.size,
      r.modified,
    ]);
  }

  return table.toString();
}

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString("en-US", { hour12: false });
  } catch {
    return timestamp;
  }
}

function truncate(value: unknown, max: number): string {
  const str = stringifyForDisplay(value);
  const oneLine = str.replace(/\n/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max) + "…";
}

function shortenPath(filePath: string, maxLen: number = 50): string {
  const home = process.env.HOME ?? "";
  let shortened = filePath;
  if (home && shortened.startsWith(home)) {
    shortened = "~" + shortened.slice(home.length);
  }
  if (shortened.length <= maxLen) return shortened;

  // Progressively trim from the left, keeping the filename
  const parts = shortened.split("/");
  if (parts.length <= 2) return truncate(shortened, maxLen);

  // Always keep the last 2 segments (parent dir + filename)
  const tail = parts.slice(-2).join("/");
  if (tail.length + 2 >= maxLen) return truncate(tail, maxLen);

  return "…/" + tail;
}

function stringifyForDisplay(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((v) => stringifyForDisplay(v)).join(" ");
  }
  if (typeof value === "object") {
    if (
      "text" in value &&
      typeof (value as { text?: unknown }).text === "string"
    ) {
      return (value as { text: string }).text;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function getCtxConnector(timeline: TimelineEntry[], index: number): string {
  const entry = timeline[index];
  const turnId = entry.assistantTurnId;
  if (!turnId || (entry.ctxSpikeTokens ?? 0) <= 0) return "  ";

  const prev = timeline[index - 1];
  const next = timeline[index + 1];
  const samePrev = prev?.assistantTurnId === turnId;
  const sameNext = next?.assistantTurnId === turnId;

  if (!samePrev && sameNext) return "┌─";
  if (samePrev && sameNext) return "│ ";
  if (samePrev && !sameNext) return "└─";
  return "  ";
}

function formatCtxGroupLine(
  timeline: TimelineEntry[],
  index: number
): string | null {
  const entry = timeline[index];
  if ((entry.ctxSpikeTokens ?? 0) <= 0) return null;

  const turnId = entry.assistantTurnId;
  if (!turnId) {
    return chalk.yellow(`ctx+${entry.ctxSpikeTokens!.toLocaleString()}`);
  }

  const next = timeline[index + 1];
  const isGroupEnd = next?.assistantTurnId !== turnId;
  if (!isGroupEnd) return null;

  const size = countContiguousCtxGroupSize(timeline, index, turnId);
  const sharedText = size > 1 ? chalk.gray(` (shared by ${size} lines)`) : "";
  return chalk.yellow(`ctx+${entry.ctxSpikeTokens!.toLocaleString()}`) + sharedText;
}

function countContiguousCtxGroupSize(
  timeline: TimelineEntry[],
  endIndex: number,
  turnId: string
): number {
  let count = 0;
  for (let i = endIndex; i >= 0; i--) {
    const entry = timeline[i];
    if (entry.assistantTurnId !== turnId || (entry.ctxSpikeTokens ?? 0) <= 0) {
      break;
    }
    count++;
  }
  return count;
}
