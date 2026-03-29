import { ingestDocuments } from "./service.js";

async function main(): Promise<void> {
  const docsDir = process.argv[2] ?? "./docs";
  const summary = await ingestDocuments(docsDir, (message) => {
    console.log(message);
  });
  console.log(
    `[ingest] complete: changed docs=${summary.changedDocs}, skipped unchanged docs=${summary.skippedUnchanged}, upserted chunks=${summary.upsertedChunks}, deleted stale chunks=${summary.deletedChunks}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
