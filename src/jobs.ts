import { mkdir, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { captureSegmentFrames } from "./capture.ts";
import { config } from "./config.ts";
import { completeJob, getJob, insertJob, updateJobStatus, updateJobTitle } from "./db.ts";
import { summarizeYouTubeVideo } from "./gemini.ts";
import { validateManifest } from "./manifest.ts";
import { synthesizeSegmentAudio } from "./tts.ts";
import { parseYouTubeUrl } from "./youtube.ts";
import type { JobRecord, SummaryManifest } from "./types.ts";

let queue = Promise.resolve();
const queuedIds = new Set<string>();

export async function createJob(rawUrl: string): Promise<JobRecord> {
  const youtube = parseYouTubeUrl(rawUrl);
  const now = Date.now();
  const job: JobRecord = {
    id: crypto.randomUUID(),
    sourceUrl: youtube.normalizedUrl,
    sourceTitle: null,
    videoId: youtube.videoId,
    status: "queued",
    progress: 0,
    error: null,
    manifestPath: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + config.jobTtlMs
  };

  await mkdir(path.join(config.jobsDir, job.id), { recursive: true });
  insertJob(job);
  enqueueJob(job.id);
  return job;
}

export function enqueueJob(jobId: string): void {
  if (queuedIds.has(jobId)) {
    return;
  }
  queuedIds.add(jobId);
  queue = queue
    .then(() => processJob(jobId))
    .catch((error) => {
      console.error(`Job ${jobId} failed outside worker guard:`, error);
    })
    .finally(() => {
      queuedIds.delete(jobId);
    });
}

async function processJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) {
    return;
  }

  const jobDir = path.join(config.jobsDir, job.id);

  try {
    updateJobStatus(job.id, "analyzing", 12);
    const draft = await summarizeYouTubeVideo(job.sourceUrl, job.videoId);
    updateJobTitle(job.id, draft.sourceTitle);

    updateJobStatus(job.id, "capturing", 46);
    const frames = await captureSegmentFrames(jobDir, job.videoId, draft.segments);

    updateJobStatus(job.id, "tts", 72);
    const audioAssets = [];
    for (let index = 0; index < draft.segments.length; index += 1) {
      const basePath = path.join(jobDir, `audio-${String(index + 1).padStart(3, "0")}`);
      const asset = await synthesizeSegmentAudio(draft.segments[index], basePath, index);
      audioAssets.push(asset);
      const ttsProgress = 72 + Math.round(((index + 1) / draft.segments.length) * 18);
      updateJobStatus(job.id, "tts", Math.min(ttsProgress, 90));
    }

    const manifest: SummaryManifest = {
      sourceUrl: job.sourceUrl,
      sourceTitle: draft.sourceTitle,
      videoId: job.videoId,
      createdAt: new Date(job.createdAt).toISOString(),
      expiresAt: new Date(job.expiresAt).toISOString(),
      segments: draft.segments.map((segment, index) => ({
        ...segment,
        frameUrl: artifactUrl(job.id, frames[index].filename),
        audioUrl: artifactUrl(job.id, audioAssets[index].filename),
        durationMs: audioAssets[index].durationMs
      }))
    };

    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      throw new Error(`manifest 검증 실패: ${errors.join(", ")}`);
    }

    const manifestPath = path.join(jobDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    completeJob(job.id, draft.sourceTitle, manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateJobStatus(job.id, "failed", 100, message);
  }
}

function artifactUrl(jobId: string, filename: string): string {
  return `/artifacts/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`;
}
