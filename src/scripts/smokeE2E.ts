import process from "node:process";

interface AskResponse {
  answer: string;
  localConfidence: number;
  usedWeb: boolean;
  citations: Array<{
    id: string;
    source: "internal" | "web";
    title: string;
    score: number;
  }>;
}

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function assertLocalhost(urlValue: string): void {
  const url = new URL(urlValue);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`${urlValue} is not localhost-only`);
  }
}

async function postJson<TResponse>(url: string, body: unknown): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`request failed ${response.status} ${url}: ${text}`);
  }
  return (await response.json()) as TResponse;
}

async function getJson<TResponse>(url: string): Promise<TResponse> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed ${response.status} ${url}`);
  }
  return (await response.json()) as TResponse;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const appBaseUrl = env("SMOKE_APP_URL", "http://127.0.0.1:8080");
  const webIndexUrl = env("SMOKE_WEB_INDEX_URL", "http://127.0.0.1:4005");
  const localQuery = env("SMOKE_LOCAL_QUERY", "What is the local smoke phrase?");
  const localExpectedContains = env("SMOKE_LOCAL_EXPECT_CONTAINS", "LOCAL_SMOKE_OK");
  const webQuery = env("SMOKE_WEB_QUERY", "what is the example domain used for?");
  const seedUrl = env("SMOKE_WEB_SEED_URL", "https://example.com");

  assertLocalhost(appBaseUrl);
  assertLocalhost(webIndexUrl);

  await getJson<{ ok: boolean }>(`${webIndexUrl}/health`);
  await postJson(`${webIndexUrl}/crawl`, { urls: [seedUrl] });

  const localResponse = await postJson<AskResponse>(`${appBaseUrl}/ask`, { query: localQuery });
  requireCondition(localResponse.usedWeb === false, "local path failed: expected usedWeb=false");
  requireCondition(
    localResponse.answer.toLowerCase().includes(localExpectedContains.toLowerCase()),
    `local answer missing expected token: ${localExpectedContains}`
  );

  const webResponse = await postJson<AskResponse>(`${appBaseUrl}/ask`, { query: webQuery });
  requireCondition(webResponse.usedWeb === true, "web fallback failed: expected usedWeb=true");
  requireCondition(webResponse.answer.length > 0, "web fallback failed: empty answer");

  console.log("Smoke e2e passed");
  console.log(
    JSON.stringify(
      {
        local: {
          usedWeb: localResponse.usedWeb,
          localConfidence: localResponse.localConfidence
        },
        web: {
          usedWeb: webResponse.usedWeb,
          localConfidence: webResponse.localConfidence
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke e2e failed: ${message}`);
  process.exit(1);
});
