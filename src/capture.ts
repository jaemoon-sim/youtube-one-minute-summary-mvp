import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "./config.ts";
import { formatTimestamp } from "./youtube.ts";
import type { SummarySegmentDraft } from "./types.ts";

export type FrameAsset = {
  filename: string;
};

type PlaywrightModule = {
  chromium: {
    launch(options: { headless: boolean }): Promise<{
      newPage(options: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<{
        goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
        locator(selector: string): {
          click(options?: { position?: { x: number; y: number }; timeout?: number }): Promise<void>;
          screenshot(options: { path: string; type: "png"; timeout?: number }): Promise<Buffer>;
        };
        waitForFunction<R>(fn: (...args: unknown[]) => R, arg: unknown, options?: { timeout?: number }): Promise<unknown>;
        waitForTimeout(ms: number): Promise<void>;
        screenshot(options: { path: string; type: "png" }): Promise<Buffer>;
        evaluate<R>(fn: (...args: unknown[]) => R, arg?: unknown): Promise<R>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
};

export async function captureSegmentFrames(
  jobDir: string,
  videoId: string,
  segments: SummarySegmentDraft[]
): Promise<FrameAsset[]> {
  if (config.enableRealCapture) {
    try {
      return await captureWithPlaywright(jobDir, videoId, segments);
    } catch (error) {
      if (!config.allowDemoFallback) {
        throw error;
      }
      console.warn("Real capture failed, using generated SVG frames:", error);
    }
  }

  return generateSvgFrames(jobDir, videoId, segments);
}

async function captureWithPlaywright(
  jobDir: string,
  videoId: string,
  segments: SummarySegmentDraft[]
): Promise<FrameAsset[]> {
  const playwright = await loadPlaywright();
  if (!playwright) {
    throw new Error("Playwright를 찾지 못했습니다.");
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const assets: FrameAsset[] = [];
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const filename = `frame-${String(index + 1).padStart(3, "0")}.png`;
      const outputPath = path.join(jobDir, filename);
      const page = await browser.newPage({
        viewport: { width: 1365, height: 900 },
        deviceScaleFactor: 1
      });
      const start = Math.max(0, Math.floor(segment.startSec));
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}&t=${start}s`;
      await page.goto(watchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(3_000);
      await page.locator("#movie_player").click({ position: { x: 460, y: 260 }, timeout: 10_000 });
      await page.waitForFunction(() => {
        const video = document.querySelector("video");
        return Boolean(video && video.readyState >= 1 && video.videoWidth > 0);
      }, null, { timeout: 20_000 });
      await page.evaluate(async (targetSecond) => {
        const video = document.querySelector("video");
        if (!video) return;
        video.muted = true;
        try {
          await video.play();
        } catch {
          // The prior user-like click normally permits playback; keep waiting for metadata if play is blocked.
        }
        const target = Math.min(Math.max(0, Number(targetSecond)), Number.isFinite(video.duration) ? Math.max(0, video.duration - 1) : Math.max(0, Number(targetSecond)));
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            video.removeEventListener("seeked", finish);
            resolve();
          };
          video.addEventListener("seeked", finish, { once: true });
          video.currentTime = target;
          window.setTimeout(finish, 4_000);
        });
      }, start);
      await page.waitForTimeout(900);
      await page.evaluate(() => {
        const video = document.querySelector("video");
        video?.pause();
        const style = document.createElement("style");
        style.textContent = [
          ".ytp-chrome-bottom",
          ".ytp-chrome-top",
          ".ytp-gradient-bottom",
          ".ytp-gradient-top",
          ".ytp-spinner",
          ".ytp-bezel",
          ".ytp-pause-overlay",
          ".ytp-tooltip",
          ".ytp-large-play-button"
        ].map((selector) => `${selector}{display:none!important;opacity:0!important;visibility:hidden!important;}`).join("\n");
        document.head.append(style);
      });
      await page.locator("video").screenshot({ path: outputPath, type: "png", timeout: 15_000 });
      await page.close();
      assets.push({ filename });
    }
  } finally {
    await browser.close();
  }
  return assets;
}

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright") as PlaywrightModule;
  } catch {
    const bundledModules = path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
    try {
      const bundledRequire = createRequire(path.join(bundledModules, "noop.js"));
      return bundledRequire("playwright") as PlaywrightModule;
    } catch {
      return null;
    }
  }
}

async function generateSvgFrames(
  jobDir: string,
  videoId: string,
  segments: SummarySegmentDraft[]
): Promise<FrameAsset[]> {
  const assets: FrameAsset[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const filename = `frame-${String(index + 1).padStart(3, "0")}.svg`;
    await writeFile(path.join(jobDir, filename), renderFrameSvg(videoId, segment, index), "utf8");
    assets.push({ filename });
  }
  return assets;
}

function renderFrameSvg(videoId: string, segment: SummarySegmentDraft, index: number): string {
  const hue = [164, 204, 44, 12, 278, 330][index % 6];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="hsl(${hue}, 32%, 16%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 70) % 360}, 26%, 9%)"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect x="74" y="72" width="1132" height="576" rx="22" fill="rgba(0,0,0,0.23)" stroke="rgba(255,255,255,0.18)"/>
  <text x="104" y="124" fill="rgba(255,255,255,0.72)" font-family="Arial, Helvetica, sans-serif" font-size="24">YouTube ${escapeXml(videoId)} / ${formatTimestamp(segment.startSec)}</text>
  <text x="104" y="304" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700">${escapeXml(segment.headline)}</text>
  <text x="104" y="374" fill="rgba(255,255,255,0.82)" font-family="Arial, Helvetica, sans-serif" font-size="34">${escapeXml(segment.subtitleKo)}</text>
  <rect x="104" y="528" width="1072" height="58" rx="12" fill="rgba(255,255,255,0.13)"/>
  <text x="132" y="566" fill="rgba(255,255,255,0.72)" font-family="Arial, Helvetica, sans-serif" font-size="22">ENABLE_REAL_CAPTURE=true이면 이 위치에 실제 YouTube 스틸 캡처가 들어갑니다.</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
