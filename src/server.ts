import Fastify from "fastify";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { z } from "zod";
import type { AgentTraceEvent } from "./agent/graph.js";
import { runAgent } from "./agent/graph.js";
import type { Evidence } from "./agent/state.js";
import { assertLocalhostOnly, assertPrivacyDefaults, config } from "./config.js";
import { appendChatTurn, buildFollowupQueryFromSession, getChatSession, listChatSessions } from "./history/store.js";
import type { SourceReference } from "./history/store.js";
import { ingestDocuments, readIngestManifest } from "./ingest/service.js";
import { APP_PAGE_HTML } from "./ui/page.js";

assertPrivacyDefaults();
assertLocalhostOnly(config.LLAMA_CHAT_BASE_URL);
assertLocalhostOnly(config.LLAMA_EMBED_BASE_URL);
assertLocalhostOnly(config.CHROMA_URL);
assertLocalhostOnly(config.LOCAL_WEB_INDEX_URL);

const server = Fastify({ logger: true });

const AskSchema = z.object({
  query: z.string().min(3)
});

const ChatSchema = z.object({
  query: z.string().min(3),
  sessionId: z.string().uuid().nullable().optional(),
  followUp: z.boolean().default(false)
});

const IngestSchema = z.object({
  folderPath: z.string().min(1)
});
const DocumentFetchSchema = z.object({
  path: z.string().min(1),
  download: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false")])
    .optional()
});

let ingestInProgress = false;

function previewForLog(value: string, maxChars = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function logAgentTrace(event: AgentTraceEvent, log: typeof server.log): void {
  log.info(
    {
      agentEvent: event.event,
      ...(event.detail ?? {})
    },
    "[agent-flow]"
  );
}

function buildSourceList(evidence: Evidence[]): SourceReference[] {
  const byKey = new Map<
    string,
    {
      source: "internal" | "web";
      documentName?: string;
      documentPath?: string;
      chapterPath?: string;
      pageStart?: number;
      pageEnd?: number;
      title: string;
      score: number;
    }
  >();
  const sorted = [...evidence].sort((a, b) => b.score - a.score);
  for (const item of sorted) {
    const key = [
      item.source,
      item.docPath ?? "",
      item.sectionPath ?? "",
      typeof item.pageStart === "number" ? String(item.pageStart) : "",
      typeof item.pageEnd === "number" ? String(item.pageEnd) : "",
      item.title
    ].join("|");
    if (byKey.has(key)) {
      continue;
    }
    byKey.set(key, {
      source: item.source,
      documentName: item.docName,
      documentPath: item.docPath,
      chapterPath: item.sectionPath,
      pageStart: item.pageStart,
      pageEnd: item.pageEnd,
      title: item.title,
      score: item.score
    });
  }
  return [...byKey.values()];
}

function parseDownloadFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return value === "1" || value === "true";
}

function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

server.get("/", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(APP_PAGE_HTML);
});

server.post("/ask", async (request, reply) => {
  const parsed = AskSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  request.log.info({ query: previewForLog(parsed.data.query) }, "[ask] received");
  const state = await runAgent(parsed.data.query, undefined, {
    trace: (event) => logAgentTrace(event, request.log)
  });
  const sources = buildSourceList([...state.localEvidence, ...state.webEvidence]);
  request.log.info(
    {
      localRetrievalPasses: state.localRetrievalPass,
      localQueriesTried: state.retrievalQueriesTried.length,
      usedWeb: state.shouldUseWeb,
      localConfidence: state.localConfidence
    },
    "[ask] completed"
  );
  return {
    answer: state.finalAnswer,
    localConfidence: state.localConfidence,
    usedWeb: state.shouldUseWeb,
    citations: [...state.localEvidence, ...state.webEvidence].map((e) => ({
      id: e.id,
      source: e.source,
      title: e.title,
      score: e.score,
      documentName: e.docName,
      documentPath: e.docPath,
      chapterPath: e.sectionPath,
      pageStart: e.pageStart,
      pageEnd: e.pageEnd
    })),
    sources
  };
});

server.post("/api/chat", async (request, reply) => {
  const parsed = ChatSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  let queryForAgent = parsed.data.query;
  if (parsed.data.followUp && parsed.data.sessionId) {
    const session = await getChatSession(parsed.data.sessionId);
    if (session && session.messages.length > 0) {
      queryForAgent = buildFollowupQueryFromSession(session, parsed.data.query);
    }
  }

  request.log.info(
    {
      followUp: parsed.data.followUp,
      hasSessionId: Boolean(parsed.data.sessionId),
      query: previewForLog(parsed.data.query)
    },
    "[chat] received"
  );
  const state = await runAgent(queryForAgent, undefined, {
    trace: (event) => logAgentTrace(event, request.log)
  });
  const sources = buildSourceList([...state.localEvidence, ...state.webEvidence]);
  request.log.info(
    {
      localRetrievalPasses: state.localRetrievalPass,
      localQueriesTried: state.retrievalQueriesTried.length,
      usedWeb: state.shouldUseWeb,
      localConfidence: state.localConfidence
    },
    "[chat] completed"
  );
  const savedSession = await appendChatTurn({
    sessionId: parsed.data.followUp ? parsed.data.sessionId ?? undefined : undefined,
    userMessage: parsed.data.query,
    assistantMessage: state.finalAnswer,
    assistantSources: sources
  });

  return {
    answer: state.finalAnswer,
    localConfidence: state.localConfidence,
    usedWeb: state.shouldUseWeb,
    citations: [...state.localEvidence, ...state.webEvidence].map((e) => ({
      id: e.id,
      source: e.source,
      title: e.title,
      score: e.score,
      documentName: e.docName,
      documentPath: e.docPath,
      chapterPath: e.sectionPath,
      pageStart: e.pageStart,
      pageEnd: e.pageEnd
    })),
    sources,
    session: savedSession
  };
});

server.post("/api/ingest", async (request, reply) => {
  const parsed = IngestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }
  if (ingestInProgress) {
    return reply.code(409).send({ error: "Ingestion already in progress" });
  }

  const path = parsed.data.folderPath;
  let stats;
  try {
    stats = await stat(path);
  } catch {
    return reply.code(400).send({ error: `Path does not exist: ${path}` });
  }
  if (!stats.isDirectory()) {
    return reply.code(400).send({ error: `Path is not a directory: ${path}` });
  }

  ingestInProgress = true;
  try {
    const summary = await ingestDocuments(path, (message) => request.log.info(message));
    return { summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(500).send({ error: message });
  } finally {
    ingestInProgress = false;
  }
});

server.get("/api/vectorized", async () => {
  const { path: manifestPath, manifest } = await readIngestManifest();
  const documents = Object.entries(manifest.docs)
    .map(([docPath, record]) => ({ path: docPath, chunkCount: record.chunkCount }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const folderCounts = new Map<string, number>();
  for (const doc of documents) {
    const folder = dirname(doc.path);
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }
  const folders = [...folderCounts.entries()]
    .map(([path, documentCount]) => ({ path, documentCount }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    manifestPath,
    documents,
    folders
  };
});

server.get("/api/document", async (request, reply) => {
  const parsed = DocumentFetchSchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const requestedPath = resolve(parsed.data.path);
  const { manifest } = await readIngestManifest();
  const tracked = new Set(Object.keys(manifest.docs).map((path) => resolve(path)));
  if (!tracked.has(requestedPath)) {
    return reply.code(403).send({ error: "Document path is not tracked by ingest manifest" });
  }

  let stats;
  try {
    stats = await stat(requestedPath);
  } catch {
    return reply.code(404).send({ error: "Document not found on disk" });
  }
  if (!stats.isFile()) {
    return reply.code(400).send({ error: "Requested path is not a file" });
  }

  const payload = await readFile(requestedPath);
  const download = parseDownloadFlag(parsed.data.download);
  const disposition = download ? "attachment" : "inline";
  return reply
    .header("Content-Type", contentTypeForPath(requestedPath))
    .header("Content-Disposition", `${disposition}; filename="${basename(requestedPath)}"`)
    .send(payload);
});

server.get("/api/history", async () => {
  const sessions = await listChatSessions();
  return {
    sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length
    }))
  };
});

server.get("/api/history/:sessionId", async (request, reply) => {
  const params = request.params as { sessionId?: string };
  if (!params.sessionId) {
    return reply.code(400).send({ error: "sessionId is required" });
  }
  const session = await getChatSession(params.sessionId);
  if (!session) {
    return reply.code(404).send({ error: "Session not found" });
  }
  return { session };
});

async function main(): Promise<void> {
  await server.listen({
    host: config.APP_HOST,
    port: config.APP_PORT
  });
}

main().catch((error) => {
  server.log.error(error);
  process.exit(1);
});
