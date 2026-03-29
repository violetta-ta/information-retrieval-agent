import test from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "./chunking.js";

test("technical chunker keeps section and block type context", () => {
  const input = [
    "# Query Documents",
    "Use [insert docs](https://example.com/docs) to load data.",
    "",
    "## API",
    "```ts",
    "const result = await db.query({ limit: 1000 });",
    "```",
    "",
    "- retries: 3",
    "- timeoutMs: 5000"
  ].join("\n");

  const chunks = chunkText("doc", "Query Documents", input);
  assert.equal(chunks.length > 0, true);
  assert.equal(chunks.some((c) => c.text.includes("Section: Query Documents")), true);
  assert.equal(chunks.some((c) => c.text.includes("BlockType: code")), true);
  assert.equal(chunks.some((c) => c.text.includes("link: https://example.com/docs")), true);
});

test("technical chunker splits long prose into multiple chunks", () => {
  const longText = `# Intro\n${"alpha beta gamma delta ".repeat(600)}`;
  const chunks = chunkText("doc2", "Intro", longText);
  assert.equal(chunks.length > 1, true);
  assert.equal(chunks.every((c) => c.text.includes("BlockType: prose")), true);
});
