export function formatNumberReport(stats, { reportedTotal = null, complete = false } = {}) {
  const minOccurrences = stats.filters?.minOccurrences ?? 2;
  const lines = [
    `页面报告评论总数（参考）：${reportedTotal ?? "未知"}`,
    `实际读取评论/回复数：${stats.capturedCommentCount}`,
    `评论时间：${stats.filters?.from ?? "不限"} 至 ${stats.filters?.to ?? "不限"}（含边界）`,
    `时间范围内评论/回复数：${stats.commentsSeen}`,
    `含三位数的评论数：${stats.relevantCommentCount}`,
    `号码提及总次数（每条评论同号只计一次）：${stats.totalOccurrences}`,
    `不同三位数数量：${stats.distinctNumberCount}`,
    `重复出现的三位数数量（出现 >= 2 次）：${stats.repeatedNumberCount}`,
    `最小出现次数：${minOccurrences}；符合条件号码：${stats.qualifiedNumberCount}`,
    `缺少发布时间的评论/回复：${stats.missingTimestampCount}`,
    `采集状态：${complete ? "网页提示顶层评论已无更多" : "部分数据，网页仍可能有更多评论"}`,
    "说明：页面报告总数与实际读取数可能不同，统计只针对实际读取的内容。",
    "",
    "号码\t出现次数",
    ...stats.rows.filter((row) => row.occurrences >= minOccurrences).map((row) => `${row.number}\t${row.occurrences}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatNumberCsv(stats) {
  const minOccurrences = stats.filters?.minOccurrences ?? 2;
  const rows = stats.rows.filter((row) => row.occurrences >= minOccurrences).map((row) => `${row.number},${row.occurrences}`);
  return `\uFEFF号码,出现次数\r\n${rows.length ? `${rows.join("\r\n")}\r\n` : ""}`;
}
