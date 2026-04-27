import { config } from "./config.ts";
import { sanitizeSummaryDraft } from "./manifest.ts";
import { formatTimestamp } from "./youtube.ts";
import type { SummaryDraft, SummarySegmentDraft } from "./types.ts";

export async function summarizeYouTubeVideo(sourceUrl: string, videoId: string): Promise<SummaryDraft> {
  if (config.geminiApiKey) {
    return requestGeminiSummary(sourceUrl);
  }

  if (config.allowDemoFallback) {
    return createDemoSummary(videoId);
  }

  throw new Error("GEMINI_API_KEY가 설정되어 있지 않습니다.");
}

async function requestGeminiSummary(sourceUrl: string): Promise<SummaryDraft> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.geminiApiKey
    },
    signal: AbortSignal.timeout(300_000),
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "이 YouTube 영상을 한국어 1분 미만 웹 요약 영상으로 재구성해줘.",
                "반드시 JSON만 반환해.",
                "형식:",
                "{",
                '  "sourceTitle": "영상 제목",',
                '  "segments": [',
                '    {"startSec": 0, "endSec": 30, "headline": "짧은 제목", "subtitleKo": "화면 자막 1문장", "narrationKo": "TTS가 읽을 1-2문장"}',
                "  ]",
                "}",
                "조건:",
                "- segments는 정확히 6개.",
                "- 전체 narrationKo를 자연스럽게 읽으면 45-55초가 되게 짧게.",
                "- 정보 전달 위주로 핵심 주장, 근거, 결론을 보존.",
                "- startSec/endSec는 원본에서 해당 내용을 대표하는 구간.",
                "- subtitleKo는 화면 하단 자막으로 읽기 쉬운 길이."
              ].join("\n")
            },
            {
              file_data: {
                file_uri: sourceUrl
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.25,
        thinkingConfig: {
          thinkingBudget: 0
        },
        responseMimeType: "application/json",
        maxOutputTokens: 8192
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini 요청 실패 (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const text = extractGeminiText(data);
  const parsed = parseJsonFromText(text);
  return sanitizeSummaryDraft(parsed);
}

function extractGeminiText(data: Record<string, unknown>): string {
  const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
  const parts = candidates?.[0]?.content && typeof candidates[0].content === "object"
    ? (candidates[0].content as Record<string, unknown>).parts as Array<Record<string, unknown>> | undefined
    : undefined;
  const text = parts?.map((part) => typeof part.text === "string" ? part.text : "").join("").trim();
  if (!text) {
    throw new Error("Gemini 응답에서 텍스트를 찾지 못했습니다.");
  }
  return text;
}

export function parseJsonFromText(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini 응답에서 JSON 객체를 찾지 못했습니다.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function createDemoSummary(videoId: string): SummaryDraft {
  const starts = [20, 180, 360, 540, 720, 900];
  const headlines = [
    "문제 제기",
    "핵심 배경",
    "첫 번째 근거",
    "두 번째 근거",
    "실행 방법",
    "결론"
  ];
  const subtitles = [
    "영상은 먼저 우리가 놓치기 쉬운 문제를 짧게 제기합니다.",
    "이어지는 배경 설명은 핵심 개념과 맥락을 한 번에 정리합니다.",
    "첫 번째 근거는 왜 이 주장이 설득력 있는지 보여줍니다.",
    "두 번째 근거는 반대 사례와 한계를 함께 짚습니다.",
    "실제로 적용하려면 작은 단계부터 검증하는 방식이 좋습니다.",
    "결론은 핵심 메시지를 다시 모아 다음 행동으로 연결합니다."
  ];

  const segments: SummarySegmentDraft[] = starts.map((startSec, index) => ({
    startSec,
    endSec: startSec + 55,
    headline: headlines[index],
    subtitleKo: subtitles[index],
    narrationKo: `${formatTimestamp(startSec)} 부근의 핵심은 ${subtitles[index]}`
  }));

  return {
    sourceTitle: `Demo YouTube Summary (${videoId})`,
    segments,
    provider: "demo"
  };
}
