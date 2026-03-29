import test from "node:test";
import assert from "node:assert/strict";
import type { AgentDeps } from "./graph.js";
import { runAgent } from "./graph.js";

function makeDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  return {
    createPlanBrief: () => "plan",
    estimateLocalConfidence: (evidence) => (evidence[0]?.score ?? 0),
    shouldFallbackToWeb: (confidence) => confidence < 0.72,
    queryInternalDocs: async () => [],
    rewriteRetrievalQuery: async (query) => `${query} technical details`,
    redactForExternal: async (query) => ({ redacted: query, changed: false }),
    queryWebIndex: async () => [],
    chat: async () => "answer",
    ...overrides
  };
}

test("integration: local confidence path skips redaction and web search", async () => {
  const calls: string[] = [];
  const deps = makeDeps({
    queryInternalDocs: async () => {
      calls.push("internal");
      return [{ id: "doc-1", source: "internal", title: "Doc", snippet: "hit", score: 0.95 }];
    },
    redactForExternal: async (query) => {
      calls.push("redaction");
      return { redacted: query, changed: false };
    },
    queryWebIndex: async () => {
      calls.push("web");
      return [{ id: "w1", source: "web", title: "Web", snippet: "x", score: 0.8 }];
    },
    chat: async () => {
      calls.push("chat");
      return "local answer";
    }
  });

  const state = await runAgent("What is in internal docs?", deps);
  assert.equal(state.shouldUseWeb, false);
  assert.equal(state.webEvidence.length, 0);
  assert.deepEqual(calls, ["internal", "chat"]);
});

test("integration: low-confidence path applies redaction before web search", async () => {
  const calls: string[] = [];
  const queries: string[] = [];
  const deps = makeDeps({
    queryInternalDocs: async (query) => {
      calls.push("internal");
      queries.push(query);
      return [];
    },
    rewriteRetrievalQuery: async () => {
      calls.push("rewrite");
      return "safe internal docs query with component names";
    },
    redactForExternal: async () => {
      calls.push("redaction");
      return { redacted: "safe query", changed: true };
    },
    queryWebIndex: async (query, redactionApplied) => {
      calls.push("web");
      assert.equal(query, "safe query");
      assert.equal(redactionApplied, true);
      return [{ id: "w1", source: "web", title: "Web", snippet: "hit", score: 0.7 }];
    },
    chat: async () => {
      calls.push("chat");
      return "web fallback answer";
    }
  });

  const state = await runAgent("token sk_abcd1234567890 please search", deps);
  assert.equal(state.shouldUseWeb, true);
  assert.equal(state.redactedQuery, "safe query");
  assert.equal(state.webEvidence.length, 1);
  assert.deepEqual(queries, [
    "token sk_abcd1234567890 please search",
    "safe internal docs query with component names"
  ]);
  assert.deepEqual(calls, ["internal", "rewrite", "internal", "redaction", "web", "chat"]);
});

test("integration: duplicate rewrite skips extra local retrieval and goes to web", async () => {
  const calls: string[] = [];
  const queries: string[] = [];
  const deps = makeDeps({
    queryInternalDocs: async (query) => {
      calls.push("internal");
      queries.push(query);
      return [];
    },
    rewriteRetrievalQuery: async (query) => {
      calls.push("rewrite");
      return query;
    },
    redactForExternal: async (query) => {
      calls.push("redaction");
      return { redacted: query, changed: false };
    },
    queryWebIndex: async () => {
      calls.push("web");
      return [];
    },
    chat: async () => {
      calls.push("chat");
      return "fallback answer";
    }
  });

  await runAgent("same query text", deps);
  assert.deepEqual(queries, ["same query text"]);
  assert.deepEqual(calls, ["internal", "rewrite", "redaction", "web", "chat"]);
});
