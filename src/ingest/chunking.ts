export interface Chunk {
  id: string;
  title: string;
  text: string;
  sectionPath: string;
  pageStart?: number;
  pageEnd?: number;
}

type BlockType = "prose" | "code" | "list" | "table";

interface Block {
  type: BlockType;
  sectionPath: string;
  text: string;
}

const CHUNK_POLICY: Record<BlockType, { maxChars: number; overlapChars: number }> = {
  prose: { maxChars: 1400, overlapChars: 220 },
  code: { maxChars: 900, overlapChars: 120 },
  list: { maxChars: 1100, overlapChars: 180 },
  table: { maxChars: 1100, overlapChars: 180 }
};

function normalizeLinks(input: string): string {
  return input
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 (link: $2)")
    .replace(/<((?:https?:\/\/)[^>\s]+)>/g, "$1");
}

function normalizeBody(input: string, type: BlockType): string {
  const linked = normalizeLinks(input);
  if (type === "code") {
    return linked.trim();
  }
  return linked
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();
}

function splitWithOverlap(text: string, maxChars: number, overlapChars: number): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const parts: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const idealEnd = Math.min(normalized.length, start + maxChars);
    let end = idealEnd;
    if (idealEnd < normalized.length) {
      const minBreak = start + Math.floor(maxChars * 0.6);
      const newlineBreak = normalized.lastIndexOf("\n", idealEnd);
      const spaceBreak = normalized.lastIndexOf(" ", idealEnd);
      if (newlineBreak >= minBreak) {
        end = newlineBreak;
      } else if (spaceBreak >= minBreak) {
        end = spaceBreak;
      }
    }

    const piece = normalized.slice(start, end).trim();
    if (piece) {
      parts.push(piece);
    }
    if (end >= normalized.length) {
      break;
    }
    const nextStart = Math.max(start + 1, end - overlapChars);
    start = nextStart > start ? nextStart : end;
  }
  return parts;
}

function sectionTitle(sectionPath: string, fallbackTitle: string): string {
  if (!sectionPath) return fallbackTitle;
  const clipped = sectionPath.length > 140 ? `${sectionPath.slice(0, 139)}…` : sectionPath;
  return `${fallbackTitle} :: ${clipped}`;
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const sectionStack: string[] = [];
  let inCodeFence = false;
  let currentType: BlockType | null = null;
  let currentLines: string[] = [];

  const flushCurrent = () => {
    if (!currentType || currentLines.length === 0) return;
    const sectionPath = sectionStack.join(" > ");
    const body = normalizeBody(currentLines.join("\n"), currentType);
    if (body) {
      blocks.push({ type: currentType, sectionPath, text: body });
    }
    currentType = null;
    currentLines = [];
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!inCodeFence && heading?.[1] && heading[2]) {
      flushCurrent();
      const level = heading[1].length;
      sectionStack.splice(level - 1);
      sectionStack[level - 1] = heading[2].trim();
      continue;
    }

    if (/^\s*```/.test(line)) {
      if (!inCodeFence) {
        flushCurrent();
        inCodeFence = true;
        currentType = "code";
        currentLines.push(line);
      } else {
        currentLines.push(line);
        flushCurrent();
        inCodeFence = false;
      }
      continue;
    }

    if (inCodeFence) {
      currentLines.push(line);
      continue;
    }

    if (line.trim().length === 0) {
      flushCurrent();
      continue;
    }

    const inferredType: BlockType = /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
      ? "list"
      : /\|/.test(line) && /^\s*\|?.+\|.+\|?\s*$/.test(line)
        ? "table"
        : "prose";

    if (currentType !== inferredType) {
      flushCurrent();
      currentType = inferredType;
    }
    currentLines.push(line);
  }
  flushCurrent();
  return blocks;
}

interface ChunkTextOptions {
  idPrefix?: string;
  startIndex?: number;
  pageStart?: number;
  pageEnd?: number;
}

export function chunkText(docId: string, title: string, text: string, options: ChunkTextOptions = {}): Chunk[] {
  const blocks = parseBlocks(text);
  const chunks: Chunk[] = [];
  let idx = options.startIndex ?? 0;
  const idPrefix = options.idPrefix ?? docId;

  for (const block of blocks) {
    const policy = CHUNK_POLICY[block.type];
    const pieces = splitWithOverlap(block.text, policy.maxChars, policy.overlapChars);
    for (const piece of pieces) {
      const header = [`Section: ${block.sectionPath || "root"}`, `BlockType: ${block.type}`].join("\n");
      chunks.push({
        id: `${idPrefix}_chunk_${idx}`,
        title: sectionTitle(block.sectionPath, title),
        text: `${header}\n${piece}`,
        sectionPath: block.sectionPath || "root",
        pageStart: options.pageStart,
        pageEnd: options.pageEnd
      });
      idx += 1;
    }
  }

  return chunks;
}
