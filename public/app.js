const form = document.querySelector("#job-form");
const urlInput = document.querySelector("#youtube-url");
const submitButton = document.querySelector("#submit-button");
const statusPanel = document.querySelector("#status-panel");
const statusLabel = document.querySelector("#status-label");
const statusDetail = document.querySelector("#status-detail");
const progressFill = document.querySelector("#progress-fill");
const errorPanel = document.querySelector("#error-panel");
const playerPanel = document.querySelector("#player-panel");
const frameImage = document.querySelector("#frame-image");
const headline = document.querySelector("#segment-headline");
const subtitle = document.querySelector("#segment-subtitle");
const playButton = document.querySelector("#play-button");
const prevButton = document.querySelector("#prev-button");
const nextButton = document.querySelector("#next-button");
const segmentTime = document.querySelector("#segment-time");
const totalTime = document.querySelector("#total-time");
const summaryProgressFill = document.querySelector("#summary-progress-fill");
const sourceTitle = document.querySelector("#source-title");
const sourceLink = document.querySelector("#source-link");
const segmentList = document.querySelector("#segment-list");
const audio = document.querySelector("#segment-audio");
const feedList = document.querySelector("#feed-list");
const feedEmpty = document.querySelector("#feed-empty");
const refreshFeedButton = document.querySelector("#refresh-feed-button");

let manifest = null;
let currentIndex = 0;
let isPlaying = false;
let rafId = 0;
let pollTimer = 0;
let activeJobId = "";

const statusText = {
  queued: ["대기 중", "작업 큐에 들어갔습니다."],
  analyzing: ["분석 중", "Gemini가 영상의 핵심 구간을 고르고 있습니다."],
  capturing: ["캡처 중", "대표 시점의 화면을 준비하고 있습니다."],
  tts: ["음성 생성 중", "한국어 내레이션 오디오를 만들고 있습니다."],
  ready: ["완료", "요약 플레이어가 준비되었습니다."],
  failed: ["실패", "작업을 완료하지 못했습니다."]
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  resetPlayer();
  submitButton.disabled = true;
  showStatus("queued", 1);

  try {
    const result = await apiJson("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ url: urlInput.value })
    });
    pollJob(result.jobId);
  } catch (error) {
    showError(error.message);
    submitButton.disabled = false;
  }
});

playButton.addEventListener("click", async () => {
  if (!manifest) {
    return;
  }
  if (isPlaying) {
    pause();
  } else {
    await play();
  }
});

prevButton.addEventListener("click", () => {
  if (!manifest) {
    return;
  }
  setSegment(Math.max(0, currentIndex - 1), isPlaying);
});

nextButton.addEventListener("click", () => {
  if (!manifest) {
    return;
  }
  setSegment(Math.min(manifest.segments.length - 1, currentIndex + 1), isPlaying);
});

audio.addEventListener("ended", () => {
  if (!manifest) {
    return;
  }
  if (currentIndex < manifest.segments.length - 1) {
    setSegment(currentIndex + 1, true);
  } else {
    pause();
    updateProgress();
  }
});

audio.addEventListener("timeupdate", updateProgress);
audio.addEventListener("loadedmetadata", updateProgress);

refreshFeedButton.addEventListener("click", () => {
  loadFeed();
});

loadFeed();

function pollJob(jobId) {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    try {
      const job = await apiJson(`/api/jobs/${jobId}`);
      renderJob(job);
      if (job.status === "ready") {
        window.clearInterval(pollTimer);
        submitButton.disabled = false;
        await loadManifest(jobId);
        await loadFeed();
      }
      if (job.status === "failed") {
        window.clearInterval(pollTimer);
        submitButton.disabled = false;
        showError(job.error || "작업에 실패했습니다.");
      }
    } catch (error) {
      window.clearInterval(pollTimer);
      submitButton.disabled = false;
      showError(error.message);
    }
  }, 1100);
}

function renderJob(job) {
  showStatus(job.status, job.progress);
  if (job.sourceTitle) {
    statusDetail.textContent = job.sourceTitle;
  }
}

async function loadManifest(jobId) {
  manifest = await apiJson(`/api/jobs/${jobId}/manifest`);
  activeJobId = jobId;
  currentIndex = 0;
  renderPlayer();
  markActiveFeedItem();
  playerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPlayer() {
  playerPanel.hidden = false;
  sourceTitle.textContent = manifest.sourceTitle;
  sourceLink.href = manifest.sourceUrl;
  segmentList.replaceChildren();
  manifest.segments.forEach((segment, index) => {
    const item = document.createElement("li");
    const time = document.createElement("time");
    const title = document.createElement("span");
    time.textContent = formatTime(segment.startSec);
    title.textContent = segment.headline;
    item.append(time, title);
    item.addEventListener("click", () => setSegment(index, isPlaying));
    segmentList.append(item);
  });
  totalTime.textContent = formatTime(totalDurationMs() / 1000);
  setSegment(0, false);
}

async function loadFeed() {
  try {
    const result = await apiJson("/api/jobs?limit=24");
    const jobs = Array.isArray(result.jobs) ? result.jobs : [];
    const items = await Promise.all(jobs.map(async (job) => {
      try {
        const itemManifest = await apiJson(`/api/jobs/${job.id}/manifest`);
        return { job, manifest: itemManifest };
      } catch {
        return { job, manifest: null };
      }
    }));
    renderFeed(items.filter((item) => item.manifest));
  } catch {
    feedList.replaceChildren();
    feedEmpty.hidden = false;
    feedEmpty.textContent = "요약 피드를 불러오지 못했습니다.";
  }
}

function renderFeed(items) {
  feedList.replaceChildren();
  feedEmpty.hidden = items.length > 0;
  feedEmpty.textContent = "아직 생성된 요약이 없습니다.";

  for (const item of items) {
    const firstSegment = item.manifest.segments[0];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "feed-card";
    button.dataset.jobId = item.job.id;

    const thumb = document.createElement("img");
    thumb.src = firstSegment?.frameUrl || "";
    thumb.alt = "";
    thumb.loading = "lazy";

    const body = document.createElement("span");
    body.className = "feed-card-body";

    const title = document.createElement("strong");
    title.textContent = item.manifest.sourceTitle || item.job.sourceTitle || "제목 없는 요약";

    const meta = document.createElement("span");
    meta.className = "feed-card-meta";
    meta.textContent = `${item.manifest.segments.length}개 구간 · ${formatRelativeDate(item.job.updatedAt)}`;

    const caption = document.createElement("span");
    caption.className = "feed-card-caption";
    caption.textContent = firstSegment?.headline || "요약 보기";

    body.append(title, meta, caption);
    button.append(thumb, body);
    button.addEventListener("click", () => loadManifest(item.job.id));
    feedList.append(button);
  }

  markActiveFeedItem();
}

async function setSegment(index, autoPlay) {
  currentIndex = index;
  const segment = manifest.segments[currentIndex];
  frameImage.src = segment.frameUrl;
  headline.textContent = segment.headline;
  subtitle.textContent = segment.subtitleKo;
  segmentTime.textContent = formatTime(segment.startSec);
  audio.src = segment.audioUrl;
  audio.load();
  markActiveSegment();
  updateProgress();

  if (autoPlay) {
    await play();
  }
}

async function play() {
  try {
    await audio.play();
    isPlaying = true;
    playButton.textContent = "일시정지";
    tick();
  } catch (error) {
    showError("브라우저가 오디오 재생을 막았습니다. 다시 재생을 눌러 주세요.");
  }
}

function pause() {
  audio.pause();
  isPlaying = false;
  playButton.textContent = "재생";
  window.cancelAnimationFrame(rafId);
}

function tick() {
  updateProgress();
  if (isPlaying) {
    rafId = window.requestAnimationFrame(tick);
  }
}

function updateProgress() {
  if (!manifest) {
    summaryProgressFill.style.width = "0%";
    return;
  }
  const previous = manifest.segments
    .slice(0, currentIndex)
    .reduce((sum, segment) => sum + segment.durationMs, 0);
  const current = Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;
  const total = totalDurationMs();
  const percent = total > 0 ? Math.min(100, ((previous + current) / total) * 100) : 0;
  summaryProgressFill.style.width = `${percent}%`;
}

function markActiveSegment() {
  [...segmentList.children].forEach((item, index) => {
    item.classList.toggle("active", index === currentIndex);
  });
}

function markActiveFeedItem() {
  [...feedList.children].forEach((item) => {
    item.classList.toggle("active", item.dataset.jobId === activeJobId);
  });
}

function showStatus(status, progress) {
  const copy = statusText[status] || statusText.queued;
  statusPanel.hidden = false;
  statusLabel.textContent = copy[0];
  statusDetail.textContent = copy[1];
  progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function showError(message) {
  errorPanel.hidden = false;
  errorPanel.textContent = message;
}

function clearError() {
  errorPanel.hidden = true;
  errorPanel.textContent = "";
}

function resetPlayer() {
  pause();
  manifest = null;
  currentIndex = 0;
  playerPanel.hidden = true;
  activeJobId = "";
  markActiveFeedItem();
  summaryProgressFill.style.width = "0%";
  audio.removeAttribute("src");
  audio.load();
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function totalDurationMs() {
  return manifest.segments.reduce((sum, segment) => sum + segment.durationMs, 0);
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatRelativeDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "방금 전";
  }
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) {
    return "방금 전";
  }
  if (minutes < 60) {
    return `${minutes}분 전`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간 전`;
  }
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}
