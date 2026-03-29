import test from "node:test";
import assert from "node:assert/strict";
import { applyRedactionGate } from "./redactionGate.js";

test("redaction gate masks sensitive patterns", () => {
  const input =
    "Email jane@corp.internal token sk_123456789abcdef path /home/marina/docs/file12345 host api.internal.local";
  const result = applyRedactionGate(input);

  assert.equal(result.changed, true);
  assert.match(result.redacted, /\[REDACTED_EMAIL\]/);
  assert.match(result.redacted, /\[REDACTED_SECRET\]/);
  assert.match(result.redacted, /\[REDACTED_PATH\]/);
  assert.match(result.redacted, /\[REDACTED_HOST\]/);
});

test("redaction gate leaves benign text unchanged", () => {
  const input = "How do I tune chunk size for retrieval quality?";
  const result = applyRedactionGate(input);
  assert.equal(result.changed, false);
  assert.equal(result.redacted, input);
});
