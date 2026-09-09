import { getDb } from "../db/client";
import { todayJst } from "../lib/date";
import { clusterArticles, toClusterArticle, type ClusterArticle } from "./cluster";
import { writeStory } from "./summarize";
import { isReadableText, sanitizeText } from "../lib/text";
import type {
  EditionItem,
  EditionPayload,
  EditionView,
  FeedbackKind,
} from "../types";

const TOP_N = 8;
const MAX_MEMBERS_FOR_LLM = 5;
let running = false;

type RankedRow = {
  id: number;
  title: string;
  url: string;
  content: string | null;
  excerpt: string | null;
  score: number | null;
  source_name: string | null;
  embedding: Buffer | null;
};

export async function generateEdition(date = todayJst()): Promise<EditionView> {
  if (running) throw new Error("朝刊の編集はすでに実行中です");
  running = true;
  try {
    const db = getDb();
    const candidates = db
      .prepare(
        `SELECT a.id, a.title, a.url, a.content, a.excerpt, a.score, a.embedding, s.name AS source_name
         FROM articles a
         LEFT JOIN sources s ON s.id = a.source_id
         WHERE a.fetched_at >= datetime('now', '-36 hours')
           AND a.id NOT IN (SELECT article_id FROM feedback)
         ORDER BY COALESCE(a.score, 0) DESC, a.fetched_at DESC
         LIMIT 120`,
      )
      .all() as RankedRow[];
    const readable = candidates.filter((row) =>
      isReadableText(row.content || row.excerpt || ""),
    );

    const clusters = clusterArticles(readable.map(toClusterArticle)).slice(0, TOP_N);
    if (clusters.length === 0) {
      throw new Error("直近の記事がありません。先に収集してください。");
    }

    let usedLlm = false;
    const items: EditionPayload["items"] = [];
    for (const cluster of clusters) {
      const { item, usedLlm: storyLlm } = await storyFromCluster(cluster);
      usedLlm = usedLlm || storyLlm;
      items.push(item);
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

async function storyFromCluster(
  cluster: ClusterArticle[],
): Promise<{ item: Omit<EditionItem, "feedback">; usedLlm: boolean }> {
  const ranked = [...cluster].sort((a, b) => b.score - a.score);
  const forLlm = ranked.slice(0, MAX_MEMBERS_FOR_LLM);
  const story = await writeStory(
    forLlm.map((row) => ({
      sourceName: row.source_name,
      title: row.title,
      content: sanitizeText(row.content || row.excerpt || ""),
    })),
  );
  const sources = uniqueSources(ranked);
  const lead = ranked[0];
  return {
    usedLlm: story.usedLlm,
    item: {
      articleId: lead.id,
      articleIds: ranked.map((row) => row.id),
      title: story.title || lead.title,
      url: lead.url,
      sourceName: sources.map((s) => s.name).join(" / "),
      sources,
      summary: story.summary,
      highlights: story.highlights,
      angles: story.angles,
      score: lead.score,
    },
  };
}

function uniqueSources(cluster: ClusterArticle[]): { name: string; url: string }[] {
  const seen = new Set<string>();
  const out: { name: string; url: string }[] = [];
  for (const row of cluster) {
    if (seen.has(row.source_name)) continue;
    seen.add(row.source_name);
    out.push({ name: row.source_name, url: row.url });
  }
  return out;
}

export function getEdition(date = todayJst()): EditionView | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT payload FROM editions WHERE date = ?`)
    .get(date) as { payload: string } | undefined;
  if (!row) return null;
  const payload = JSON.parse(row.payload) as EditionPayload;
  return viewFromPayload(payload);
}

function itemIds(item: Omit<EditionItem, "feedback">): number[] {
  if (item.articleIds?.length) return item.articleIds;
  return [item.articleId];
}

function viewFromPayload(payload: EditionPayload): EditionView {
  const db = getDb();
  const fb = db.prepare(`SELECT kind FROM feedback WHERE article_id = ?`);
  const items = payload.items.map((item) => {
    const ids = itemIds(item);
    const row = ids
      .map((id) => fb.get(id) as { kind: FeedbackKind } | undefined)
      .find((r) => r != null);
    return {
      ...normalizeItem(item),
      feedback: row?.kind ?? null,
    };
  });
  const [lead, ...rest] = items;
  return {
    date: payload.date,
    generatedAt: payload.generatedAt,
    usedLlm: payload.usedLlm,
    lead: lead ?? null,
    articles: rest,
  };
}

function normalizeItem(item: Omit<EditionItem, "feedback">): Omit<EditionItem, "feedback"> {
  const sources =
    item.sources?.length > 0
      ? item.sources
      : [{ name: item.sourceName || "不明", url: item.url }];
  return {
    articleId: item.articleId,
    articleIds: itemIds(item),
    title: item.title,
    url: item.url,
    sourceName: item.sourceName || sources.map((s) => s.name).join(" / "),
    sources,
    summary: item.summary,
    highlights: item.highlights ?? [],
    angles: item.angles ?? [],
    score: item.score,
  };
}
