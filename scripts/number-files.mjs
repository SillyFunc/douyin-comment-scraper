import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { summarizeThreeDigitNumbers } from "./number-stats.mjs";
import { formatNumberCsv, formatNumberReport } from "./number-report.mjs";

export async function writeNumberFiles(outputDir, source, filters = {}) {
  const comments = [...source.comments];
  const stats = summarizeThreeDigitNumbers(comments, filters);
  const { matchedComments, ...summary } = stats;
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, "captured-comments.json"), `${JSON.stringify({
      checkedAt: source.checkedAt,
      videoId: source.videoId,
      reportedTotal: source.reportedTotal,
      topLevelComplete: source.topLevelComplete,
      comments,
    }, null, 2)}\n`, "utf8"),
    writeFile(path.join(outputDir, "number-stats.json"), `${JSON.stringify({
      schemaVersion: 2,
      checkedAt: source.checkedAt,
      processedAt: new Date().toISOString(),
      videoId: source.videoId,
      reportedTotal: source.reportedTotal,
      topLevelComplete: source.topLevelComplete,
      ...summary,
    }, null, 2)}\n`, "utf8"),
    writeFile(path.join(outputDir, "number-stats.txt"), formatNumberReport(stats, { reportedTotal: source.reportedTotal, complete: source.topLevelComplete }), "utf8"),
    writeFile(path.join(outputDir, "number-stats.csv"), formatNumberCsv(stats), "utf8"),
    writeFile(path.join(outputDir, "matched-comments.json"), `${JSON.stringify(matchedComments, null, 2)}\n`, "utf8"),
  ]);
  return stats;
}
