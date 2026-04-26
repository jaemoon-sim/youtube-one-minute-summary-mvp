import assert from "node:assert/strict";
import test from "node:test";
import { createSilentWav } from "../src/tts.ts";

test("creates a playable PCM WAV buffer", () => {
  const wav = createSilentWav(1000, 8000);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(40), 16_000);
  assert.equal(wav.length, 44 + 16_000);
});
