import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { SessionEvent } from "../types.js";
import type { SessionTree } from "../parser/session-tree.js";
import { analyzeNetworkTab } from "../analyzers/network-tab.js";
import { analyzeReasoningChain } from "../analyzers/reasoning-chain.js";
import { analyzeToolDashboard } from "../analyzers/tool-dashboard.js";
import { analyzeContext } from "../analyzers/context-tracker.js";
import { analyzeSkills } from "../analyzers/skill-detector.js";
import { readSessionBundle } from "../parser/jsonl-reader.js";
import { SessionTree as BuiltSessionTree } from "../parser/session-tree.js";

export interface StartWebServerOptions {
  tree?: SessionTree;
  events?: SessionEvent[];
  port?: number;
  sessionsRootDir?: string;
  initialSessionPath?: string;
}

export interface RunningWebServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startWebServer(
  options: StartWebServerOptions
): Promise<RunningWebServer> {
  const {
    tree,
    events,
    port = 0,
    sessionsRootDir = join(homedir(), ".claude", "projects"),
    initialSessionPath,
  } = options;

  let catalog = await discoverSessions(sessionsRootDir);
  let catalogTimestamp = Date.now();
  const CATALOG_TTL_MS = 5000;
  const cache = new Map<string, { mtimeMs: number; analysis: Awaited<ReturnType<typeof analyzeSessionPath>> }>();

  if (tree && events && initialSessionPath) {
    const key = sessionKeyFromPath(initialSessionPath);
    const fileStat = await stat(initialSessionPath).catch(() => null);
    cache.set(key, { mtimeMs: fileStat?.mtimeMs ?? 0, analysis: analyzeSessionFromTree(tree, events, initialSessionPath) });
    if (!catalog.some((entry) => entry.sessionKey === key)) {
      catalog.unshift(sessionEntryFromPath(initialSessionPath, key));
    }
  } else if (tree && events && !initialSessionPath) {
    const syntheticPath = "in-memory-session.jsonl";
    const key = sessionKeyFromPath(syntheticPath);
    cache.set(key, { mtimeMs: 0, analysis: analyzeSessionFromTree(tree, events, syntheticPath) });
    catalog.unshift(sessionEntryFromPath(syntheticPath, key));
  } else if (initialSessionPath) {
    const key = sessionKeyFromPath(initialSessionPath);
    if (!catalog.some((entry) => entry.sessionKey === key)) {
      catalog.unshift(sessionEntryFromPath(initialSessionPath, key));
    }
  }

  const publicDir = join(fileURLToPath(new URL(".", import.meta.url)), "public");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const selectedKey = resolveSessionKey(url.searchParams.get("session"), catalog);
    if (!selectedKey && url.pathname.startsWith("/api/")) {
      return json(res, 404, { error: "No sessions available" });
    }

    if (url.pathname === "/api/sessions") {
      if (Date.now() - catalogTimestamp > CATALOG_TTL_MS) {
        catalog = await discoverSessions(sessionsRootDir);
        catalogTimestamp = Date.now();
      }
      return json(res, 200, catalog);
    }

    const analysis = selectedKey
      ? await getAnalysis(selectedKey, cache, catalog)
      : null;
    if (url.pathname.startsWith("/api/") && !analysis) {
      return json(res, 404, { error: "Session not found" });
    }

    if (url.pathname === "/api/session") {
      return json(res, 200, {
        sessionKey: selectedKey,
        sessionPath: analysis!.sessionPath,
        sessionId: analysis!.sessionId,
        totalEvents: analysis!.events.length,
        timeline: analysis!.timeline,
        toolStats: analysis!.toolStats,
        fileAccess: analysis!.fileAccess,
        toolPatterns: analysis!.toolPatterns,
        tokenTurns: analysis!.tokenTurns,
        compactionEvents: analysis!.compactionEvents,
        skillImpacts: analysis!.skillImpacts,
      });
    }

    if (url.pathname === "/api/network") {
      return json(res, 200, { scopes: analysis!.network.scopes });
    }

    if (url.pathname === "/api/network/filters") {
      const toolNames = new Set<string>();
      const statuses = new Set<string>();
      for (const scope of analysis!.network.scopes) {
        for (const req of scope.requests) {
          toolNames.add(req.toolName);
          statuses.add(req.isError ? "error" : "ok");
        }
      }
      if (statuses.size === 0) statuses.add("ok");
      return json(res, 200, {
        toolNames: [...toolNames].sort((a, b) => a.localeCompare(b)),
        statuses: [...statuses].sort((a, b) => a.localeCompare(b)),
      });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveFile(res, join(publicDir, "index.html"));
    }
    if (url.pathname === "/app.js") {
      return serveFile(res, join(publicDir, "app.js"));
    }
    if (url.pathname === "/styles.css") {
      return serveFile(res, join(publicDir, "styles.css"));
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    baseUrl: `http://127.0.0.1:${actualPort}`,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}

function json(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function serveFile(
  res: import("node:http").ServerResponse,
  filePath: string
): Promise<void> {
  try {
    const content = await readFile(filePath, "utf8");
    res.writeHead(200, { "content-type": getContentType(filePath) });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function getContentType(filePath: string): string {
  const ext = extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function sessionKeyFromPath(filePath: string): string {
  return Buffer.from(filePath).toString("base64url");
}

function sessionEntryFromPath(filePath: string, sessionKey: string) {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1]?.replace(/\.jsonl$/, "") ?? filePath;
  const projectName = parts[parts.length - 2] ?? "";
  return {
    sessionKey,
    fileName,
    projectName,
    fullPath: filePath,
  };
}

async function discoverSessions(rootDir: string): Promise<
  Array<{
    sessionKey: string;
    fileName: string;
    projectName: string;
    fullPath: string;
    mtimeMs?: number;
  }>
> {
  const projects = await readdir(rootDir).catch(() => []);
  const entries: Array<{
    sessionKey: string;
    fileName: string;
    projectName: string;
    fullPath: string;
    mtimeMs?: number;
  }> = [];

  for (const project of projects) {
    const projectPath = join(rootDir, project);
    const projectStat = await stat(projectPath).catch(() => null);
    if (!projectStat?.isDirectory()) continue;
    const files = await readdir(projectPath).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const fullPath = join(projectPath, file);
      const fileStat = await stat(fullPath).catch(() => null);
      entries.push({
        sessionKey: sessionKeyFromPath(fullPath),
        fileName: file.replace(/\.jsonl$/, ""),
        projectName: project,
        fullPath,
        mtimeMs: fileStat?.mtimeMs,
      });
    }
  }

  return entries
    .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
    .map(({ mtimeMs: _mtimeMs, ...rest }) => rest);
}

function resolveSessionKey(
  requestedKey: string | null,
  catalog: Array<{ sessionKey: string }>
): string | null {
  if (requestedKey && catalog.some((entry) => entry.sessionKey === requestedKey)) {
    return requestedKey;
  }
  return catalog[0]?.sessionKey ?? null;
}

async function getAnalysis(
  key: string,
  cache: Map<string, { mtimeMs: number; analysis: Awaited<ReturnType<typeof analyzeSessionPath>> }>,
  catalog: Array<{ sessionKey: string; fullPath: string }>
) {
  const entry = catalog.find((item) => item.sessionKey === key);
  if (!entry) return null;
  const existing = cache.get(key);
  if (existing) {
    const fileStat = await stat(entry.fullPath).catch(() => null);
    if (fileStat && fileStat.mtimeMs > existing.mtimeMs) {
      const analyzed = await analyzeSessionPath(entry.fullPath);
      cache.set(key, { mtimeMs: fileStat.mtimeMs, analysis: analyzed });
      return analyzed;
    }
    return existing.analysis;
  }
  const fileStat = await stat(entry.fullPath).catch(() => null);
  const analyzed = await analyzeSessionPath(entry.fullPath);
  cache.set(key, { mtimeMs: fileStat?.mtimeMs ?? 0, analysis: analyzed });
  return analyzed;
}

async function analyzeSessionPath(fullPath: string) {
  const events = await readSessionBundle(fullPath);
  const tree = new BuiltSessionTree(events);
  return analyzeSessionFromTree(tree, events, fullPath);
}

function analyzeSessionFromTree(
  tree: SessionTree,
  events: SessionEvent[],
  sessionPath: string
) {
  const network = analyzeNetworkTab(tree);
  const timeline = analyzeReasoningChain(tree);
  const { toolStats, fileAccess, toolPatterns } = analyzeToolDashboard(tree);
  const { tokenTurns, compactionEvents } = analyzeContext(tree);
  const { skillImpacts } = analyzeSkills(tree);
  const sessionId = tree.getSessionId() ?? "unknown";
  return {
    sessionPath,
    sessionId,
    events,
    network,
    timeline,
    toolStats,
    fileAccess,
    toolPatterns,
    tokenTurns,
    compactionEvents,
    skillImpacts,
  };
}
