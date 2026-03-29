import type { Evidence } from "../agent/state.js";
import { config } from "../config.js";
import { LocalChromaStore } from "../retrieval/chroma.js";
import { LlamaClient } from "../retrieval/llamaClient.js";
import { runAuditedTool } from "./auditLogger.js";

const chroma = new LocalChromaStore();
const llama = new LlamaClient();

export async function queryInternalDocs(userQuery: string): Promise<Evidence[]> {
  return runAuditedTool(config.TOOL_AUDIT_LOG, "internalDocs.query", { userQuery }, async () => {
    const [embedding] = await llama.embed([userQuery]);
    if (!embedding || embedding.length === 0) {
      return [];
    }
    const hits = await chroma.query(embedding);
    return hits.map((h) => ({
      id: h.id,
      source: "internal",
      title: h.title,
      snippet: h.text.slice(0, 420),
      score: h.score,
      docPath: h.docPath,
      docName: h.docName,
      sectionPath: h.sectionPath,
      pageStart: h.pageStart,
      pageEnd: h.pageEnd
    }));
  });
}
