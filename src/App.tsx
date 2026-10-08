import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type NumberRow = { number: string; occurrences: number };
type NumberStats = {
  schemaVersion?: number;
  checkedAt: string;
  videoId: string;
  reportedTotal: number | null;
  topLevelComplete: boolean;
  filters?: { from: string | null; to: string | null; minOccurrences: number };
  capturedCommentCount?: number;
  missingTimestampCount?: number;
  commentsSeen: number;
  relevantCommentCount: number;
  totalOccurrences: number;
  distinctNumberCount: number;
  repeatedNumberCount: number;
  qualifiedNumberCount?: number;
  rows: NumberRow[];
};
type CaptureReport = {
  inputUrl: string;
  resolvedUrl: string;
  loginPromptVisible: boolean;
  scrollStopReason: string;
  capturedReplyIds: number;
};
type CollectionResult = { stats: NumberStats; report: CaptureReport; outputDir: string };

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleString("zh-CN", { hour12: false });
}

function toLocalMinute(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const two = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

function App() {
  const [shareText, setShareText] = useState("");
  const [result, setResult] = useState<CollectionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [filterBusy, setFilterBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [minOccurrences, setMinOccurrences] = useState("2");

  useEffect(() => {
    invoke<CollectionResult | null>("load_last_result")
      .then(async (previous) => {
        if (!previous) return;
        const current = previous.stats.schemaVersion === 2
          ? previous
          : await invoke<CollectionResult>("filter_saved_comments", { fromTime: null, toTime: null, minOccurrences: 2 });
        setResult(current);
        setFromInput(toLocalMinute(current.stats.filters?.from));
        setToInput(toLocalMinute(current.stats.filters?.to));
        setMinOccurrences(String(current.stats.filters?.minOccurrences ?? 2));
      })
      .catch((cause) => setError(`读取旧报表失败：${String(cause)}`));
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const visibleRows = useMemo(() => {
    const rows = result?.stats.rows ?? [];
    const trimmed = query.trim();
    const threshold = result?.stats.filters?.minOccurrences ?? 2;
    return rows.filter((row) =>
      row.occurrences >= threshold && (!trimmed || row.number.includes(trimmed)),
    );
  }, [result, query]);

  function selectedFilters() {
    const minimum = Number(minOccurrences);
    if (!Number.isInteger(minimum) || minimum < 2) throw new Error("最小出现次数必须是大于或等于 2 的整数。");
    const fromMs = fromInput ? new Date(fromInput).getTime() : null;
    const toMs = toInput ? new Date(toInput).getTime() + 59_999 : null;
    if ((fromMs != null && !Number.isFinite(fromMs)) || (toMs != null && !Number.isFinite(toMs))) {
      throw new Error("请输入有效的评论时间。");
    }
    if (fromMs != null && toMs != null && fromMs > toMs) throw new Error("开始时间不能晚于结束时间。");
    return {
      fromTime: fromMs == null ? null : new Date(fromMs).toISOString(),
      toTime: toMs == null ? null : new Date(toMs).toISOString(),
      minOccurrences: minimum,
    };
  }

  async function collect() {
    if (busy) return;
    if (!shareText.trim()) {
      setError("请先粘贴抖音视频的分享文案或链接。");
      return;
    }
    let filters;
    try { filters = selectedFilters(); } catch (cause) { setError(String(cause)); return; }
    setBusy(true);
    setSeconds(0);
    setError("");
    setNotice("");
    try {
      const next = await invoke<CollectionResult>("collect_comments", { shareText, ...filters });
      setResult(next);
      setNotice(`已读取 ${next.stats.commentsSeen} 条评论/回复。`);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function applyFilters() {
    if (busy || !result) return;
    let filters;
    try { filters = selectedFilters(); } catch (cause) { setError(String(cause)); return; }
    setBusy(true);
    setFilterBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await invoke<CollectionResult>("filter_saved_comments", filters);
      setResult(next);
      setNotice(`已重新统计 ${next.stats.commentsSeen} 条时间范围内评论。`);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
      setFilterBusy(false);
    }
  }

  async function login() {
    if (busy) return;
    if (!shareText.trim()) {
      setError("请先粘贴抖音视频的分享文案或链接，再打开扫码窗口。");
      return;
    }
    setBusy(true);
    setLoginBusy(true);
    setError("");
    setNotice("");
    try {
      await invoke("login_to_douyin", { shareText: shareText.trim() });
      setNotice("登录状态已保存，可以开始采集。");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
      setLoginBusy(false);
    }
  }

  async function openFolder() {
    if (!result) return;
    try {
      await invoke("open_report_folder", { path: result.outputDir });
    } catch (cause) {
      setError(String(cause));
    }
  }

  const stats = result?.stats;
  const threshold = stats?.filters?.minOccurrences ?? 2;
  const qualifiedRows = stats?.rows.filter((row) => row.occurrences >= threshold) ?? [];
  const topRows = qualifiedRows.slice(0, 3);
  const statusText = loginBusy ? "请在打开的浏览器里完成扫码" : filterBusy ? "正在重新统计已保存的评论" : busy ? `正在读取评论 · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : notice || "等待采集";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i>0</i><i>3</i><i>6</i></span>
          <div><strong>评论号码台</strong><small>DOUYIN COMMENT / 3D</small></div>
        </div>
        <span className="topbar-note">本地采集 · 登录资料保存在本机</span>
      </header>

      <main className="main-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">福彩 3D / 评论观察</p>
            <h1>从评论里，找出被提到的号码。</h1>
            <p className="lead">粘贴公开视频分享内容，读取页面加载的评论，筛选三位数并统计出现次数。</p>
          </div>
          <div className="heading-rule" aria-hidden="true"><span>000</span><span>999</span></div>
        </div>

        <div className="workspace">
          <section className="control-panel" aria-labelledby="input-title">
            <div className="panel-heading"><span className="section-index">01 / 输入</span><h2 id="input-title">视频分享内容</h2></div>
            <label className="field-label" htmlFor="share-text">分享文案或视频链接</label>
            <textarea
              id="share-text"
              value={shareText}
              onChange={(event) => setShareText(event.target.value)}
              placeholder="粘贴抖音分享文案，或直接输入视频链接"
              rows={6}
              disabled={busy}
            />
            <p className="field-help">可直接粘贴整段分享文案，工具会提取其中的视频链接。</p>

            <div className="filter-fields">
              <div className="filter-title"><span className="field-label">条件筛选</span><small>按评论发布时间</small></div>
              <label htmlFor="time-from">开始时间</label>
              <input id="time-from" type="datetime-local" step="60" value={fromInput} onChange={(event) => setFromInput(event.target.value)} disabled={busy} />
              <label htmlFor="time-to">结束时间（含该分钟）</label>
              <input id="time-to" type="datetime-local" step="60" value={toInput} onChange={(event) => setToInput(event.target.value)} disabled={busy} />
              <label htmlFor="minimum-count">最小出现次数</label>
              <input id="minimum-count" type="number" inputMode="numeric" min="2" step="1" value={minOccurrences} onChange={(event) => setMinOccurrences(event.target.value)} disabled={busy} />
              <p>时间留空表示不限；使用本机时间。每个号码在同一条评论中只计一次。</p>
            </div>

            <button className="collect-button" type="button" onClick={collect} disabled={busy}>
              {loginBusy ? "等待扫码…" : filterBusy ? "正在应用筛选…" : busy ? "正在采集…" : "开始提取号码"}<span aria-hidden="true">↗</span>
            </button>
            <button className="apply-button" type="button" onClick={applyFilters} disabled={busy || !result}>应用筛选到已采集评论</button>
            <div className={`run-state ${busy ? "is-busy" : ""}`} role="status">
              <span className="state-dot" />{statusText}
            </div>
            {error && <div className="error-message" role="alert">{error}</div>}
            <button className="login-button" type="button" onClick={login} disabled={busy}>登录失效？打开扫码窗口</button>
            <div className="control-footnote">默认滚动到网页提示顶层评论没有更多。统计仅包含实际加载的评论；调整筛选条件后可直接重新统计本机已保存的评论。</div>
          </section>

          <section className="result-panel" aria-labelledby="result-title">
            <div className="result-header">
              <div><span className="section-index">02 / 结果</span><h2 id="result-title">号码频次</h2></div>
              {result && <button className="text-button" type="button" onClick={openFolder}>打开报表文件夹 <span aria-hidden="true">↗</span></button>}
            </div>

            {!stats ? (
              <div className="empty-state">
                <div className="empty-cells" aria-hidden="true"><span>—</span><span>—</span><span>—</span></div>
                <h3>还没有统计结果</h3>
                <p>在左侧输入分享内容并开始采集，号码频次会显示在这里。</p>
              </div>
            ) : (
              <>
                <div className="result-meta">
                  <span>视频 {stats.videoId}</span>
                  <span>{formatTime(stats.checkedAt)}</span>
                </div>
                <div className="active-range">评论时间：{stats.filters?.from ? formatTime(stats.filters.from) : "不限"} — {stats.filters?.to ? toLocalMinute(stats.filters.to)?.replace("T", " ") : "不限"}<span>最少 {threshold} 次</span></div>
                <div className="summary-grid">
                  <div><span>时间范围内</span><strong>{stats.commentsSeen}</strong><small>条评论/回复</small></div>
                  <div><span>含号码评论</span><strong>{stats.relevantCommentCount}</strong><small>条</small></div>
                  <div><span>号码提及</span><strong>{stats.totalOccurrences}</strong><small>次，每条评论同号只计一次</small></div>
                  <div><span>符合次数</span><strong>{stats.qualifiedNumberCount ?? qualifiedRows.length}</strong><small>个号码</small></div>
                </div>

                {topRows.length > 0 && <div className="leaders">
                  <div className="leaders-heading"><span>出现次数最多</span><small>号码 / 次数</small></div>
                  <div className="leader-items">
                    {topRows.map((row, index) => <div className="leader" key={row.number}><small>0{index + 1}</small><strong>{row.number}</strong><span>{row.occurrences} 次</span></div>)}
                  </div>
                </div>}

                <div className="table-tools">
                  <div><h3>号码明细</h3><span>{stats.qualifiedNumberCount ?? qualifiedRows.length} 个号码出现至少 {threshold} 次</span></div>
                  <div className="table-actions">
                    <label className="visually-hidden" htmlFor="number-search">查找号码</label>
                    <input id="number-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查找号码" inputMode="numeric" />
                  </div>
                </div>
                <div className="table-scroll">
                  <table><thead><tr><th>号码</th><th>出现次数（按评论去重）</th></tr></thead>
                    <tbody>{visibleRows.map((row) => <tr key={row.number}><td className="number-cell">{row.number}</td><td><div className="count-cell"><strong>{row.occurrences}</strong><span className="count-track"><i style={{ width: `${Math.max(5, (row.occurrences / (stats.rows[0]?.occurrences || 1)) * 100)}%` }} /></span></div></td></tr>)}</tbody>
                  </table>
                  {visibleRows.length === 0 && <div className="no-match">没有符合当前条件的号码，可调整时间或最小次数。</div>}
                </div>
                <div className="result-note">
                  <strong>{stats.topLevelComplete ? "网页提示顶层评论已无更多" : "本次只读取了部分评论"}</strong>
                  <span>实际读取 {stats.capturedCommentCount ?? stats.commentsSeen} 条；页面报告总数 {stats.reportedTotal ?? "未知"}，两者可能不同。本次{result?.report.capturedReplyIds ? `还读取了 ${result.report.capturedReplyIds} 条回复` : "未展开回复"}。</span>
                  {!!stats.missingTimestampCount && <span>{stats.missingTimestampCount} 条已保存评论缺少发布时间，时间筛选时未计入。</span>}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;
