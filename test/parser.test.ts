import { describe, it, expect } from "vitest";
import { readJsonl, readSessionBundle } from "../src/parser/jsonl-reader.js";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const FIXTURE = path.join(import.meta.dirname, "fixtures/small-session.jsonl");

describe("readJsonl", () => {
  it("parses all events from a JSONL file", async () => {
    const events = await readJsonl(FIXTURE);
    expect(events.length).toBe(9);
  });

  it("identifies correct event types", async () => {
    const events = await readJsonl(FIXTURE);
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "file-history-snapshot",
      "user",
      "assistant",
      "assistant",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("preserves parentUuid chain", async () => {
    const events = await readJsonl(FIXTURE);
    const userEvent = events.find(
      (e) => e.type === "user" && "uuid" in e && e.uuid === "u1"
    );
    expect(userEvent).toBeDefined();
    if (userEvent && "parentUuid" in userEvent) {
      expect(userEvent.parentUuid).toBeNull();
    }

    const assistantEvent = events.find(
      (e) => e.type === "assistant" && "uuid" in e && e.uuid === "a1"
    );
    expect(assistantEvent).toBeDefined();
    if (assistantEvent && "parentUuid" in assistantEvent) {
      expect(assistantEvent.parentUuid).toBe("u1");
    }
  });

  it("extracts usage data from assistant events", async () => {
    const events = await readJsonl(FIXTURE);
    const assistant = events.find(
      (e) => e.type === "assistant" && "uuid" in e && e.uuid === "a1"
    );
    expect(assistant).toBeDefined();
    if (assistant && assistant.type === "assistant") {
      expect(assistant.message.usage.input_tokens).toBe(100);
      expect(assistant.message.usage.cache_creation_input_tokens).toBe(500);
    }
  });
});

describe("readSessionBundle", () => {
  it("loads main session plus subagent jsonl files", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "cca-bundle-"));
    const sessionId = "session-1";
    const mainPath = path.join(baseDir, `${sessionId}.jsonl`);
    const subagentsDir = path.join(baseDir, sessionId, "subagents");
    await mkdir(subagentsDir, { recursive: true });

    await writeFile(
      mainPath,
      [
        JSON.stringify({
          type: "user",
          uuid: "u-main",
          parentUuid: null,
          sessionId,
          timestamp: "2026-01-01T00:00:00.000Z",
          message: { role: "user", content: "hi" },
          isSidechain: false,
          cwd: "/tmp",
        }),
      ].join("\n"),
      "utf-8"
    );

    await writeFile(
      path.join(subagentsDir, "agent-a1.jsonl"),
      [
        JSON.stringify({
          type: "assistant",
          uuid: "a-side",
          parentUuid: "u-main",
          sessionId,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "hello from subagent" }],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 1,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 1,
            },
          },
          isSidechain: true,
          cwd: "/tmp",
        }),
      ].join("\n"),
      "utf-8"
    );

    const events = await readSessionBundle(mainPath);
    expect(events.length).toBe(2);
    expect(events.some((e) => "uuid" in e && e.uuid === "u-main")).toBe(true);
    expect(events.some((e) => "uuid" in e && e.uuid === "a-side")).toBe(true);
  });
});
