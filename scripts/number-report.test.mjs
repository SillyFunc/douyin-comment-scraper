import assert from "node:assert/strict";
import test from "node:test";
import { formatNumberCsv, formatNumberReport } from "./number-report.mjs";
import { summarizeThreeDigitNumbers } from "./number-stats.mjs";

test("text report shows the screenshot's summary fields and repeated numbers", () => {
  const stats = summarizeThreeDigitNumbers([{ text: "111 111 123" }, { text: "111" }]);
  const report = formatNumberReport(stats, { reportedTotal: 10, complete: false });
  assert.match(report, /号码提及总次数（每条评论同号只计一次）：3/u);
  assert.match(report, /不同三位数数量：2/u);
  assert.match(report, /重复出现的三位数数量（出现 >= 2 次）：1/u);
  assert.match(report, /111\t2/u);
  assert.doesNotMatch(report, /123\t1/u);
});

test("CSV applies the minimum count and preserves a leading zero", () => {
  const stats = summarizeThreeDigitNumbers([{ text: "012 123" }, { text: "012" }]);
  assert.match(formatNumberCsv(stats), /^\uFEFF号码,出现次数\r\n012,2\r\n$/u);
  const stricter = summarizeThreeDigitNumbers([{ text: "012 123" }, { text: "012" }], { minOccurrences: 3 });
  assert.equal(formatNumberCsv(stricter), "\uFEFF号码,出现次数\r\n");
});
