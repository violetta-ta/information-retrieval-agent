import { createHash } from "node:crypto";
import { extractReadableText, extractTitle, makeSnippet } from "./text.js";
import type { IndexedDoc } from "./types.js";

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function isDeniedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1") {
    return true;
  }
  if (/^10\./.test(lower) || /^192\.168\./.test(lower) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) {
    return true;
  }
  if (/^169\.254\./.test(lower) || /^0\./.test(lower)) {
    return true;
  }
  return false;
}

function assertAllowedUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported protocol for crawl: ${url.protocol}`);
  }
  if (isDeniedHost(url.hostname)) {
    throw new Error(`denied host for crawl: ${url.hostname}`);
  }
  return url;
}

export async function crawlUrl(inputUrl: string): Promise<IndexedDoc> {
  const url = assertAllowedUrl(inputUrl);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "User-Agent": "local-agent-webindex/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`crawl failed (${response.status}) for ${url.toString()}`);
  }
  const html = await response.text();
  const title = extractTitle(html, url.toString());
  const text = extractReadableText(html);
  const id = hashId(url.toString());
  return {
    id,
    url: url.toString(),
    title,
    snippet: makeSnippet(text),
    text,
    addedAt: new Date().toISOString()
  };
}
