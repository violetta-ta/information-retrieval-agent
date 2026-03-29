import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IndexedDoc } from "./types.js";

interface StoreData {
  docs: IndexedDoc[];
}

const EMPTY_STORE: StoreData = { docs: [] };

export async function readStore(path: string): Promise<StoreData> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as StoreData;
    if (!Array.isArray(parsed.docs)) {
      return EMPTY_STORE;
    }
    return { docs: parsed.docs };
  } catch {
    return EMPTY_STORE;
  }
}

export async function writeStore(path: string, data: StoreData): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}
