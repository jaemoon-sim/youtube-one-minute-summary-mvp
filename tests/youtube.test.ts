import assert from "node:assert/strict";
import test from "node:test";
import { formatTimestamp, parseYouTubeUrl } from "../src/youtube.ts";

test("parses youtube.com/watch URLs and ignores playlist params", () => {
  const result = parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=abc");
  assert.equal(result.videoId, "dQw4w9WgXcQ");
  assert.equal(result.normalizedUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("parses youtu.be URLs", () => {
  const result = parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=30");
  assert.equal(result.videoId, "dQw4w9WgXcQ");
});

test("parses shorts and embed URLs", () => {
  assert.equal(parseYouTubeUrl("https://youtube.com/shorts/dQw4w9WgXcQ").videoId, "dQw4w9WgXcQ");
  assert.equal(parseYouTubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ").videoId, "dQw4w9WgXcQ");
});

test("rejects non-youtube URLs", () => {
  assert.throws(() => parseYouTubeUrl("https://example.com/watch?v=dQw4w9WgXcQ"), /지원하는 YouTube/);
});

test("formats timestamps", () => {
  assert.equal(formatTimestamp(0), "00:00");
  assert.equal(formatTimestamp(125), "02:05");
});
