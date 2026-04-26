import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function boolEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberEnv(name: string, defaultValue: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
const jobsDir = path.join(dataDir, "jobs");
mkdirSync(jobsDir, { recursive: true });

export const config = {
  port: Math.trunc(numberEnv("PORT", 3000)),
  dataDir,
  jobsDir,
  dbPath: path.join(dataDir, "app.sqlite"),
  jobTtlMs: numberEnv("JOB_TTL_HOURS", 24) * 60 * 60 * 1000,
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  googleTtsAccessToken: process.env.GOOGLE_TTS_ACCESS_TOKEN || "",
  googleTtsApiKey: process.env.GOOGLE_TTS_API_KEY || "",
  googleTtsLanguageCode: process.env.GOOGLE_TTS_LANGUAGE_CODE || "ko-KR",
  googleTtsVoiceName: process.env.GOOGLE_TTS_VOICE_NAME || "",
  googleTtsSpeakingRate: numberEnv("GOOGLE_TTS_SPEAKING_RATE", 1.08),
  enableRealCapture: boolEnv("ENABLE_REAL_CAPTURE", false),
  allowDemoFallback: boolEnv("ALLOW_DEMO_FALLBACK", true),
  publicDir: path.resolve(process.cwd(), "public")
};
