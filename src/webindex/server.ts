import Fastify from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { crawlUrl } from "./crawler.js";
import { searchDocs } from "./search.js";
import { readStore, writeStore } from "./store.js";

const server = Fastify({ logger: true });

const CrawlSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(20)
});

const SearchSchema = z.object({
  query: z.string().min(2),
  limit: z.coerce.number().min(1).max(20).default(5)
});

server.get("/health", async () => ({ ok: true }));

server.post("/crawl", async (request, reply) => {
  const parsed = CrawlSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const store = await readStore(config.WEB_INDEX_STORE_PATH);
  const existing = new Map(store.docs.map((doc) => [doc.id, doc]));
  const failures: Array<{ url: string; error: string }> = [];

  for (const url of parsed.data.urls) {
    try {
      const doc = await crawlUrl(url);
      existing.set(doc.id, doc);
    } catch (error) {
      failures.push({
        url,
        error: error instanceof Error ? error.message : "unknown error"
      });
    }
  }

  const docs = Array.from(existing.values());
  await writeStore(config.WEB_INDEX_STORE_PATH, { docs });

  return {
    indexedDocs: docs.length,
    requested: parsed.data.urls.length,
    failures
  };
});

server.post("/search", async (request, reply) => {
  const parsed = SearchSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const store = await readStore(config.WEB_INDEX_STORE_PATH);
  const hits = searchDocs(store.docs, parsed.data.query, parsed.data.limit);
  return { hits };
});

async function main(): Promise<void> {
  if (config.WEB_INDEX_HOST !== "127.0.0.1" && config.WEB_INDEX_HOST !== "localhost") {
    throw new Error("WEB_INDEX_HOST must be localhost-only");
  }
  await server.listen({
    host: config.WEB_INDEX_HOST,
    port: config.WEB_INDEX_PORT
  });
}

main().catch((error) => {
  server.log.error(error);
  process.exit(1);
});
