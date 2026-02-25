import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readSessionBundle } from "../src/parser/jsonl-reader.js";
import { SessionTree } from "../src/parser/session-tree.js";
import { startWebServer } from "../src/web/server.js";

describe("web server", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  it("serves static UI and network/session APIs", async () => {
    const fixturePath = path.join(
      import.meta.dirname,
      "fixtures",
      "small-session.jsonl"
    );
    const events = await readSessionBundle(fixturePath);
    const tree = new SessionTree(events);
    const web = await startWebServer({
      tree,
      events,
      port: 0,
      initialSessionPath: fixturePath,
    });
    cleanups.push(web.close);

    const rootRes = await fetch(`${web.baseUrl}/`);
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers.get("content-type")).toContain("text/html");
    const rootHtml = await rootRes.text();
    expect(rootHtml).toContain("Session Explorer");

    const sessionRes = await fetch(`${web.baseUrl}/api/session`);
    expect(sessionRes.status).toBe(200);
    const sessionJson = (await sessionRes.json()) as {
      sessionId: string;
      totalEvents: number;
    };
    expect(sessionJson.totalEvents).toBeGreaterThan(0);
    expect(sessionJson.sessionId.length).toBeGreaterThan(0);
    expect(typeof sessionJson.sessionKey).toBe("string");

    const networkRes = await fetch(`${web.baseUrl}/api/network`);
    expect(networkRes.status).toBe(200);
    const networkJson = (await networkRes.json()) as {
      scopes: Array<{ id: string }>;
    };
    expect(networkJson.scopes.length).toBeGreaterThan(0);

    const filtersRes = await fetch(`${web.baseUrl}/api/network/filters`);
    expect(filtersRes.status).toBe(200);
    const filters = (await filtersRes.json()) as {
      toolNames: string[];
      statuses: string[];
    };
    expect(filters.toolNames.length).toBeGreaterThan(0);
    expect(filters.statuses).toContain("ok");
  });

  it("lists sessions and supports selecting a session by key", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "cca-web-sessions-"));
    const projectDir = path.join(base, "project-a");
    await mkdir(projectDir, { recursive: true });

    const fixturePath = path.join(
      import.meta.dirname,
      "fixtures",
      "small-session.jsonl"
    );
    const altPath = path.join(projectDir, "alt-session.jsonl");
    await writeFile(
      altPath,
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId: "custom-session",
        timestamp: "2026-01-01T00:00:00.000Z",
        requestId: "req_1",
        isSidechain: false,
        cwd: "/tmp",
        message: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 1,
          },
        },
      }) + "\n",
      "utf8"
    );

    const events = await readSessionBundle(fixturePath);
    const tree = new SessionTree(events);
    const web = await startWebServer({
      tree,
      events,
      port: 0,
      sessionsRootDir: base,
      initialSessionPath: fixturePath,
    });
    cleanups.push(web.close);

    const sessionsRes = await fetch(`${web.baseUrl}/api/sessions`);
    expect(sessionsRes.status).toBe(200);
    const sessions = (await sessionsRes.json()) as Array<{
      sessionKey: string;
      fileName: string;
    }>;
    expect(sessions.length).toBeGreaterThan(0);
    const alt = sessions.find((s) => s.fileName === "alt-session");
    expect(alt).toBeDefined();

    const selectedRes = await fetch(
      `${web.baseUrl}/api/session?session=${encodeURIComponent(alt!.sessionKey)}`
    );
    expect(selectedRes.status).toBe(200);
    const selected = (await selectedRes.json()) as { sessionId: string };
    expect(selected.sessionId).toBe("custom-session");
  });
});
