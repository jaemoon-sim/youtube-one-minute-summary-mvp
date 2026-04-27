import { writeFile } from "node:fs/promises";
import { config } from "./config.ts";
import { getServiceAccountAccessToken } from "./googleAuth.ts";
import { estimateNarrationMs } from "./manifest.ts";
import type { SummarySegmentDraft } from "./types.ts";

export type AudioAsset = {
  filename: string;
  durationMs: number;
};

export async function synthesizeSegmentAudio(
  segment: SummarySegmentDraft,
  outputPathWithoutExtension: string,
  index: number
): Promise<AudioAsset> {
  const durationMs = Math.min(10_000, Math.max(4_000, estimateNarrationMs(segment.narrationKo)));

  if (config.googleApplicationCredentials || config.googleTtsAccessToken || config.googleTtsApiKey) {
    const filename = `audio-${String(index + 1).padStart(3, "0")}.mp3`;
    const outputPath = `${outputPathWithoutExtension}.mp3`;
    const audio = await requestGoogleTts(segment.narrationKo);
    await writeFile(outputPath, audio);
    return { filename, durationMs };
  }

  if (!config.allowDemoFallback) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_TTS_ACCESS_TOKEN, GOOGLE_TTS_API_KEY 중 하나가 필요합니다.");
  }

  const filename = `audio-${String(index + 1).padStart(3, "0")}.wav`;
  await writeFile(`${outputPathWithoutExtension}.wav`, createSilentWav(durationMs));
  return { filename, durationMs };
}

async function requestGoogleTts(text: string): Promise<Buffer> {
  const url = new URL("https://texttospeech.googleapis.com/v1/text:synthesize");
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (config.googleApplicationCredentials) {
    const accessToken = await getServiceAccountAccessToken(config.googleApplicationCredentials);
    headers.Authorization = `Bearer ${accessToken}`;
  } else if (config.googleTtsAccessToken) {
    headers.Authorization = `Bearer ${config.googleTtsAccessToken}`;
  } else {
    url.searchParams.set("key", config.googleTtsApiKey);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { text },
      voice: {
        languageCode: config.googleTtsLanguageCode,
        ...(config.googleTtsVoiceName ? { name: config.googleTtsVoiceName } : {})
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: config.googleTtsSpeakingRate
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google TTS 요청 실패 (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = await response.json() as { audioContent?: string };
  if (!data.audioContent) {
    throw new Error("Google TTS 응답에 audioContent가 없습니다.");
  }
  return Buffer.from(data.audioContent, "base64");
}

export function createSilentWav(durationMs: number, sampleRate = 16_000): Buffer {
  const samples = Math.max(1, Math.round(sampleRate * durationMs / 1000));
  const bytesPerSample = 2;
  const dataSize = samples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}
