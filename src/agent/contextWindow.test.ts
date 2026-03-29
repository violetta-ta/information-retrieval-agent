import test from "node:test";
import assert from "node:assert/strict";
import { buildCompactEvidence, renderEvidenceBlock } from "./contextWindow.js";

test("compact evidence sorts by score and truncates snippets", () => {
  const evidence = [
    { id: "1", source: "internal" as const, title: "Low", snippet: "short", score: 0.2 },
    { id: "2", source: "web" as const, title: "High", snippet: "x".repeat(800), score: 0.9 }
  ];

  const compact = buildCompactEvidence(evidence);
  assert.equal(compact[0]?.id, "2");
  assert.equal((compact[0]?.snippet.length ?? 0) <= 280, true);
});

test("renderEvidenceBlock enforces overall budget", () => {
  const evidence = Array.from({ length: 20 }, (_, i) => ({
    id: `doc-${i}`,
    source: "internal" as const,
    title: `Doc ${i}`,
    score: 1 - i * 0.01,
    snippet: "y".repeat(500)
  }));

  const block = renderEvidenceBlock(evidence);
  assert.equal(block.length <= 3200, true);
  assert.match(block, /\[1\] \(internal\)/);
});
