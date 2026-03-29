import { ChromaClient } from "chromadb";
import { config, assertLocalhostOnly } from "../config.js";

export interface QueryHit {
  id: string;
  text: string;
  score: number;
  title: string;
  docPath?: string;
  docName?: string;
  sectionPath?: string;
  pageStart?: number;
  pageEnd?: number;
}

export class LocalChromaStore {
  private client: ChromaClient;

  constructor() {
    assertLocalhostOnly(config.CHROMA_URL);
    this.client = new ChromaClient({ path: config.CHROMA_URL });
  }

  async upsertChunks(
    items: Array<{
      id: string;
      text: string;
      embedding: number[];
      title: string;
      docPath: string;
      docName: string;
      sectionPath: string;
      pageStart?: number;
      pageEnd?: number;
    }>
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const collection = await this.client.getOrCreateCollection({
      name: config.CHROMA_COLLECTION,
      metadata: { owner: "local-agent", telemetry: "disabled" }
    });
    await collection.upsert({
      ids: items.map((i) => i.id),
      documents: items.map((i) => i.text),
      embeddings: items.map((i) => i.embedding),
      metadatas: items.map((i) => {
        const base: Record<string, string | number> = {
          title: i.title,
          docPath: i.docPath,
          docName: i.docName,
          sectionPath: i.sectionPath
        };
        if (typeof i.pageStart === "number") {
          base.pageStart = i.pageStart;
        }
        if (typeof i.pageEnd === "number") {
          base.pageEnd = i.pageEnd;
        }
        return base;
      })
    });
  }

  async deleteChunksByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const collection = await this.client.getOrCreateCollection({ name: config.CHROMA_COLLECTION });
    await collection.delete({ ids });
  }

  async query(embedding: number[], topK = config.MAX_LOCAL_RESULTS): Promise<QueryHit[]> {
    const collection = await this.client.getOrCreateCollection({ name: config.CHROMA_COLLECTION });
    const result = await collection.query({
      queryEmbeddings: [embedding],
      nResults: topK
    });

    const ids = result.ids?.[0] ?? [];
    const docs = result.documents?.[0] ?? [];
    const distances = result.distances?.[0] ?? [];
    const metas = result.metadatas?.[0] ?? [];

    return ids.map((id, idx) => {
      const distance = typeof distances[idx] === "number" ? distances[idx] : 1;
      const similarity = Math.max(0, 1 - distance);
      const meta = metas[idx] as
        | {
            title?: string;
            docPath?: string;
            docName?: string;
            sectionPath?: string;
            pageStart?: number;
            pageEnd?: number;
          }
        | undefined;
      return {
        id,
        text: docs[idx] ?? "",
        score: similarity,
        title: meta?.title ?? "local_document",
        docPath: meta?.docPath,
        docName: meta?.docName,
        sectionPath: meta?.sectionPath,
        pageStart: typeof meta?.pageStart === "number" ? meta.pageStart : undefined,
        pageEnd: typeof meta?.pageEnd === "number" ? meta.pageEnd : undefined
      };
    });
  }
}
