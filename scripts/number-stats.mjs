const THREE_DIGITS = /(?<![0-9A-Za-z])[0-9]{3}(?![0-9A-Za-z])/gu;
const URL_IN_COMMENT = /https?:\/\/\S+/giu;
const NON_PICK_SUFFIX = /^(?:\.\d+)?\s*(?:元|块|岁|楼|期|人|个|次|天|分钟?|秒|票|注|斤|公里|米|万|倍|条|%|％)/u;

export function extractThreeDigitNumbers(commentText) {
  if (typeof commentText !== "string") return [];
  const text = commentText.normalize("NFKC").replace(URL_IN_COMMENT, " ");
  const numbers = [];

  for (const match of text.matchAll(THREE_DIGITS)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    if (/[¥￥#]/u.test(before.at(-1) ?? "")) continue;
    if (NON_PICK_SUFFIX.test(after)) continue;
    const dottedPrefix = /(\d+)\.$/u.exec(before);
    if (dottedPrefix && dottedPrefix[1].length < 3) continue;
    numbers.push(match[0]);
  }

  return numbers;
}

export function normalizeNumberFilters({ from = null, to = null, minOccurrences = 2 } = {}) {
  const parseTime = (value, label) => {
    if (value == null || value === "") return null;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) throw new Error(`${label}不是有效时间`);
    return new Date(time).toISOString();
  };
  const normalized = {
    from: parseTime(from, "开始时间"),
    to: parseTime(to, "结束时间"),
    minOccurrences: Number(minOccurrences),
  };
  if (!Number.isInteger(normalized.minOccurrences) || normalized.minOccurrences < 2) {
    throw new Error("最小出现次数必须是大于或等于 2 的整数");
  }
  if (normalized.from && normalized.to && normalized.from > normalized.to) {
    throw new Error("开始时间不能晚于结束时间");
  }
  return normalized;
}

export function summarizeThreeDigitNumbers(comments, filters = {}) {
  const selected = normalizeNumberFilters(filters);
  const counts = new Map();
  const matchedComments = [];
  const seenIds = new Set();
  let capturedCommentCount = 0;
  let missingTimestampCount = 0;
  let commentsSeen = 0;
  let totalOccurrences = 0;

  for (const comment of comments) {
    if (comment.id != null) {
      const key = `${comment.kind ?? "comment"}:${comment.id}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
    }
    capturedCommentCount += 1;
    const createdAtMs = comment.createdAt ? Date.parse(comment.createdAt) : NaN;
    if (!Number.isFinite(createdAtMs)) missingTimestampCount += 1;
    if (selected.from || selected.to) {
      if (!Number.isFinite(createdAtMs)) continue;
      if (selected.from && createdAtMs < Date.parse(selected.from)) continue;
      if (selected.to && createdAtMs > Date.parse(selected.to)) continue;
    }
    commentsSeen += 1;
    const numbers = [...new Set(extractThreeDigitNumbers(comment.text))];
    if (!numbers.length) continue;
    matchedComments.push({ id: comment.id ?? null, kind: comment.kind ?? "comment", createdAt: comment.createdAt ?? null, text: comment.text, numbers });
    totalOccurrences += numbers.length;
    for (const number of numbers) {
      const count = counts.get(number) ?? { number, occurrences: 0 };
      count.occurrences += 1;
      counts.set(number, count);
    }
  }

  if ((selected.from || selected.to) && capturedCommentCount > 0 && missingTimestampCount === capturedCommentCount) {
    throw new Error("已保存的评论没有发布时间，请重新采集视频后使用时间筛选");
  }
  const rows = [...counts.values()].sort((a, b) => b.occurrences - a.occurrences || a.number.localeCompare(b.number));
  return {
    filters: selected,
    capturedCommentCount,
    missingTimestampCount,
    commentsSeen,
    relevantCommentCount: matchedComments.length,
    totalOccurrences,
    distinctNumberCount: rows.length,
    repeatedNumberCount: rows.filter((row) => row.occurrences >= 2).length,
    qualifiedNumberCount: rows.filter((row) => row.occurrences >= selected.minOccurrences).length,
    rows,
    matchedComments,
  };
}
