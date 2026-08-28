import OpenAI from "openai";
import { excerptFrom } from "../ingest/extract";

export type ArticleSummary = {
  summary: string;
  highlights: string[];
  usedLlm: boolean;
};

function fallbackSummary(content: string): ArticleSummary {
  const excerpt = excerptFrom(content, 240);
  return {
    summary: excerpt,
    highlights: [],
    usedLlm: false,
  };
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * クラウドへ送るのは title と content のみ。
 * 評価ログ・関心ベクトル・他記事の嗜好は載せない。
 */
export async function summarizeArticle(
  title: string,
  content: string,
): Promise<ArticleSummary> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackSummary(content);

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "日本語の新聞編集者として記事を要約する。JSONのみ返す。キーは summary と highlights。summary は改行区切りの3行。highlights は要注目ポイントの配列（2〜4個、短く）。推測で事実を足さない。",
        },
        {
          role: "user",
          content: JSON.stringify({
            title,
            content: content.replace(/\s+/g, " ").trim().slice(0, 4000),
          }),
        },
      ],
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) return fallbackSummary(content);
    const parsed = JSON.parse(raw) as {
      summary?: unknown;
      highlights?: unknown;
    };
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : excerptFrom(content, 240);
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights
          .filter((h): h is string => typeof h === "string")
          .map((h) => h.trim())
          .filter(Boolean)
          .slice(0, 4)
      : [];
    return { summary, highlights, usedLlm: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[summarize] LLM 失敗。抜粋にフォールバック:", message);
    return fallbackSummary(content);
  }
}
