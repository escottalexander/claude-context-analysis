import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import chalk from "chalk";

interface HookEvent {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  timestamp?: string;
  [key: string]: unknown;
}

const sessions = new Map<string, HookEvent[]>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // POST /event - receive hook event
  if (req.method === "POST" && url.pathname === "/event") {
    const body = await readBody(req);
    let event: HookEvent;
    try {
      event = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const sessionId = event.session_id ?? "default";
    const existing = sessions.get(sessionId) ?? [];
    existing.push({ ...event, timestamp: event.timestamp ?? new Date().toISOString() });
    sessions.set(sessionId, existing);

    console.log(
      chalk.gray(
        `[${new Date().toLocaleTimeString()}]`
      ) +
        ` ${chalk.cyan(event.tool_name ?? "unknown")} → session ${chalk.yellow(sessionId.slice(0, 8))}` +
        chalk.gray(` (${existing.length} events)`)
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, count: existing.length }));
    return;
  }

  // GET /api/session/:id - get accumulated events
  const sessionMatch = url.pathname.match(/^\/api\/session\/(.+)$/);
  if (req.method === "GET" && sessionMatch) {
    const sessionId = sessionMatch[1];
    const events = sessions.get(sessionId);
    if (!events) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        session_id: sessionId,
        event_count: events.length,
        events,
        tool_summary: summarizeTools(events),
      })
    );
    return;
  }

  // GET /api/sessions - list all sessions
  if (req.method === "GET" && url.pathname === "/api/sessions") {
    const list = [...sessions.entries()].map(([id, evts]) => ({
      session_id: id,
      event_count: evts.length,
      last_event: evts[evts.length - 1]?.timestamp,
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(list));
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

function summarizeTools(
  events: HookEvent[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    const name = e.tool_name ?? "unknown";
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

export function startHookServer(port: number): void {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error(chalk.red("Server error:"), err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    });
  });

  server.listen(port, () => {
    console.log(
      chalk.bold(`\n Hook server listening on `) +
        chalk.cyan(`http://localhost:${port}`) +
        "\n"
    );
    console.log(chalk.gray("  POST /event           - Send hook events"));
    console.log(chalk.gray("  GET  /api/sessions    - List all sessions"));
    console.log(chalk.gray("  GET  /api/session/:id - Get session events\n"));
  });
}
