import OpenAI from "openai";
import { excerptFrom } from "../ingest/extract";
import { isReadableText, sanitizeText } from "../lib/text";

export type ArticleSummary = {
  title: string | null;
  summary: string;
  highlights: string[];
  angles: string[];
  usedLlm: boolean;
};

type Member = {
  sourceName: string;
  title: string;
  content: string;
};

let llmBlockReason: string | null = null;

function fallbackSummary(title: string, content: string): ArticleSummary {
  const clean = sanitizeText(content);
  const headline = sanitizeText(title);
  if (!isReadableText(clean)) {
    return {
      title: headline || null,
      summary: headline
        ? `「${headline}」の本文を読み取れませんでした。原文を参照してください。`
        : "本文を読み取れませんでした。",
      highlights: [],
      angles: [],
      usedLlm: false,
    };
  }
  return {
    title: null,
    summary: excerptFrom(clean, 240),
    highlights: [],
    angles: [],
    usedLlm: false,
  };
}

export function llmFailureReason(): string | null {
  return llmBlockReason;
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && !llmBlockReason;
}

function client(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

function model(): string {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function clip(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * クラウドへ送るのは title と content のみ。
 * 評価ログ・関心ベクトル・他記事の嗜好は載せない。
 */
export async function summarizeArticle(
  title: string,
  content: string,
): Promise<ArticleSummary> {
  return writeStory([{ sourceName: "単一", title, content }]);
}

export async function writeStory(members: Member[]): Promise<ArticleSummary> {
  const primary = members[0];
  if (!primary) return fallbackSummary("", "");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackSummary(primary.title, primary.content);

  try {
    const multi = members.length > 1;
    const res = await client().chat.completions.create({
      model: model(),
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: multi ? multiSystemPrompt() : singleSystemPrompt(),
        },
        {
          role: "user",
          content: JSON.stringify({
            sources: members.map((m) => ({
              source: m.sourceName,
              title: m.title,
              body: clip(m.content, multi ? 2800 : 8000),
            })),
          }),
        },
      ],
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) return fallbackSummary(primary.title, primary.content);
    return parseStory(raw, primary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/401|incorrect api key|invalid api key/i.test(message)) {
      llmBlockReason =
        "OPENAI_API_KEY が無効なため、日本語要約ができず原文の抜粋を出しています。";
    }
    console.warn("[summarize] LLM 失敗。抜粋にフォールバック:", message);
    return fallbackSummary(primary.title, primary.content);
  }
}

function singleSystemPrompt(): string {
  return [
    "日本語の新聞編集者として、記事本文を読んで要約する。JSONのみ返す。",
    "キー: title, summary, highlights。",
    "title は日本語の見出し。英語見出しは翻訳し、原文の直訳コピーは避ける。",
    "summary は本文を理解したうえでの日本語要約（改行区切り3〜5段落、合計250〜500字）。",
    "冒頭抜粋のコピペ、英文のままの出力は禁止。",
    "highlights は要注目ポイントの配列（2〜4個、短く日本語）。",
    "推測で事実を足さない。本文に無い数字・固有名詞を作らない。",
  ].join("");
}

function multiSystemPrompt(): string {
  return [
    "日本語の新聞編集者として、同一事件を報じた複数社の記事を1本にまとめる。JSONのみ返す。",
    "キー: title, summary, highlights, angles。",
    "手順: (1)各社が一致する事実だけを確定する (2)数字や評価が割れる点は「A社は〜、B社は〜」と書く (3)各社が何を強調したかを angles に1社1行で書く。",
    "title は日本語の統合見出し。",
    "summary は日本語の記事本文（改行区切り4〜7段落、合計400〜800字）。英文禁止。抜粋コピペ禁止。",
    "highlights は確定事実の短い箇条書き（3〜5個）。",
    "angles は「媒体名: 強調点」の配列。",
    "推測で事実を足さない。一社だけが書いた未確認情報は、その社の主張として書く。",
  ].join("");
}

function parseStory(raw: string, primary: Member): ArticleSummary {
  const parsed = JSON.parse(raw) as {
    title?: unknown;
    summary?: unknown;
    highlights?: unknown;
    angles?: unknown;
  };
  const title =
    typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title.trim()
      : null;
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : excerptFrom(primary.content, 240);
  const highlights = stringList(parsed.highlights, 5);
  const angles = stringList(parsed.angles, 6);
  return { title, summary, highlights, angles, usedLlm: true };
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((h): h is string => typeof h === "string")
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, max);
}
