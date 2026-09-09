import { getDb } from "../db/client";
import { blobToVec, cosine } from "../lib/vectors";
import { recencyScore } from "../lib/date";
import type { ArticleRow } from "../types";

type PrefRow = {
  like_vector: Buffer | null;
};

type SkipExample = {
  vec: Float32Array;
  at: number;
};

type ScoredRow = ArticleRow & { source_name: string | null };

/** 興味なしの効きが半減するまでの時間。3日後の重要ニュースは戻せる */
const SKIP_DECAY_HOURS = 48;
/** 興味なしでも 0 にはしない。重要 × 新規性が高ければ紙面に残る */
const INTEREST_FLOOR = 0.2;

const SOURCE_WEIGHT: Record<string, number> = {
  Reuters: 1.4,
  CNBC: 1.2,
  Fed: 1.55,
  BIS: 1.35,
  ECB: 1.45,
  IMF: 1.4,
  OECD: 1.25,
  "NHK 主要ニュース": 1.25,
  日銀: 1.5,
  内閣府: 1.35,
  "BBC World": 1.25,
  Nature: 1.3,
  Science: 1.3,
  OpenAI: 1.15,
  TechCrunch: 1.05,
  "The Verge": 1.0,
  "Ars Technica": 1.05,
  "All-In Podcast": 1.1,
  中島聡: 1.1,
  "ITmedia News": 0.95,
  企業リリース: 0.72,
  GIGAZINE: 0.75,
  Zenn: 0.7,
  "はてなブックマーク IT": 0.75,
  "The Guardian World": 1.15,
  "Al Jazeera": 1.15,
};

export function rescoreArticles(): void {
  const db = getDb();
  const pref = db
    .prepare(`SELECT like_vector FROM preference WHERE id = 1`)
    .get() as PrefRow | undefined;
  const likeVec = pref?.like_vector ? blobToVec(pref.like_vector) : null;
  const skips = loadSkips();

  const rows = db
    .prepare(
      `SELECT a.*, s.name AS source_name
       FROM articles a
       LEFT JOIN sources s ON s.id = a.source_id
       WHERE a.fetched_at >= datetime('now', '-7 days')`,
    )
    .all() as ScoredRow[];

  const update = db.prepare(`UPDATE articles SET score = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const row of rows) {
      update.run(scoreArticle(row, likeVec, skips), row.id);
    }
  });
  tx();
}

function loadSkips(): SkipExample[] {
  const rows = getDb()
    .prepare(
      `SELECT a.embedding AS embedding, f.created_at AS created_at
       FROM feedback f
       JOIN articles a ON a.id = f.article_id
       WHERE f.kind = 'skip' AND a.embedding IS NOT NULL`,
    )
    .all() as { embedding: Buffer; created_at: string }[];
  return rows.map((row) => ({
    vec: blobToVec(row.embedding),
    at: parseSqliteTime(row.created_at),
  }));
}

function scoreArticle(
  row: ScoredRow,
  likeVec: Float32Array | null,
  skips: SkipExample[],
): number {
  const novelty = recencyScore(row.published_at, row.fetched_at);
  const importance = newsImportance(row.source_name, row.title, row.excerpt);
  if (!row.embedding) return importance * 0.55 * novelty;

  const emb = blobToVec(row.embedding);
  const likeSim = likeVec ? Math.max(0, cosine(emb, likeVec)) : 0;
  const skipSim = decayedSkipSimilarity(emb, skips);
  const interest = userInterest(likeSim, skipSim);
  return importance * interest * novelty;
}

function userInterest(likeSim: number, skipSim: number): number {
  const raw = 0.22 + 0.78 * likeSim - 0.58 * skipSim;
  return clamp(raw, INTEREST_FLOOR, 1.15);
}

function decayedSkipSimilarity(emb: Float32Array, skips: SkipExample[]): number {
  let best = 0;
  const now = Date.now();
  for (const skip of skips) {
    const ageHours = Math.max(0, (now - skip.at) / 3_600_000);
    const decay = Math.exp(-ageHours / SKIP_DECAY_HOURS);
    best = Math.max(best, cosine(emb, skip.vec) * decay);
  }
  return Math.max(0, best);
}

function newsImportance(
  sourceName: string | null,
  title: string,
  excerpt: string | null,
): number {
  const source = SOURCE_WEIGHT[sourceName ?? ""] ?? 1;
  return source * magnitudeBoost(`${title}\n${excerpt ?? ""}`);
}

function magnitudeBoost(text: string): number {
  let boost = 1;
  if (
    /突然|緊急|breaking|史上|侵攻|破綻|非常事態|100\s*%|関税.{0,16}(100|倍|引き上げ)/i.test(
      text,
    )
  ) {
    boost += 0.35;
  }
  if (/利上げ|利下げ|FOMC|rate hike|rate cut|制裁|停戦|ceasefire/i.test(text)) {
    boost += 0.15;
  }
  return Math.min(boost, 1.55);
}

function parseSqliteTime(value: string): number {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Date.now() : t;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
