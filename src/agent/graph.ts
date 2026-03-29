import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { config } from "../config.js";
import { LlamaClient } from "../retrieval/llamaClient.js";
import { runAuditedTool } from "../tools/auditLogger.js";
import { applyRedactionGate, type RedactionResult } from "../tools/redactionGate.js";
import { queryInternalDocs } from "../tools/internalDocs.js";
import { queryWebIndex } from "../tools/webSearch.js";
import { buildCompactEvidence, renderEvidenceBlock } from "./contextWindow.js";
import { createPlanBrief, estimateLocalConfidence, shouldFallbackToWeb } from "./policies.js";
import type { AgentState, Evidence } from "./state.js";
import { initialState } from "./state.js";

const llama = new LlamaClient();
const DEFAULT_TRACE_PREVIEW_CHARS = 180;

export interface AgentTraceEvent {
  event: string;
  detail?: Record<string, unknown>;
}

export interface RunAgentOptions {
  trace?: (event: AgentTraceEvent) => void;
}

export interface AgentDeps {
  createPlanBrief: (query: string) => string;
  estimateLocalConfidence: (evidence: Evidence[]) => number;
  shouldFallbackToWeb: (localConfidence: number) => boolean;
  queryInternalDocs: (userQuery: string) => Promise<Evidence[]>;
  rewriteRetrievalQuery: (userQuery: string, priorQueries: string[], evidence: Evidence[]) => Promise<string>;
  redactForExternal: (userQuery: string) => Promise<RedactionResult>;
  queryWebIndex: (redactedQuery: string, redactionApplied: boolean) => Promise<Evidence[]>;
  chat: (prompt: string) => Promise<string>;
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(value: string): Set<string> {
  return new Set(
    normalizeQuery(value)
      .split(" ")
      .map((token) => token.replace(/[^a-z0-9_.-]/g, ""))
      .filter((token) => token.length >= 3)
  );
}

function querySimilarity(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.size === 0 && bTokens.size === 0) return 1;
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (aTokens.size + bTokens.size - intersection);
}

function isTooSimilarToPrior(candidate: string, priorQueries: string[]): boolean {
  const normalizedCandidate = normalizeQuery(candidate);
  if (!normalizedCandidate) {
    return true;
  }
  return priorQueries.some((prior) => {
    const normalizedPrior = normalizeQuery(prior);
    if (!normalizedPrior) {
      return false;
    }
    if (normalizedPrior === normalizedCandidate) {
      return true;
    }
    return querySimilarity(normalizedPrior, normalizedCandidate) >= 0.92;
  });
}

function sanitizeRewrite(raw: string): string {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return "";
  }
  const stripped = firstLine
    .replace(/^[-*\d). ]*query\s*[:\-]\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return stripped.slice(0, 220);
}

function fallbackRewrite(userQuery: string, priorQueries: string[]): string {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "what",
    "where",
    "when",
    "how",
    "does",
    "into",
    "about",
    "please",
    "need",
    "want",
    "question"
  ]);
  const keywords = normalizeQuery(userQuery)
    .split(" ")
    .map((token) => token.replace(/[^a-z0-9_.-]/g, ""))
    .filter((token) => token.length >= 4 && !stopWords.has(token))
    .slice(0, 10);
  const keywordPhrase = keywords.length > 0 ? keywords.join(" ") : normalizeQuery(userQuery);
  const candidates = [
    `${keywordPhrase} implementation details configuration`,
    `${keywordPhrase} api contract examples limitations`,
    `${keywordPhrase} troubleshooting edge cases`
  ];
  for (const candidate of candidates) {
    if (!isTooSimilarToPrior(candidate, priorQueries)) {
      return candidate;
    }
  }
  return "";
}

function mergeEvidence(current: Evidence[], incoming: Evidence[]): Evidence[] {
  const byId = new Map<string, Evidence>();
  for (const item of [...current, ...incoming]) {
    const prior = byId.get(item.id);
    if (!prior || item.score > prior.score) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}

function preview(value: string, maxChars = DEFAULT_TRACE_PREVIEW_CHARS): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3)}...`;
}

const defaultDeps: AgentDeps = {
  createPlanBrief,
  estimateLocalConfidence,
  shouldFallbackToWeb,
  queryInternalDocs,
  rewriteRetrievalQuery: async (userQuery: string, priorQueries: string[], evidence: Evidence[]) =>
    runAuditedTool(
      config.TOOL_AUDIT_LOG,
      "internalDocs.rewriteQuery",
      { userQuery, priorQueries, evidenceTitles: evidence.slice(0, 5).map((item) => item.title) },
      async () => {
        const prompt = [
          "Rewrite the user's question into a better retrieval query for semantic vector search.",
          "Output exactly one line with only the rewritten query.",
          "Do not repeat any prior query and avoid conversational filler.",
          "Use concrete technical keywords, entities, and likely terms found in docs.",
          "",
          `Original question: ${userQuery}`,
          `Prior retrieval queries: ${priorQueries.join(" || ") || "(none)"}`,
          `Top evidence titles: ${evidence.slice(0, 5).map((item) => item.title).join(" | ") || "(none)"}`,
          "Rewritten retrieval query:"
        ].join("\n");
        const raw = await llama.chat(prompt);
        const sanitized = sanitizeRewrite(raw);
        if (sanitized && !isTooSimilarToPrior(sanitized, priorQueries)) {
          return sanitized;
        }
        return fallbackRewrite(userQuery, priorQueries);
      }
    ),
  redactForExternal: async (userQuery: string) =>
    runAuditedTool(
      config.TOOL_AUDIT_LOG,
      "redactionGate.apply",
      { userQuery },
      async ({ userQuery: value }) => applyRedactionGate(value)
    ),
  queryWebIndex,
  chat: async (prompt: string) => llama.chat(prompt)
};

const GraphState = Annotation.Root({
  userQuery: Annotation<string>(),
  planBrief: Annotation<string>(),
  activeRetrievalQuery: Annotation<string>(),
  retrievalQueriesTried: Annotation<string[]>(),
  localRetrievalPass: Annotation<number>(),
  retryLocal: Annotation<boolean>(),
  localEvidence: Annotation<Evidence[]>(),
  webEvidence: Annotation<Evidence[]>(),
  localConfidence: Annotation<number>(),
  shouldUseWeb: Annotation<boolean>(),
  redactedQuery: Annotation<string>(),
  finalAnswer: Annotation<string>()
});

function localDecision(state: AgentState): string {
  if (!state.shouldUseWeb) {
    return "answer";
  }
  if (state.localRetrievalPass < config.MAX_LOCAL_RETRIEVAL_PASSES) {
    return "rewrite";
  }
  return state.shouldUseWeb ? "redact" : "answer";
}

function rewriteDecision(state: AgentState): string {
  return state.retryLocal ? "local" : "redact";
}

export function createAgentGraph(deps: AgentDeps = defaultDeps, trace?: (event: AgentTraceEvent) => void) {
  const emit = (event: string, detail: Record<string, unknown> = {}): void => {
    trace?.({ event, detail });
  };

  async function planAndRoute(state: AgentState): Promise<Partial<AgentState>> {
    const planBrief = deps.createPlanBrief(state.userQuery);
    emit("plan.ready", { planBrief: preview(planBrief) });
    return { planBrief };
  }

  async function fetchLocalEvidence(state: AgentState): Promise<Partial<AgentState>> {
    const queryForLocal = state.activeRetrievalQuery || state.userQuery;
    const nextPass = state.localRetrievalPass + 1;
    emit("local.retrieve.start", {
      pass: nextPass,
      query: preview(queryForLocal),
      priorQueries: state.retrievalQueriesTried.length
    });
    const localHits = await deps.queryInternalDocs(queryForLocal);
    const localEvidence = mergeEvidence(state.localEvidence, localHits);
    const localConfidence = deps.estimateLocalConfidence(localEvidence);
    const retrievalQueriesTried = [...state.retrievalQueriesTried];
    if (!isTooSimilarToPrior(queryForLocal, retrievalQueriesTried)) {
      retrievalQueriesTried.push(queryForLocal);
    } else if (!retrievalQueriesTried.some((prior) => normalizeQuery(prior) === normalizeQuery(queryForLocal))) {
      retrievalQueriesTried.push(queryForLocal);
    }
    const shouldUseWeb = deps.shouldFallbackToWeb(localConfidence);
    emit("local.retrieve.done", {
      pass: nextPass,
      hits: localHits.length,
      accumulatedEvidence: localEvidence.length,
      localConfidence,
      shouldUseWeb
    });
    return {
      activeRetrievalQuery: queryForLocal,
      retrievalQueriesTried,
      localRetrievalPass: nextPass,
      retryLocal: false,
      localEvidence,
      localConfidence,
      shouldUseWeb
    };
  }

  async function rewriteLocalQuery(state: AgentState): Promise<Partial<AgentState>> {
    emit("local.rewrite.start", {
      pass: state.localRetrievalPass,
      priorQueries: state.retrievalQueriesTried.length
    });
    const rewritten = await deps.rewriteRetrievalQuery(
      state.userQuery,
      state.retrievalQueriesTried,
      state.localEvidence
    );
    if (!rewritten || isTooSimilarToPrior(rewritten, state.retrievalQueriesTried)) {
      emit("local.rewrite.skipped", {
        reason: "duplicate_or_empty",
        candidate: preview(rewritten ?? "")
      });
      return { retryLocal: false };
    }
    emit("local.rewrite.accepted", {
      query: preview(rewritten)
    });
    return {
      activeRetrievalQuery: rewritten,
      retryLocal: true
    };
  }

  async function redactForExternal(state: AgentState): Promise<Partial<AgentState>> {
    emit("web.redaction.start");
    const redaction = await deps.redactForExternal(state.userQuery);
    emit("web.redaction.done", {
      changed: redaction.changed,
      redactedQuery: preview(redaction.redacted)
    });
    return { redactedQuery: redaction.redacted };
  }

  async function fetchWebEvidence(state: AgentState): Promise<Partial<AgentState>> {
    const queryForWeb = state.redactedQuery || state.userQuery;
    const redactionApplied = queryForWeb !== state.userQuery;
    emit("web.retrieve.start", {
      redactionApplied,
      query: preview(queryForWeb)
    });
    const webEvidence = await deps.queryWebIndex(queryForWeb, redactionApplied);
    emit("web.retrieve.done", {
      hits: webEvidence.length
    });
    return { webEvidence };
  }

  async function synthesizeAnswer(state: AgentState): Promise<Partial<AgentState>> {
    emit("answer.synthesis.start", {
      localEvidence: state.localEvidence.length,
      webEvidence: state.webEvidence.length
    });
    const compactEvidence = buildCompactEvidence([...state.localEvidence, ...state.webEvidence]);
    const evidenceBlock = renderEvidenceBlock(compactEvidence);

    const prompt = [
      "You are a local-first assistant.",
      "Use evidence faithfully. Prefer internal evidence when available.",
      "If evidence is insufficient, explicitly say uncertainty.",
      "",
      `Query: ${state.userQuery}`,
      `Plan: ${state.planBrief}`,
      "Evidence:",
      evidenceBlock
    ].join("\n");

    const finalAnswer = await deps.chat(prompt);
    emit("answer.synthesis.done", {
      answerChars: finalAnswer.length
    });
    return { finalAnswer };
  }

  return new StateGraph(GraphState)
    .addNode("plan", planAndRoute)
    .addNode("local", fetchLocalEvidence)
    .addNode("rewrite", rewriteLocalQuery)
    .addNode("redact", redactForExternal)
    .addNode("web", fetchWebEvidence)
    .addNode("answer", synthesizeAnswer)
    .addEdge(START, "plan")
    .addEdge("plan", "local")
    .addConditionalEdges("local", localDecision, {
      rewrite: "rewrite",
      redact: "redact",
      answer: "answer"
    })
    .addConditionalEdges("rewrite", rewriteDecision, {
      local: "local",
      redact: "redact"
    })
    .addEdge("redact", "web")
    .addEdge("web", "answer")
    .addEdge("answer", END)
    .compile();
}

export async function runAgent(
  userQuery: string,
  deps: AgentDeps = defaultDeps,
  options: RunAgentOptions = {}
): Promise<AgentState> {
  options.trace?.({
    event: "agent.start",
    detail: { query: preview(userQuery) }
  });
  const graph = createAgentGraph(deps, options.trace);
  const result = (await graph.invoke(initialState(userQuery))) as AgentState;
  options.trace?.({
    event: "agent.done",
    detail: {
      localRetrievalPasses: result.localRetrievalPass,
      localQueriesTried: result.retrievalQueriesTried.length,
      usedWeb: result.shouldUseWeb,
      localEvidence: result.localEvidence.length,
      webEvidence: result.webEvidence.length,
      localConfidence: result.localConfidence
    }
  });
  return result;
}
