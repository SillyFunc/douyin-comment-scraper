import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";

test("Chrome profile preserves cookies and local storage after a restart", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Profile check</title>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  const profileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".phase1", "profile-test");
  const marker = randomUUID();
  await mkdir(profileDir, { recursive: true });

  try {
    const first = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: true });
    try {
      const page = first.pages()[0] ?? await first.newPage();
      await page.goto(url);
      await page.evaluate((value) => {
        localStorage.setItem("phase1-profile-test", value);
        document.cookie = `phase1-profile-test=${value}; Max-Age=3600; SameSite=Lax`;
      }, marker);
    } finally {
      await first.close();
    }

    const second = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: true });
    try {
      const page = second.pages()[0] ?? await second.newPage();
      await page.goto(url);
      const stored = await page.evaluate(() => ({
        local: localStorage.getItem("phase1-profile-test"),
        cookie: document.cookie,
      }));
      assert.equal(stored.local, marker);
      assert.match(stored.cookie, new RegExp(`(?:^|; )phase1-profile-test=${marker}(?:;|$)`));
    } finally {
      await second.close();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
