import type { SummaryDraft, SummaryManifest, SummarySegmentDraft } from "./types.ts";

const MIN_SEGMENTS = 6;
const MAX_SEGMENTS = 10;
const MAX_TOTAL_MS = 60_000;
const TARGET_TOTAL_MS = 55_000;

export function estimateNarrationMs(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  const hangul = [...normalized].filter((char) => /[가-힣]/.test(char)).length;
  const other = Math.max(0, normalized.length - hangul);
  const seconds = Math.max(4, hangul / 7.5 + other / 12);
  return Math.round(seconds * 1000);
}

export function sanitizeSummaryDraft(input: unknown): SummaryDraft {
  if (!input || typeof input !== "object") {
    throw new Error("Gemini 응답이 JSON 객체가 아닙니다.");
  }
  const record = input as Record<string, unknown>;
  const sourceTitle = stringValue(record.sourceTitle, "YouTube 영상");
  const rawSegments = Array.isArray(record.segments) ? record.segments : [];
  if (rawSegments.length < MIN_SEGMENTS || rawSegments.length > MAX_SEGMENTS) {
    throw new Error(`요약 구간은 ${MIN_SEGMENTS}-${MAX_SEGMENTS}개여야 합니다.`);
  }

  const segments = rawSegments.map((segment, index) => sanitizeSegment(segment, index));
  const sorted = segments.sort((a, b) => a.startSec - b.startSec);
  return {
    sourceTitle,
    segments: fitNarrationsToTarget(sorted),
    provider: "gemini"
  };
}

export function validateManifest(manifest: SummaryManifest): string[] {
  const errors: string[] = [];
  if (!manifest.sourceUrl) {
    errors.push("sourceUrl is required");
  }
  if (!manifest.sourceTitle) {
    errors.push("sourceTitle is required");
  }
  if (manifest.segments.length < MIN_SEGMENTS || manifest.segments.length > MAX_SEGMENTS) {
    errors.push(`segments must contain ${MIN_SEGMENTS}-${MAX_SEGMENTS} items`);
  }

  const totalMs = manifest.segments.reduce((sum, segment) => sum + segment.durationMs, 0);
  if (totalMs > MAX_TOTAL_MS) {
    errors.push("total segment duration must be <= 60 seconds");
  }

  manifest.segments.forEach((segment, index) => {
    const label = `segments[${index}]`;
    if (segment.startSec < 0 || segment.endSec <= segment.startSec) {
      errors.push(`${label} has invalid timestamps`);
    }
    if (!segment.headline || !segment.subtitleKo || !segment.narrationKo) {
      errors.push(`${label} requires headline, subtitleKo, and narrationKo`);
    }
    if (!segment.frameUrl || !segment.audioUrl || segment.durationMs <= 0) {
      errors.push(`${label} requires frameUrl, audioUrl, and durationMs`);
    }
  });

  return errors;
}

function sanitizeSegment(input: unknown, index: number): SummarySegmentDraft {
  if (!input || typeof input !== "object") {
    throw new Error(`segments[${index}]가 객체가 아닙니다.`);
  }
  const record = input as Record<string, unknown>;
  const startSec = numberValue(record.startSec, index * 120);
  const endSec = Math.max(startSec + 1, numberValue(record.endSec, startSec + 60));
  const headline = stringValue(record.headline, `핵심 ${index + 1}`);
  const subtitleKo = stringValue(record.subtitleKo, headline);
  const narrationKo = stringValue(record.narrationKo, subtitleKo);

  return {
    startSec,
    endSec,
    headline,
    subtitleKo,
    narrationKo
  };
}

function fitNarrationsToTarget(segments: SummarySegmentDraft[]): SummarySegmentDraft[] {
  const total = segments.reduce((sum, segment) => sum + estimateNarrationMs(segment.narrationKo), 0);
  if (total <= TARGET_TOTAL_MS) {
    return segments;
  }

  const ratio = TARGET_TOTAL_MS / total;
  return segments.map((segment) => {
    const maxLength = Math.max(34, Math.floor(segment.narrationKo.length * ratio));
    return {
      ...segment,
      narrationKo: trimText(segment.narrationKo, maxLength),
      subtitleKo: trimText(segment.subtitleKo, Math.max(28, Math.floor(segment.subtitleKo.length * ratio)))
    };
  });
}

function trimText(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  const slice = clean.slice(0, maxLength - 3);
  const lastSentence = Math.max(slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"), slice.lastIndexOf("다."));
  const safe = lastSentence > maxLength * 0.45 ? slice.slice(0, lastSentence + 1) : slice;
  return `${safe.trim()}...`;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}
