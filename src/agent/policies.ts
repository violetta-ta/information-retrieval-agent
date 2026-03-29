import { config } from "../config.js";
import type { Evidence } from "./state.js";

export function createPlanBrief(query: string): string {
  return `Answer from internal docs first; fallback to web only if confidence < ${config.LOCAL_CONFIDENCE_THRESHOLD}.`;
}

export function estimateLocalConfidence(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0;
  const top = Math.max(...evidence.map((e) => e.score));
  const coverageBonus = Math.min(0.2, evidence.length * 0.03);
  return Math.min(1, top + coverageBonus);
}

export function shouldFallbackToWeb(localConfidence: number): boolean {
  return localConfidence < config.LOCAL_CONFIDENCE_THRESHOLD;
}
