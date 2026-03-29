import { config } from "../config.js";
import type { Evidence } from "./state.js";

export interface CompactEvidence {
  id: string;
  source: "internal" | "web";
  title: string;
  score: number;
  snippet: string;
}

function compactSnippet(snippet: string, maxChars: number): string {
  const normalized = snippet.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function buildCompactEvidence(evidence: Evidence[]): CompactEvidence[] {
  return evidence
    .sort((a, b) => b.score - a.score)
    .slice(0, config.MAX_EVIDENCE_ITEMS)
    .map((item) => ({
      id: item.id,
      source: item.source,
      title: item.title,
      score: item.score,
      snippet: compactSnippet(item.snippet, config.MAX_EVIDENCE_SNIPPET_CHARS)
    }));
}

export function renderEvidenceBlock(evidence: CompactEvidence[]): string {
  const lines: string[] = [];
  let usedChars = 0;

  for (let i = 0; i < evidence.length; i += 1) {
    const row = evidence[i];
    if (!row) {
      continue;
    }
    const line = `[${i + 1}] (${row.source}) ${row.title} [score=${row.score.toFixed(3)}]: ${row.snippet}`;
    const nextChars = usedChars + line.length + 1;
    if (nextChars > config.EVIDENCE_CHAR_BUDGET) {
      break;
    }
    lines.push(line);
    usedChars = nextChars;
  }

  return lines.join("\n");
}
