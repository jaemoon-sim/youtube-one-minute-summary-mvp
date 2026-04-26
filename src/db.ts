import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";
import type { JobRecord, JobStatus, PublicJobStatus } from "./types.ts";

let database: DatabaseSync | null = null;

export function initDb(): DatabaseSync {
  if (database) {
    return database;
  }

  mkdirSync(config.dataDir, { recursive: true });
  database = new DatabaseSync(config.dbPath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      source_title TEXT,
      video_id TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL,
      error TEXT,
      manifest_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON jobs(expires_at);
  `);
  return database;
}

export function insertJob(job: JobRecord): void {
  const db = initDb();
  db.prepare(`
    INSERT INTO jobs (
      id, source_url, source_title, video_id, status, progress, error,
      manifest_path, created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    job.sourceUrl,
    job.sourceTitle,
    job.videoId,
    job.status,
    job.progress,
    job.error,
    job.manifestPath,
    job.createdAt,
    job.updatedAt,
    job.expiresAt
  );
}

export function getJob(id: string): JobRecord | null {
  const db = initDb();
  const row = db.prepare(`
    SELECT
      id,
      source_url AS sourceUrl,
      source_title AS sourceTitle,
      video_id AS videoId,
      status,
      progress,
      error,
      manifest_path AS manifestPath,
      created_at AS createdAt,
      updated_at AS updatedAt,
      expires_at AS expiresAt
    FROM jobs
    WHERE id = ?
  `).get(id) as JobRecord | undefined;
  return row || null;
}

export function updateJobStatus(id: string, status: JobStatus, progress: number, error: string | null = null): void {
  const db = initDb();
  db.prepare(`
    UPDATE jobs
    SET status = ?, progress = ?, error = ?, updated_at = ?
    WHERE id = ?
  `).run(status, progress, error, Date.now(), id);
}

export function updateJobTitle(id: string, sourceTitle: string): void {
  const db = initDb();
  db.prepare(`
    UPDATE jobs
    SET source_title = ?, updated_at = ?
    WHERE id = ?
  `).run(sourceTitle, Date.now(), id);
}

export function completeJob(id: string, sourceTitle: string, manifestPath: string): void {
  const db = initDb();
  db.prepare(`
    UPDATE jobs
    SET status = 'ready',
        progress = 100,
        error = NULL,
        source_title = ?,
        manifest_path = ?,
        updated_at = ?
    WHERE id = ?
  `).run(sourceTitle, manifestPath, Date.now(), id);
}

export function markInterruptedJobsFailed(): void {
  const db = initDb();
  db.prepare(`
    UPDATE jobs
    SET status = 'failed',
        error = '서버가 재시작되어 작업이 중단되었습니다. 다시 요청해 주세요.',
        updated_at = ?
    WHERE status IN ('queued', 'analyzing', 'capturing', 'tts')
  `).run(Date.now());
}

export function publicJob(job: JobRecord): PublicJobStatus {
  return {
    id: job.id,
    sourceUrl: job.sourceUrl,
    sourceTitle: job.sourceTitle,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    expiresAt: new Date(job.expiresAt).toISOString()
  };
}

export function cleanupExpiredJobs(now = Date.now()): number {
  const db = initDb();
  const rows = db.prepare("SELECT id FROM jobs WHERE expires_at <= ?").all(now) as Array<{ id: string }>;
  for (const row of rows) {
    const jobDir = path.join(config.jobsDir, row.id);
    if (existsSync(jobDir)) {
      rmSync(jobDir, { recursive: true, force: true });
    }
  }
  db.prepare("DELETE FROM jobs WHERE expires_at <= ?").run(now);
  return rows.length;
}
