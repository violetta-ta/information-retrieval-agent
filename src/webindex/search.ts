import { makeSnippet, tokenize } from "./text.js";
import type { IndexedDoc, SearchHit } from "./types.js";

function buildTermFreq(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}

export function searchDocs(docs: IndexedDoc[], query: string, limit: number): SearchHit[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) {
    return [];
  }
  const qFreq = buildTermFreq(qTokens);

  const scored = docs
    .map((doc) => {
      const docTokens = tokenize(`${doc.title} ${doc.text}`);
      const dFreq = buildTermFreq(docTokens);
      let score = 0;
      for (const [token, qCount] of qFreq.entries()) {
        const dCount = dFreq.get(token) ?? 0;
        if (dCount > 0) {
          score += Math.log(1 + dCount) * (1 + Math.log(1 + qCount));
        }
      }
      return { doc, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, limit)));

  const max = scored[0]?.score ?? 1;
  return scored.map(({ doc, score }) => ({
    id: doc.id,
    title: doc.title,
    snippet: makeSnippet(doc.text),
    score: score / max
  }));
}
