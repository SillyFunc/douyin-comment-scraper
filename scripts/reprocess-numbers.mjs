import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeNumberFiles } from "./number-files.mjs";
import { normalizeNumberFilters } from "./number-stats.mjs";

try {
  let outputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".phase1");
  const filters = { from: null, to: null, minOccurrences: 2 };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} 需要参数值`);
    index += 1;
    if (arg === "--output-dir") outputDir = path.resolve(value);
    else if (arg === "--from") filters.from = value;
    else if (arg === "--to") filters.to = value;
    else if (arg === "--min-occurrences") filters.minOccurrences = Number(value);
    else throw new Error(`未知参数：${arg}`);
  }
  normalizeNumberFilters(filters);
  const source = JSON.parse(await readFile(path.join(outputDir, "captured-comments.json"), "utf8"));
  const stats = await writeNumberFiles(outputDir, source, filters);
  console.log(`从 ${stats.capturedCommentCount} 条已保存评论中筛出 ${stats.commentsSeen} 条时间范围内评论，其中 ${stats.relevantCommentCount} 条含号码，共 ${stats.totalOccurrences} 次号码提及。`);
  console.log(path.join(outputDir, "number-stats.txt"));
} catch (error) {
  console.error(`无法重新统计：${error.message}`);
  process.exitCode = 1;
}
