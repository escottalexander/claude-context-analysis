import { createReadStream } from "node:fs";
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
