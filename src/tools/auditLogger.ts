import { createHash } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEntry {
  timestamp: string;
  tool: string;
  status: "ok" | "error";
  durationMs: number;
  inputHash: string;
  outputHash?: string;
  redactionApplied?: boolean;
  errorMessage?: string;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function writeAuditLog(logPath: string, entry: AuditEntry): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

export async function runAuditedTool<TInput, TOutput>(
  logPath: string,
  toolName: string,
  input: TInput,
  fn: (input: TInput) => Promise<TOutput>,
  redactionApplied = false
): Promise<TOutput> {
  const started = Date.now();
  try {
    const output = await fn(input);
    await writeAuditLog(logPath, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      status: "ok",
      durationMs: Date.now() - started,
      inputHash: hashJson(input),
      outputHash: hashJson(output),
      redactionApplied
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await writeAuditLog(logPath, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      status: "error",
      durationMs: Date.now() - started,
      inputHash: hashJson(input),
      redactionApplied,
      errorMessage: message
    });
    throw error;
  }
}
