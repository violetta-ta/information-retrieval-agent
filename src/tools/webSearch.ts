import type { Evidence } from "../agent/state.js";
import { config, assertLocalhostOnly } from "../config.js";
import { runAuditedTool } from "./auditLogger.js";

interface WebIndexHit {
  id: string;
  title: string;
  snippet: string;
  score: number;
}

assertLocalhostOnly(config.LOCAL_WEB_INDEX_URL);

export async function queryWebIndex(redactedQuery: string, redactionApplied: boolean): Promise<Evidence[]> {
  return runAuditedTool(
    config.TOOL_AUDIT_LOG,
    "webSearch.query",
    { redactedQuery },
    async () => {
      const response = await fetch(`${config.LOCAL_WEB_INDEX_URL}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: redactedQuery, limit: 5 })
      });
      if (!response.ok) {
        throw new Error(`local web index query failed (${response.status})`);
      }
      const json = (await response.json()) as { hits?: WebIndexHit[] };
      return (json.hits ?? []).map((h) => ({
        id: h.id,
        source: "web",
        title: h.title,
        snippet: h.snippet,
        score: h.score
      }));
    },
    redactionApplied
  );
}
