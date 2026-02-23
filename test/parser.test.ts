import { describe, it, expect } from "vitest";
import { readJsonl } from "../src/parser/jsonl-reader.js";
import path from "node:path";

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
