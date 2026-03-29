import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { estimateLocalConfidence, shouldFallbackToWeb } from "./policies.js";

test("estimateLocalConfidence returns zero for no evidence", () => {
  const confidence = estimateLocalConfidence([]);
  assert.equal(confidence, 0);
});

test("estimateLocalConfidence applies top score and coverage bonus", () => {
  const confidence = estimateLocalConfidence([
    { id: "a", source: "internal", title: "Doc A", snippet: "x", score: 0.6 },
    { id: "b", source: "internal", title: "Doc B", snippet: "y", score: 0.5 }
  ]);
  assert.equal(Math.abs(confidence - 0.66) < 1e-9, true);
});

test("fallback decision flips at configured threshold boundary", () => {
  const epsilon = 0.001;
  assert.equal(shouldFallbackToWeb(config.LOCAL_CONFIDENCE_THRESHOLD - epsilon), true);
  assert.equal(shouldFallbackToWeb(config.LOCAL_CONFIDENCE_THRESHOLD), false);
  assert.equal(shouldFallbackToWeb(0.9), false);
});
