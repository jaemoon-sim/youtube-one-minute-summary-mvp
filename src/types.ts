export type JobStatus = "queued" | "analyzing" | "capturing" | "tts" | "ready" | "failed";

export type YouTubeInfo = {
  videoId: string;
  normalizedUrl: string;
  originalUrl: string;
};

export type SummarySegmentDraft = {
  startSec: number;
  endSec: number;
  headline: string;
  subtitleKo: string;
  narrationKo: string;
};

export type SummaryDraft = {
  sourceTitle: string;
  segments: SummarySegmentDraft[];
  provider: "gemini" | "demo";
};

export type SummarySegment = SummarySegmentDraft & {
  frameUrl: string;
  audioUrl: string;
  durationMs: number;
};

export type SummaryManifest = {
  sourceUrl: string;
  sourceTitle: string;
  videoId: string;
  createdAt: string;
  expiresAt: string;
  segments: SummarySegment[];
};

export type JobRecord = {
  id: string;
  sourceUrl: string;
  sourceTitle: string | null;
  videoId: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  manifestPath: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type PublicJobStatus = {
  id: string;
  sourceUrl: string;
  sourceTitle: string | null;
  status: JobStatus;
  progress: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};
