import OpenAI from "openai";
import { getDb } from "../db/client";
import { sanitizeText } from "../lib/text";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type StoryHint = {
  title: string;
  summary: string;
  highlights: string[];
  angles: string[];
};

type ArticleContext = {
  sourceName: string;
  title: string;
  url: string;
  body: string;
};

const MAX_TURNS = 12;
const MAX_MEMBERS = 5;
const MAX_MESSAGE_CHARS = 2000;

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

export function normalizeStory(raw: unknown): StoryHint | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
  return {
    title: typeof s.title === "string" ? s.title : "",
    summary: typeof s.summary === "string" ? s.summary : "",
    highlights: list(s.highlights),
    angles: list(s.angles),
  };
}

export function normalizeTurns(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { role?: unknown; content?: unknown };
    if (row.role !== "user" && row.role !== "assistant") continue;
    if (typeof row.content !== "string") continue;
    const content = row.content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content) continue;
    turns.push({ role: row.role, content });
  }
  return turns.slice(-MAX_TURNS);
}

export async function diveChat(
  articleIds: number[],
  messages: ChatTurn[],
  story?: StoryHint,
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY が未設定のため、深掘りできません。");
  }

  const articles = loadArticles(articleIds);
  if (articles.length === 0) throw new Error("記事が見つかりません");

  const history =
    messages.length > 0
      ? messages
      : [
          {
            role: "user" as const,
            content:
              "この記事を深掘りして。背景、争点、今後の注目点を日本語で説明し、最後に続きを聞きやすい質問を3つ添えてください。",
          },
        ];

  try {
    const res = await client().chat.completions.create({
      model: model(),
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt() },
        {
          role: "user",
          content: JSON.stringify({
            story: story
              ? {
                  title: clip(story.title, 200),
                  summary: clip(story.summary, 1200),
                  highlights: story.highlights.slice(0, 6),
                  angles: story.angles.slice(0, 6),
                }
              : null,
            sources: articles,
          }),
        },
        ...history,
      ],
    });
    const reply = res.choices[0]?.message?.content?.trim();
    if (!reply) throw new Error("応答を生成できませんでした");
    return reply;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/401|incorrect api key|invalid api key/i.test(message)) {
      throw new Error("OPENAI_API_KEY が無効なため、深掘りできません。");
    }
    throw new Error(message);
  }
}

function loadArticles(articleIds: number[]): ArticleContext[] {
  const ids = [...new Set(articleIds.filter((id) => Number.isInteger(id) && id > 0))].slice(
    0,
    MAX_MEMBERS,
  );
  if (ids.length === 0) return [];

  const db = getDb();
  const rowAt = db.prepare(
    `SELECT a.title, a.url, a.content, a.excerpt, s.name AS source_name
     FROM articles a
     LEFT JOIN sources s ON s.id = a.source_id
     WHERE a.id = ?`,
  );
  const out: ArticleContext[] = [];
  for (const id of ids) {
    const row = rowAt.get(id) as
      | {
          title: string;
          url: string;
          content: string | null;
          excerpt: string | null;
          source_name: string | null;
        }
      | undefined;
    if (!row) continue;
    const body = sanitizeText(row.content || row.excerpt || "");
    out.push({
      sourceName: row.source_name || "不明",
      title: row.title,
      url: row.url,
      body: clip(body, ids.length > 1 ? 2800 : 8000),
    });
  }
  return out;
}

function systemPrompt(): string {
  return [
    "日本語の新聞デスク調査担当として、渡された記事について読者と対話する。",
    "最初のJSONは紙面の要約と原文ソース。以降は読者との会話。",
    "根拠は渡された記事を優先する。無い固有名詞・数字・発言は作らない。",
    "一般的な制度や背景は「一般知識」と明示してよい。分からないことは分からないと言う。",
    "口調は簡潔で新聞的。必要なら短い箇条書きを使う。",
  ].join("");
}
