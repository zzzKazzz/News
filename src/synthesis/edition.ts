import { getDb } from "../db/client";
import { todayJst } from "../lib/date";
import { summarizeArticle } from "./summarize";
import type {
  EditionPayload,
  EditionView,
  FeedbackKind,
} from "../types";

const TOP_N = 8;
let running = false;

type RankedRow = {
  id: number;
  title: string;
  url: string;
  content: string | null;
  excerpt: string | null;
  score: number | null;
  source_name: string | null;
};

export async function generateEdition(date = todayJst()): Promise<EditionView> {
  if (running) throw new Error("朝刊の編集はすでに実行中です");
  running = true;
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT a.id, a.title, a.url, a.content, a.excerpt, a.score, s.name AS source_name
         FROM articles a
         LEFT JOIN sources s ON s.id = a.source_id
         WHERE a.fetched_at >= datetime('now', '-36 hours')
         ORDER BY COALESCE(a.score, 0) DESC, a.fetched_at DESC
         LIMIT ?`,
      )
      .all(TOP_N) as RankedRow[];

    if (rows.length === 0) {
      throw new Error("直近の記事がありません。先に収集してください。");
    }

    let usedLlm = false;
    const items: EditionPayload["items"] = [];
    for (const row of rows) {
      const body = row.content || row.excerpt || "";
      const sum = await summarizeArticle(row.title, body);
      usedLlm = usedLlm || sum.usedLlm;
      items.push({
        articleId: row.id,
        title: row.title,
        url: row.url,
        sourceName: row.source_name || "不明",
        summary: sum.summary,
        highlights: sum.highlights,
        score: row.score ?? 0,
      });
    }

    const payload: EditionPayload = {
      date,
      generatedAt: new Date().toISOString(),
      usedLlm,
      items,
    };

    db.prepare(
      `INSERT INTO editions (date, payload) VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET payload = excluded.payload, created_at = datetime('now')`,
    ).run(date, JSON.stringify(payload));

    return viewFromPayload(payload);
  } finally {
    running = false;
  }
}

export function getEdition(date?: string): EditionView | null {
  const db = getDb();
  const row = date
    ? (db.prepare(`SELECT payload FROM editions WHERE date = ?`).get(date) as
        | { payload: string }
        | undefined)
    : (db
        .prepare(`SELECT payload FROM editions ORDER BY date DESC LIMIT 1`)
        .get() as { payload: string } | undefined);
  if (!row) return null;
  const payload = JSON.parse(row.payload) as EditionPayload;
  return viewFromPayload(payload);
}

function viewFromPayload(payload: EditionPayload): EditionView {
  const db = getDb();
  const fb = db.prepare(`SELECT kind FROM feedback WHERE article_id = ?`);
  const withFb = payload.items.map((item) => {
    const row = fb.get(item.articleId) as { kind: FeedbackKind } | undefined;
    return { ...item, feedback: row?.kind ?? null };
  });
  const [lead, ...rest] = withFb;
  return {
    date: payload.date,
    generatedAt: payload.generatedAt,
    usedLlm: payload.usedLlm,
    lead: lead ?? null,
    articles: rest,
  };
}
