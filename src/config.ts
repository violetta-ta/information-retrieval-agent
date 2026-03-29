import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  APP_HOST: z.string().default("127.0.0.1"),
  APP_PORT: z.coerce.number().default(8080),
  WEB_INDEX_HOST: z.string().default("127.0.0.1"),
  WEB_INDEX_PORT: z.coerce.number().default(4005),
  WEB_INDEX_STORE_PATH: z.string().default("./data/web-index/store.json"),

  LLAMA_CHAT_BASE_URL: z.string().url().default("http://127.0.0.1:8081"),
  LLAMA_EMBED_BASE_URL: z.string().url().default("http://127.0.0.1:8082"),
  LLAMA_CHAT_MODEL: z.string().default("qwen3-8b-instruct-q4_k_m.gguf"),
  LLAMA_EMBED_MODEL: z.string().default("embeddinggemma-300m.gguf"),
  LLAMA_CTX_SIZE: z.coerce.number().default(8192),

  CHROMA_URL: z.string().url().default("http://127.0.0.1:8000"),
  CHROMA_COLLECTION: z.string().default("local_docs"),

  LOCAL_WEB_INDEX_URL: z.string().url().default("http://127.0.0.1:4005"),
  TOOL_AUDIT_LOG: z.string().default("./logs/tool-calls.jsonl"),

  MAX_LOCAL_RESULTS: z.coerce.number().default(6),
  LOCAL_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.72),
  MAX_LOCAL_RETRIEVAL_PASSES: z.coerce.number().default(2),
  MAX_EVIDENCE_ITEMS: z.coerce.number().default(8),
  MAX_EVIDENCE_SNIPPET_CHARS: z.coerce.number().default(280),
  EVIDENCE_CHAR_BUDGET: z.coerce.number().default(3200),

  LANGCHAIN_TRACING_V2: z.string().default("false"),
  LANGCHAIN_ENDPOINT: z.string().optional(),
  LANGCHAIN_API_KEY: z.string().optional(),
  OTEL_SDK_DISABLED: z.string().default("true"),
  DO_NOT_TRACK: z.string().default("1")
});

export const config = ConfigSchema.parse(process.env);

export function assertLocalhostOnly(urlValue: string): void {
  const url = new URL(urlValue);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Non-localhost endpoint denied: ${urlValue}`);
  }
}

export function assertPrivacyDefaults(): void {
  if (config.LANGCHAIN_TRACING_V2 !== "false") {
    throw new Error("LANGCHAIN_TRACING_V2 must be false");
  }
  if (config.OTEL_SDK_DISABLED !== "true") {
    throw new Error("OTEL_SDK_DISABLED must be true");
  }
}
