import assert from "node:assert/strict";
import test from "node:test";
import { extractThreeDigitNumbers, normalizeNumberFilters, summarizeThreeDigitNumbers } from "./number-stats.mjs";

test("extracts picks from the examples in real comments", () => {
  assert.deepEqual(extractThreeDigitNumbers("681  683"), ["681", "683"]);
  assert.deepEqual(extractThreeDigitNumbers("414\n406"), ["414", "406"]);
  assert.deepEqual(extractThreeDigitNumbers("惊天五注：558，525，725，729，891！必中"), ["558", "525", "725", "729", "891"]);
  assert.deepEqual(extractThreeDigitNumbers("今晚268，祝大家好运"), ["268"]);
  assert.deepEqual(extractThreeDigitNumbers("444.134.456，321.550"), ["444", "134", "456", "321", "550"]);
});

test("keeps leading zeroes and normalizes fullwidth digits", () => {
  assert.deepEqual(extractThreeDigitNumbers("０１２、345，000，111，121"), ["012", "345", "000", "111", "121"]);
});

test("filters comments without three-digit picks and obvious non-pick numbers", () => {
  assert.deepEqual(extractThreeDigitNumbers("大家好运，2026年10月，电话13800000000"), []);
  assert.deepEqual(extractThreeDigitNumbers("买了100元，第123期，中奖200块，打300倍，投456"), ["456"]);
  assert.deepEqual(extractThreeDigitNumbers("买100 元，打200 倍，金额300.50元，选456"), ["456"]);
  assert.deepEqual(extractThreeDigitNumbers("https://example.com/123 今晚789"), ["789"]);
  assert.deepEqual(extractThreeDigitNumbers("用户abc123、赔率1.234、#555"), []);
});

test("counts each number once per comment and deduplicates comment IDs", () => {
  const result = summarizeThreeDigitNumbers([
    { id: "a", text: "123 123，456" },
    { id: "a", text: "123 123，456" },
    { id: "b", text: "今晚123" },
    { id: "c", text: "路过" },
  ]);
  assert.equal(result.commentsSeen, 3);
  assert.equal(result.relevantCommentCount, 2);
  assert.equal(result.totalOccurrences, 3);
  assert.equal(result.distinctNumberCount, 2);
  assert.equal(result.repeatedNumberCount, 1);
  assert.deepEqual(result.rows, [
    { number: "123", occurrences: 2 },
    { number: "456", occurrences: 1 },
  ]);
  assert.deepEqual(result.matchedComments[0].numbers, ["123", "456"]);
});

test("filters by comment publish time with inclusive boundaries", () => {
  const comments = [
    { id: "before", text: "123", createdAt: "2026-10-08T01:59:59.000Z" },
    { id: "start", text: "123 123 456", createdAt: "2026-10-08T02:00:00.000Z" },
    { id: "end", text: "123", createdAt: "2026-10-08T03:00:00.000Z" },
    { id: "after", text: "456", createdAt: "2026-10-08T03:00:01.000Z" },
  ];
  const result = summarizeThreeDigitNumbers(comments, { from: "2026-10-08T02:00:00.000Z", to: "2026-10-08T03:00:00.000Z", minOccurrences: 2 });
  assert.equal(result.capturedCommentCount, 4);
  assert.equal(result.commentsSeen, 2);
  assert.equal(result.relevantCommentCount, 2);
  assert.equal(result.totalOccurrences, 3);
  assert.equal(result.qualifiedNumberCount, 1);
  assert.deepEqual(result.rows, [{ number: "123", occurrences: 2 }, { number: "456", occurrences: 1 }]);
});

test("rejects invalid thresholds and time filtering of legacy records", () => {
  assert.throws(() => normalizeNumberFilters({ minOccurrences: 1 }), /大于或等于 2/u);
  assert.throws(() => normalizeNumberFilters({ from: "2026-10-09", to: "2026-10-08" }), /开始时间/u);
  assert.throws(() => summarizeThreeDigitNumbers([{ id: "a", text: "123" }], { from: "2026-10-08" }), /没有发布时间/u);
});
