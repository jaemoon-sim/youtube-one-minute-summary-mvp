import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { config } from "./config.ts";
import { cleanupExpiredJobs, getJob, initDb, listReadyJobs, markInterruptedJobsFailed, publicJob } from "./db.ts";
import { createJob } from "./jobs.ts";

type JsonRecord = Record<string, unknown>;

initDb();
markInterruptedJobsFailed();
cleanupExpiredJobs();
setInterval(() => cleanupExpiredJobs(), Math.min(config.jobTtlMs, 60 * 60 * 1000)).unref();

const server = http.createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Internal server error"
    });
  }
});

server.listen(config.port, () => {
  console.log(`YouTube summary MVP running at http://localhost:${config.port}`);
});

async function route(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const method = request.method || "GET";
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (method === "POST" && pathname === "/api/jobs") {
    const body = await readJsonBody(request);
    const urlValue = typeof body.url === "string" ? body.url : "";
    const job = await createJob(urlValue);
    sendJson(response, 201, { jobId: job.id });
    return;
  }

  if (method === "GET" && pathname === "/api/jobs") {
    const limit = Number(url.searchParams.get("limit") || 20);
    const jobs = listReadyJobs(limit).map(publicJob);
    sendJson(response, 200, { jobs });
    return;
  }

  const statusMatch = pathname.match(/^\/api\/jobs\/([A-Za-z0-9-]+)$/);
  if (method === "GET" && statusMatch) {
    const job = getJob(statusMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "작업을 찾지 못했습니다." });
      return;
    }
    sendJson(response, 200, publicJob(job));
    return;
  }

  const manifestMatch = pathname.match(/^\/api\/jobs\/([A-Za-z0-9-]+)\/manifest$/);
  if (method === "GET" && manifestMatch) {
    const job = getJob(manifestMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "작업을 찾지 못했습니다." });
      return;
    }
    if (job.status !== "ready" || !job.manifestPath) {
      sendJson(response, 409, { error: "아직 manifest가 준비되지 않았습니다.", status: job.status });
      return;
    }
    await sendFile(response, job.manifestPath, "application/json; charset=utf-8");
    return;
  }

  const artifactMatch = pathname.match(/^\/artifacts\/([A-Za-z0-9-]+)\/([^/]+)$/);
  if (method === "GET" && artifactMatch) {
    const filePath = safeArtifactPath(artifactMatch[1], artifactMatch[2]);
    if (!filePath) {
      sendJson(response, 404, { error: "파일을 찾지 못했습니다." });
      return;
    }
    await sendFile(response, filePath);
    return;
  }

  if (method === "GET" || method === "HEAD") {
    const staticPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = safePublicPath(staticPath);
    if (filePath) {
      await sendFile(response, filePath);
      return;
    }
  }

  sendJson(response, 404, { error: "Not found" });
}

async function readJsonBody(request: http.IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new Error("요청 본문이 너무 큽니다.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonRecord;
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function sendFile(response: http.ServerResponse, filePath: string, forcedContentType?: string): Promise<void> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendJson(response, 404, { error: "파일을 찾지 못했습니다." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": forcedContentType || contentType(filePath),
      "Content-Length": fileStat.size,
      "Cache-Control": filePath.includes(`${path.sep}jobs${path.sep}`) ? "private, max-age=3600" : "no-cache"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "파일을 찾지 못했습니다." });
  }
}

function safePublicPath(urlPath: string): string | null {
  const clean = urlPath.replace(/^\/+/, "");
  const resolved = path.resolve(config.publicDir, clean);
  if (!resolved.startsWith(config.publicDir + path.sep)) {
    return null;
  }
  return resolved;
}

function safeArtifactPath(jobId: string, filename: string): string | null {
  const base = path.resolve(config.jobsDir, jobId);
  const resolved = path.resolve(base, filename);
  if (!resolved.startsWith(base + path.sep)) {
    return null;
  }
  return resolved;
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav"
  };
  return types[ext] || "application/octet-stream";
}
