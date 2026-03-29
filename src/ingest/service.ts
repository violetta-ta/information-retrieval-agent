import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { PDFParse } from "pdf-parse";
import { LocalChromaStore } from "../retrieval/chroma.js";
import { LlamaClient } from "../retrieval/llamaClient.js";
import { chunkText, type Chunk } from "./chunking.js";

const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".pdf"]);
const EMBED_BATCH_SIZE = 32;
const INGEST_MANIFEST_PATH = "./logs/ingest-manifest.json";
const LEGACY_INGEST_MANIFEST_PATH = "./data/ingest-manifest.json";
const INGEST_SCHEMA_VERSION = "2";

export interface ManifestRecord {
  hash: string;
  chunkCount: number;
}

export interface IngestManifest {
  docs: Record<string, ManifestRecord>;
}

export interface IngestSummary {
  changedDocs: number;
  skippedUnchanged: number;
  upsertedChunks: number;
  deletedChunks: number;
  trackedDocuments: number;
}

async function listSupportedFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listSupportedFiles(fullPath);
      files.push(...nested);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

interface ExtractedFileContent {
  text: string;
  pages?: string[];
}

async function extractTextFromFile(path: string): Promise<ExtractedFileContent> {
  const extension = extname(path).toLowerCase();
  if (extension === ".pdf") {
    const buffer = await readFile(path);
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      const text = parsed.text ?? "";
      const pages = text
        .split(/\f+/g)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (pages.length > 1) {
        return { text, pages };
      }
      return { text };
    } finally {
      await parser.destroy();
    }
  }
  return { text: await readFile(path, "utf-8") };
}

function hashContent(content: string): string {
  return createHash("sha256")
    .update(`${INGEST_SCHEMA_VERSION}\n${content}`, "utf8")
    .digest("hex");
}

function buildChunksForFile(path: string, title: string, extracted: ExtractedFileContent): Chunk[] {
  if (!extracted.pages || extracted.pages.length === 0) {
    return chunkText(path, title, extracted.text);
  }
  const chunks: Chunk[] = [];
  let nextStartIndex = 0;
  for (let pageIdx = 0; pageIdx < extracted.pages.length; pageIdx += 1) {
    const pageNumber = pageIdx + 1;
    const pageText = extracted.pages[pageIdx];
    if (!pageText) {
      continue;
    }
    const pageChunks = chunkText(path, title, pageText, {
      idPrefix: path,
      startIndex: nextStartIndex,
      pageStart: pageNumber,
      pageEnd: pageNumber
    });
    chunks.push(...pageChunks);
    nextStartIndex += pageChunks.length;
  }
  return chunks;
}

async function loadManifest(path: string): Promise<IngestManifest> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as IngestManifest;
    if (!parsed || typeof parsed !== "object" || !parsed.docs || typeof parsed.docs !== "object") {
      return { docs: {} };
    }
    return parsed;
  } catch {
    return { docs: {} };
  }
}

async function saveManifest(path: string, manifest: IngestManifest): Promise<void> {
  await mkdir("./logs", { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function buildChunkIds(docPath: string, chunkCount: number): string[] {
  const ids: string[] = [];
  for (let idx = 0; idx < chunkCount; idx += 1) {
    ids.push(`${docPath}_chunk_${idx}`);
  }
  return ids;
}

function isPathWithinRoot(docPath: string, docsDir: string): boolean {
  const absDocPath = resolve(docPath);
  const absRoot = resolve(docsDir);
  const rel = relative(absRoot, absDocPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function readIngestManifest(): Promise<{ path: string; manifest: IngestManifest }> {
  const current = await loadManifest(INGEST_MANIFEST_PATH);
  if (Object.keys(current.docs).length > 0) {
    return { path: INGEST_MANIFEST_PATH, manifest: current };
  }
  const legacy = await loadManifest(LEGACY_INGEST_MANIFEST_PATH);
  if (Object.keys(legacy.docs).length > 0) {
    return { path: LEGACY_INGEST_MANIFEST_PATH, manifest: legacy };
  }
  return { path: INGEST_MANIFEST_PATH, manifest: { docs: {} } };
}

export async function ingestDocuments(
  docsDir: string,
  log?: (message: string) => void
): Promise<IngestSummary> {
  const files = await listSupportedFiles(docsDir);
  if (files.length === 0) {
    throw new Error(`No supported files (.txt/.md/.pdf) found in ${docsDir}`);
  }
  log?.(`[ingest] start folder=${docsDir} files=${files.length}`);

  const llama = new LlamaClient();
  const chroma = new LocalChromaStore();
  const manifestResult = await readIngestManifest();
  const manifest = manifestResult.manifest;
  const nextManifest: IngestManifest = { docs: { ...manifest.docs } };
  const filesSet = new Set(files);

  const upserts: Array<{
    id: string;
    text: string;
    embedding: number[];
    title: string;
    docPath: string;
    docName: string;
    sectionPath: string;
    pageStart?: number;
    pageEnd?: number;
  }> = [];
  const deleteIds: string[] = [];
  let skippedUnchanged = 0;
  let changedDocs = 0;

  for (const [docPath, record] of Object.entries(manifest.docs)) {
    if (!isPathWithinRoot(docPath, docsDir)) {
      continue;
    }
    if (filesSet.has(docPath)) {
      continue;
    }
    log?.(`[ingest] removed doc detected in selected folder: ${docPath}`);
    deleteIds.push(...buildChunkIds(docPath, record.chunkCount));
    delete nextManifest.docs[docPath];
  }

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const path = files[fileIndex] as string;
    log?.(`[ingest] scanning ${fileIndex + 1}/${files.length}: ${path}`);
    const extracted = await extractTextFromFile(path);
    const contentHash = hashContent(extracted.text);
    const prior = manifest.docs[path];
    if (prior && prior.hash === contentHash) {
      log?.(`[ingest] unchanged, skipping embeddings: ${path}`);
      skippedUnchanged += 1;
      continue;
    }

    if (prior) {
      deleteIds.push(...buildChunkIds(path, prior.chunkCount));
    }

    const docName = basename(path);
    const chunks = buildChunksForFile(path, docName, extracted);
    changedDocs += 1;
    log?.(`[ingest] chunked file=${path} chunks=${chunks.length}`);
    nextManifest.docs[path] = { hash: contentHash, chunkCount: chunks.length };
    if (chunks.length === 0) {
      log?.(`[ingest] no chunks produced, skipping upsert: ${path}`);
      continue;
    }

    const totalBatches = Math.ceil(chunks.length / EMBED_BATCH_SIZE);
    for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
      const batchNum = Math.floor(start / EMBED_BATCH_SIZE) + 1;
      log?.(
        `[ingest] embedding file=${path} batch=${batchNum}/${totalBatches} chunkRange=${start + 1}-${Math.min(start + batch.length, chunks.length)}`
      );
      const embeddings = await llama.embed(batch.map((c) => c.text));
      let keptInBatch = 0;
      for (let i = 0; i < batch.length; i += 1) {
        const chunk = batch[i];
        const emb = embeddings[i];
        if (!chunk || !emb || emb.length === 0) continue;
        upserts.push({
          id: chunk.id,
          title: chunk.title,
          text: chunk.text,
          embedding: emb,
          docPath: path,
          docName,
          sectionPath: chunk.sectionPath,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd
        });
        keptInBatch += 1;
      }
      log?.(`[ingest] embedded file=${path} batch=${batchNum}/${totalBatches} kept=${keptInBatch}/${batch.length}`);
    }
  }

  log?.(`[ingest] chroma delete stale chunks count=${deleteIds.length}`);
  await chroma.deleteChunksByIds(deleteIds);
  log?.(`[ingest] chroma upsert chunks count=${upserts.length}`);
  await chroma.upsertChunks(upserts);
  await saveManifest(INGEST_MANIFEST_PATH, nextManifest);
  log?.(
    `[ingest] done changedDocs=${changedDocs} skippedUnchanged=${skippedUnchanged} upsertedChunks=${upserts.length} deletedChunks=${deleteIds.length}`
  );

  return {
    changedDocs,
    skippedUnchanged,
    upsertedChunks: upserts.length,
    deletedChunks: deleteIds.length,
    trackedDocuments: Object.keys(nextManifest.docs).length
  };
}
