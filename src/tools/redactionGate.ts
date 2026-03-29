const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[REDACTED_EMAIL]" },
  { pattern: /\b(?:sk|api|token|secret)[-_]?[a-z0-9]{10,}\b/gi, replacement: "[REDACTED_SECRET]" },
  { pattern: /(?:\/[A-Za-z0-9._-]+){2,}/g, replacement: "[REDACTED_PATH]" },
  { pattern: /\b(?:[A-Za-z0-9-]+\.){2,}[A-Za-z]{2,}\b/g, replacement: "[REDACTED_HOST]" },
  { pattern: /\b(?:doc|file|record)[-_]?[A-Za-z0-9]{6,}\b/gi, replacement: "[REDACTED_ID]" }
];

export interface RedactionResult {
  redacted: string;
  changed: boolean;
}

export function applyRedactionGate(input: string): RedactionResult {
  let output = input;
  for (const rule of REDACTION_PATTERNS) {
    output = output.replace(rule.pattern, rule.replacement);
  }
  return { redacted: output, changed: output !== input };
}
