import { readFile } from "node:fs/promises";
import { config } from "../config.js";

async function main(): Promise<void> {
  const content = await readFile(config.TOOL_AUDIT_LOG, "utf-8");
  const lines = content.trim().split("\n");
  const count = Number(process.argv[2] ?? "20");
  const sample = lines.slice(Math.max(0, lines.length - count));
  for (const line of sample) {
    console.log(line);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
