import assert from "node:assert/strict";
import test from "node:test";
import { extractDouyinUrl, videoIdFromUrl } from "./share-link.mjs";

test("extracts the URL from a complete Douyin share message", () => {
  const share = "5.61 P@K.JI WMw:/ :2pm 06/21 今天怎么看强者们# 福彩3D  https://v.douyin.com/Example123/ 复制此链接，打开Dou音搜索，直接观看视频！";
  assert.equal(extractDouyinUrl(share), "https://v.douyin.com/Example123/");
});

test("accepts a direct video link and trims trailing punctuation", () => {
  assert.equal(
    extractDouyinUrl("视频：https://www.douyin.com/video/7693918682930819557，快来看"),
    "https://www.douyin.com/video/7693918682930819557",
  );
  assert.equal(videoIdFromUrl("https://www.douyin.com/video/7693918682930819557?source=share"), "7693918682930819557");
});

test("rejects unrelated and lookalike hosts", () => {
  assert.throws(() => extractDouyinUrl("https://v.douyin.com.evil.example/a"));
  assert.throws(() => extractDouyinUrl("http://v.douyin.com/a"));
  assert.throws(() => extractDouyinUrl("没有网址"));
});
