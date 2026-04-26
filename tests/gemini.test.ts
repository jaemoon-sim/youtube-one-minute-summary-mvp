import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonFromText } from "../src/gemini.ts";

test("extracts JSON from fenced Gemini text", () => {
  const parsed = parseJsonFromText('```json\n{"sourceTitle":"x","segments":[]}\n```') as { sourceTitle: string };
  assert.equal(parsed.sourceTitle, "x");
});

test("extracts JSON from surrounding prose", () => {
  const parsed = parseJsonFromText('결과입니다.\n{"ok":true}\n끝') as { ok: boolean };
  assert.equal(parsed.ok, true);
});
