import type { YouTubeInfo } from "./types.ts";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeUrl(input: string): YouTubeInfo {
  const originalUrl = input.trim();
  if (!originalUrl) {
    throw new Error("YouTube URL을 입력해 주세요.");
  }

  let url: URL;
  try {
    url = new URL(originalUrl);
  } catch {
    throw new Error("올바른 URL 형식이 아닙니다.");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") || "";
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) {
        videoId = parts[1] || "";
      }
    }
  }

  if (!YOUTUBE_ID.test(videoId)) {
    throw new Error("지원하는 YouTube 영상 URL이 아닙니다.");
  }

  return {
    videoId,
    originalUrl,
    normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`
  };
}

export function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function clampSecond(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return fallback;
  }
  return Math.round(numberValue);
}
