import assert from "node:assert/strict";
import test from "node:test";
import { estimateNarrationMs, sanitizeSummaryDraft, validateManifest } from "../src/manifest.ts";
import type { SummaryManifest } from "../src/types.ts";

test("sanitizes a valid Gemini-style summary draft", () => {
  const draft = sanitizeSummaryDraft({
    sourceTitle: "테스트 영상",
    segments: Array.from({ length: 6 }, (_, index) => ({
      startSec: index * 60,
      endSec: index * 60 + 30,
      headline: `핵심 ${index + 1}`,
      subtitleKo: "짧은 자막입니다.",
      narrationKo: "짧은 한국어 내레이션입니다."
    }))
  });

  assert.equal(draft.sourceTitle, "테스트 영상");
  assert.equal(draft.segments.length, 6);
  assert.equal(draft.provider, "gemini");
});

test("rejects summaries outside the 6-10 segment range", () => {
  assert.throws(
    () => sanitizeSummaryDraft({ sourceTitle: "x", segments: [] }),
    /요약 구간/
  );
});

test("validates manifest shape and one-minute limit", () => {
  const manifest: SummaryManifest = {
    sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    sourceTitle: "테스트",
    videoId: "dQw4w9WgXcQ",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000).toISOString(),
    segments: Array.from({ length: 6 }, (_, index) => ({
      startSec: index * 60,
      endSec: index * 60 + 30,
      headline: `핵심 ${index + 1}`,
      subtitleKo: "자막",
      narrationKo: "내레이션",
      frameUrl: `/artifacts/job/frame-${index}.svg`,
      audioUrl: `/artifacts/job/audio-${index}.wav`,
      durationMs: 9000
    }))
  };

  assert.deepEqual(validateManifest(manifest), []);
  manifest.segments[0].durationMs = 20_000;
  assert.match(validateManifest(manifest).join("\n"), /<= 60 seconds/);
});

test("estimates Korean narration duration", () => {
  assert.equal(estimateNarrationMs(""), 4000);
  assert.ok(estimateNarrationMs("한국어 문장이 충분히 길어지면 재생 시간도 함께 늘어납니다. 핵심 내용을 여러 문장으로 설명할 때는 기본 최소값보다 긴 시간이 필요합니다.") > 4000);
});
