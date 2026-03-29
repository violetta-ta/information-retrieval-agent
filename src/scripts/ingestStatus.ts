import { readFile } from "node:fs/promises";

const MANIFEST_CANDIDATES = ["./logs/ingest-manifest.json", "./data/ingest-manifest.json"];

interface ManifestRecord {
  hash: string;
  chunkCount: number;
}

interface IngestManifest {
  docs: Record<string, ManifestRecord>;
}

async function main(): Promise<void> {
  let raw = "";
  let selectedPath = "";
  for (const path of MANIFEST_CANDIDATES) {
    try {
      raw = await readFile(path, "utf8");
      selectedPath = path;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ENOENT")) {
        throw error;
      }
    }
  }

  if (!raw) {
    console.log("No ingested documents tracked yet.");
    return;
  }

  const parsed = JSON.parse(raw) as IngestManifest;
  const entries = Object.entries(parsed.docs ?? {}).sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    console.log("No ingested documents tracked yet.");
    return;
  }

  const totalChunks = entries.reduce((sum, [, record]) => sum + (record.chunkCount ?? 0), 0);
  console.log(`Manifest path: ${selectedPath}`);
  console.log(`Tracked documents: ${entries.length}`);
  console.log(`Tracked chunks: ${totalChunks}`);
  console.log("---");

  for (const [docPath, record] of entries) {
    console.log(`${docPath} | chunks=${record.chunkCount}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to read ingest manifest: ${message}`);
  process.exit(1);
});
