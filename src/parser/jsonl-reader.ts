import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { SessionEvent } from "../types.js";

const VALID_TYPES = new Set([
  "user",
  "assistant",
  "system",
  "progress",
  "file-history-snapshot",
]);

function isSessionEvent(obj: unknown): obj is SessionEvent {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "type" in obj &&
    VALID_TYPES.has((obj as { type: string }).type)
  );
}

export async function readJsonl(filePath: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isSessionEvent(parsed)) {
        events.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

export async function readSessionBundle(filePath: string): Promise<SessionEvent[]> {
  const mainEvents = await readJsonl(filePath);
  const sidechainPaths = await discoverSidechainJsonls(filePath);

  if (sidechainPaths.length === 0) {
    return mainEvents;
  }

  const sidechainLists = await Promise.all(
    sidechainPaths.map((sidechainPath) => readJsonl(sidechainPath))
  );

  return [...mainEvents, ...sidechainLists.flat()];
}

async function discoverSidechainJsonls(filePath: string): Promise<string[]> {
  const parsed = path.parse(filePath);
  if (parsed.ext !== ".jsonl") return [];

  const bundleDir = path.join(parsed.dir, parsed.name);
  const subagentsDir = path.join(bundleDir, "subagents");
  const subagentStat = await stat(subagentsDir).catch(() => null);
  if (!subagentStat?.isDirectory()) return [];

  const entries = await readdir(subagentsDir).catch(() => []);
  return entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .map((entry) => path.join(subagentsDir, entry));
}
