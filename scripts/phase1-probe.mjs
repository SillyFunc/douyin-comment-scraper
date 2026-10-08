import { mkdir, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { extractDouyinUrl, videoIdFromUrl } from "./share-link.mjs";
import { writeNumberFiles } from "./number-files.mjs";
import { normalizeNumberFilters } from "./number-stats.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const profileDir = path.join(localData, "douyin-comment-scraper", "phase1-chrome-profile");

function parseArgs(args) {
  const options = { login: false, guiLogin: false, headless: false, stats: false, scrolls: 3, replies: 0, waitMs: 1800, outputDir: path.join(projectRoot, ".phase1"), from: null, to: null, minOccurrences: 2, text: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--login") options.login = true;
    else if (arg === "--gui-login") { options.login = true; options.guiLogin = true; }
    else if (arg === "--headless") options.headless = true;
    else if (arg === "--stats") options.stats = true;
    else if (arg === "--until-end") { options.stats = true; options.scrolls = 300; }
    else if (arg === "--scrolls") options.scrolls = Number(args[++index]);
    else if (arg === "--replies") options.replies = Number(args[++index]);
    else if (arg === "--wait-ms") options.waitMs = Number(args[++index]);
    else if (arg === "--from") options.from = args[++index];
    else if (arg === "--to") options.to = args[++index];
    else if (arg === "--min-occurrences") options.minOccurrences = Number(args[++index]);
    else if (arg === "--output-dir") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--output-dir 需要目录路径");
      options.outputDir = path.resolve(value);
    }
    else if (arg.startsWith("--")) throw new Error(`未知参数：${arg}`);
    else options.text.push(arg);
  }
  if (!Number.isInteger(options.scrolls) || options.scrolls < 0 || options.scrolls > 300) {
    throw new Error("--scrolls 必须是 0 到 300 的整数");
  }
  if (!Number.isInteger(options.replies) || options.replies < 0 || options.replies > 10) {
    throw new Error("--replies 必须是 0 到 10 的整数");
  }
  if (!Number.isInteger(options.waitMs) || options.waitMs < 300 || options.waitMs > 30000) {
    throw new Error("--wait-ms 必须是 300 到 30000 的整数");
  }
  if (options.login && options.headless) throw new Error("登录时不能使用 --headless");
  normalizeNumberFilters(options);
  return options;
}

async function getShareText(options) {
  if (options.text.length) return options.text.join(" ");
  throw new Error("请传入分享文案或链接");
}

async function loginPromptVisible(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? "";
    return text.includes("请先登录后发表评论") || text.includes("登录后即可参与互动讨论") || text.includes("登录后免费畅享高清视频");
  });
}

async function scrollCommentPanel(page) {
  return page.locator('[data-e2e="comment-list"]').evaluate((node) => {
    let scrollable = node;
    while (scrollable && !(scrollable.scrollHeight > scrollable.clientHeight + 100 && scrollable.clientHeight > 100)) {
      scrollable = scrollable.parentElement;
    }
    if (!scrollable) return false;
    scrollable.scrollTop = scrollable.scrollHeight;
    return true;
  });
}

async function nudgeCommentPanel(page) {
  await page.locator('[data-e2e="comment-list"]').evaluate((node) => {
    let scrollable = node;
    while (scrollable && !(scrollable.scrollHeight > scrollable.clientHeight + 100 && scrollable.clientHeight > 100)) {
      scrollable = scrollable.parentElement;
    }
    if (scrollable) scrollable.scrollTop = Math.max(0, scrollable.scrollTop - 600);
  });
  await page.waitForTimeout(300);
  return scrollCommentPanel(page);
}

async function saveReport(reportDir, name, report) {
  await mkdir(reportDir, { recursive: true });
  const target = path.join(reportDir, name);
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`报告：${target}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reportDir = options.outputDir;
  const shareText = await getShareText(options);
  const inputUrl = extractDouyinUrl(shareText);
  const profileExistedBefore = await stat(profileDir).then(() => true, () => false);
  await mkdir(profileDir, { recursive: true });

  console.log(`分享链接：${inputUrl}`);
  console.log(`浏览器资料目录：${profileDir}`);
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: options.headless,
    viewport: { width: 1440, height: 900 },
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    const networkPages = [];
    const commentIds = new Set();
    const replyPages = [];
    const replyIds = new Set();
    const collectedComments = new Map();
    let topHasMore = null;
    const pending = new Set();

    page.on("response", (response) => {
      let url;
      try { url = new URL(response.url()); } catch { return; }
      const isReply = url.pathname.endsWith("/comment/list/reply/");
      if (!isReply && !url.pathname.endsWith("/comment/list/")) return;
      const task = (async () => {
        try {
          const data = await response.json();
          const comments = Array.isArray(data.comments) ? data.comments : [];
          for (const comment of comments) {
            if (comment.cid) {
              const id = String(comment.cid);
              (isReply ? replyIds : commentIds).add(id);
              collectedComments.set(`${isReply ? "reply" : "comment"}:${id}`, {
                id,
                kind: isReply ? "reply" : "comment",
                text: typeof comment.text === "string" ? comment.text : "",
                createdAt: Number.isFinite(Number(comment.create_time)) && Number(comment.create_time) > 0
                  ? new Date(Number(comment.create_time) * 1000).toISOString()
                  : null,
              });
            }
          }
          if (!isReply && (data.has_more === 0 || data.has_more === 1)) topHasMore = data.has_more;
          (isReply ? replyPages : networkPages).push({
            status: response.status(),
            cursor: data.cursor ?? null,
            hasMore: data.has_more ?? null,
            reportedTotal: data.total ?? null,
            received: comments.length,
          });
        } catch (error) {
          (isReply ? replyPages : networkPages).push({ status: response.status(), error: String(error) });
        }
      })();
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });

    await page.goto(inputUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const resolvedUrl = page.url();
    const videoId = videoIdFromUrl(resolvedUrl);
    if (!videoId) throw new Error(`短链没有跳转到支持的视频页：${resolvedUrl}`);
    console.log(`视频页面：${resolvedUrl}`);

    if (options.login) {
      if (options.guiLogin) {
        let loggedIn = false;
        for (let attempt = 0; attempt < 150; attempt += 1) {
          if (page.isClosed()) throw new Error("登录窗口已关闭，请重新打开并扫码");
          if (!await loginPromptVisible(page)) { loggedIn = true; break; }
          await page.waitForTimeout(2000);
        }
        if (!loggedIn) throw new Error("等待扫码登录超时，请重试");
      } else {
        if (!process.stdin.isTTY) throw new Error("--login 需要在可交互终端中运行");
        const reader = createInterface({ input: process.stdin, output: process.stdout });
        try {
          await reader.question("请在浏览器里完成登录，然后回到终端按 Enter：");
        } finally {
          reader.close();
        }
      }
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const report = {
        checkedAt: new Date().toISOString(), inputUrl, resolvedUrl: page.url(),
        profileExistedBefore, loginPromptVisible: await loginPromptVisible(page),
      };
      await saveReport(reportDir, "login-report.json", report);
      console.log(report.loginPromptVisible ? "页面仍显示登录提示，请检查是否登录成功。" : "页面未显示评论登录提示；请另起一次 probe 验证复用。");
      return;
    }

    const commentList = page.locator('[data-e2e="comment-list"]');
    const commentListFound = await commentList.waitFor({ timeout: 15000 }).then(() => true, () => false);
    if (commentListFound) {
      await page.locator('[data-e2e="comment-item"]').first().waitFor({ timeout: 10000 }).catch(() => {});
    }
    if (options.stats && await loginPromptVisible(page)) {
      throw new Error("登录状态已失效，请打开扫码窗口重新登录");
    }
    const scrollResults = [];
    let scrollStopReason = "scroll_limit";
    let idleScrolls = 0;
    for (let index = 0; index < options.scrolls && commentListFound; index += 1) {
      const previousCount = commentIds.size;
      const scrolled = idleScrolls > 0 ? await nudgeCommentPanel(page) : await scrollCommentPanel(page);
      await page.waitForTimeout(options.waitMs + Math.min(idleScrolls * 1000, 4000));
      await Promise.allSettled([...pending]);
      if (options.stats && await loginPromptVisible(page)) {
        throw new Error("登录状态已失效，请打开扫码窗口重新登录");
      }
      scrollResults.push({ attempt: index + 1, scrolled, domItems: await page.locator('[data-e2e="comment-item"]').count(), capturedIds: commentIds.size, hasMore: topHasMore });
      if (!scrolled) { scrollStopReason = "scroll_target_missing"; break; }
      if (topHasMore === 0) { scrollStopReason = "page_has_no_more"; break; }
      idleScrolls = commentIds.size > previousCount ? 0 : idleScrolls + 1;
      if (idleScrolls >= 6) { scrollStopReason = "no_new_comments_after_six_retries"; break; }
    }
    const replyActions = [];
    for (let index = 0; index < options.replies && commentListFound; index += 1) {
      const button = page.getByText(/^展开\d+条回复$/u).first();
      if (!await button.count()) break;
      try {
        await button.click({ timeout: 5000 });
        await page.waitForTimeout(options.waitMs);
        replyActions.push({ attempt: index + 1, clicked: true });
      } catch (error) {
        replyActions.push({ attempt: index + 1, clicked: false, error: String(error) });
        break;
      }
    }
    await Promise.allSettled([...pending]);
    if (options.stats && scrollStopReason === "no_new_comments_after_six_retries") {
      await mkdir(reportDir, { recursive: true });
      await page.screenshot({ path: path.join(reportDir, "stalled-page.png"), fullPage: false });
    }
    const report = {
      checkedAt: new Date().toISOString(),
      inputUrl, resolvedUrl, videoId,
      title: await page.title(),
      profileExistedBefore,
      loginPromptVisible: await loginPromptVisible(page),
      commentListFound,
      domCommentItems: await page.locator('[data-e2e="comment-item"]').count(),
      capturedCommentIds: commentIds.size,
      commentsWithText: [...collectedComments.values()].filter((comment) => comment.kind === "comment" && comment.text.trim()).length,
      networkPages,
      scrollStopReason,
      capturedReplyIds: replyIds.size,
      replyPages,
      scrollResults,
      replyActions,
      note: "DOM 评论项计数包含已展开的回复；仅记录页面实际加载的响应，不能证明已获取全部评论。",
    };
    await saveReport(reportDir, "last-report.json", report);
    console.log(`页面评论项：${report.domCommentItems}；捕获的唯一评论 ID：${report.capturedCommentIds}；登录提示：${report.loginPromptVisible ? "有" : "无"}`);
    if (options.stats) {
      const reportedTotal = [...networkPages].reverse().find((entry) => entry.reportedTotal != null)?.reportedTotal ?? null;
      const topLevelComplete = scrollStopReason === "page_has_no_more";
      const stats = await writeNumberFiles(reportDir, {
        checkedAt: report.checkedAt,
        videoId,
        reportedTotal,
        topLevelComplete,
        comments: collectedComments.values(),
      }, options);
      console.log(`含号码评论：${stats.relevantCommentCount}/${stats.commentsSeen}；三位数出现：${stats.totalOccurrences} 次；不同号码：${stats.distinctNumberCount} 个`);
      console.log(`统计文件：${path.join(reportDir, "number-stats.txt")}`);
    }
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(`第一阶段验证失败：${error.message}`);
  process.exitCode = 1;
});
