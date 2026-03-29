import { config, assertLocalhostOnly } from "../config.js";

export class LlamaClient {
  async chat(prompt: string): Promise<string> {
    assertLocalhostOnly(config.LLAMA_CHAT_BASE_URL);
    const response = await fetch(`${config.LLAMA_CHAT_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.LLAMA_CHAT_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 600
      })
    });
    if (!response.ok) {
      throw new Error(`llama.cpp chat failed (${response.status})`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? "";
  }

  async embed(inputs: string[]): Promise<number[][]> {
    assertLocalhostOnly(config.LLAMA_EMBED_BASE_URL);
    const response = await fetch(`${config.LLAMA_EMBED_BASE_URL}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.LLAMA_EMBED_MODEL,
        input: inputs
      })
    });
    if (!response.ok) {
      throw new Error(`llama.cpp embeddings failed (${response.status})`);
    }
    const json = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    return (json.data ?? []).map((row) => row.embedding ?? []);
  }
}
