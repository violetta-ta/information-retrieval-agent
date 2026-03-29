import test from "node:test";
import assert from "node:assert/strict";
import { searchDocs } from "./search.js";
import { crawlUrl } from "./crawler.js";

test("search ranks matching document first", () => {
  const docs = [
    {
      id: "a",
      url: "https://example.com/a",
      title: "General cooking notes",
      snippet: "random",
      text: "This text talks about recipes and kitchen tips.",
      addedAt: new Date().toISOString()
    },
    {
      id: "b",
      url: "https://example.com/b",
      title: "Qwen3 deployment guide",
      snippet: "random",
      text: "Qwen3 inference with llama cpp and gguf configuration tips.",
      addedAt: new Date().toISOString()
    }
  ];

  const hits = searchDocs(docs, "qwen3 gguf inference", 5);
  assert.equal(hits.length > 0, true);
  assert.equal(hits[0]?.id, "b");
  assert.equal((hits[0]?.score ?? 0) <= 1, true);
});

test("crawler blocks localhost and private targets", async () => {
  await assert.rejects(
    async () => {
      await crawlUrl("http://127.0.0.1:8080/private");
    },
    /denied host for crawl/
  );
});
