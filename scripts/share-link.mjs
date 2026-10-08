const ALLOWED_HOSTS = new Set(["v.douyin.com", "www.douyin.com", "douyin.com"]);
const URL_PATTERN = /https?:\/\/[^\s<>"'，。！？；（）【】]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:，。！？；：、）】]+$/u;

export function extractDouyinUrl(shareText) {
  if (typeof shareText !== "string") {
    throw new TypeError("分享内容必须是文本");
  }

  for (const match of shareText.match(URL_PATTERN) ?? []) {
    const candidate = match.replace(TRAILING_PUNCTUATION, "");
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
        return url.href;
      }
    } catch {
      // Continue looking for another URL in the share text.
    }
  }

  throw new Error("未找到有效的抖音 HTTPS 分享链接");
}

export function videoIdFromUrl(value) {
  const url = new URL(value);
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
  return /^\/video\/(\d+)(?:\/|$)/u.exec(url.pathname)?.[1] ?? null;
}
