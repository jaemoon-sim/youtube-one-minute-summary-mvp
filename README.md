# YouTube 1분 요약 웹 MVP

YouTube URL을 입력하면 20-30분 길이의 정보 전달형 영상을 60초 이내의 웹 미리보기 요약으로 재구성하는 개인용 MVP입니다. 긴 영상을 텍스트 요약으로만 소비하는 대신, 핵심 구간의 화면 스틸, 한국어 자막, TTS 내레이션을 조합해 짧은 영상처럼 훑어볼 수 있게 만드는 것이 목표입니다.

## 핵심 아이디어

- Gemini가 YouTube URL을 직접 분석해 핵심 구간 6-10개와 한국어 요약 대본을 생성합니다.
- 각 구간의 대표 시점 화면을 캡처하거나, 개발 환경에서는 SVG placeholder frame을 생성합니다.
- Google Cloud Text-to-Speech로 segment별 한국어 내레이션을 만들고, API 키가 없을 때는 무음 WAV fallback으로 전체 흐름을 검증합니다.
- 브라우저 플레이어는 프레임, 하단 자막, 오디오를 순서대로 재생해 1분 내외의 요약 경험을 제공합니다.
- 생성물은 로컬 `data/jobs/{jobId}`에 저장되고 기본 24시간 후 삭제됩니다.

## 현재 구현

이 저장소는 Next.js로 옮기기 쉬운 API 계약을 유지하면서도, 별도 패키지 설치 없이 실행 가능하도록 Node 24 기반 단일 서버로 구현되어 있습니다. 현재 작업 환경에 `npm`이 없어 `node --experimental-strip-types`와 Node 내장 SQLite를 사용했습니다.

- `POST /api/jobs` with `{ "url": "https://www.youtube.com/watch?v=..." }`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/manifest`
- 정적 웹 UI: `public/index.html`, `public/app.js`, `public/styles.css`
- 작업 큐와 manifest 생성: `src/jobs.ts`
- Gemini 분석 어댑터: `src/gemini.ts`
- 프레임 캡처/fallback: `src/capture.ts`
- TTS/fallback: `src/tts.ts`

## 실행

```bash
cp .env.example .env
node --experimental-strip-types src/server.ts
```

브라우저에서 `http://localhost:3000`을 엽니다.

API 키 없이도 `.env.example`의 기본값처럼 `ALLOW_DEMO_FALLBACK=true`이면 데모 manifest, SVG 프레임, 무음 WAV로 end-to-end 동작을 확인할 수 있습니다.

실제 Gemini/TTS/YouTube frame capture를 사용하려면 `.env`에 아래 값을 설정합니다.

```bash
GEMINI_API_KEY=...
GOOGLE_TTS_ACCESS_TOKEN=...
# 또는 GOOGLE_TTS_API_KEY=...
ENABLE_REAL_CAPTURE=true
```

`ENABLE_REAL_CAPTURE=true`는 Playwright가 설치되어 있거나 Codex bundled runtime의 Playwright를 찾을 수 있을 때 YouTube embed player를 스크린샷합니다. 원본 영상을 다운로드하지 않습니다.

## Manifest 예시

```json
{
  "sourceUrl": "https://www.youtube.com/watch?v=...",
  "sourceTitle": "영상 제목",
  "videoId": "xxxxxxxxxxx",
  "createdAt": "2026-04-26T12:00:00.000Z",
  "expiresAt": "2026-04-27T12:00:00.000Z",
  "segments": [
    {
      "startSec": 12,
      "endSec": 70,
      "headline": "핵심 제목",
      "subtitleKo": "화면 하단에 표시할 자막",
      "narrationKo": "TTS가 읽을 한국어 요약 대본",
      "frameUrl": "/artifacts/job-id/frame-001.svg",
      "audioUrl": "/artifacts/job-id/audio-001.wav",
      "durationMs": 8000
    }
  ]
}
```

## 테스트

```bash
node --experimental-strip-types --test tests/*.test.ts
```

현재 테스트는 YouTube URL 파서, Gemini JSON 추출, manifest 검증, TTS WAV fallback을 검증합니다.

## 주의

이 MVP는 개인 실험용입니다. 공개 YouTube 영상의 화면을 캡처해 재가공하는 기능은 공개 서비스로 배포하기 전에 권리 확인, YouTube 정책 검토, 소유/허가 영상 제한 또는 추상 화면 요약 모드로 전환이 필요합니다.
