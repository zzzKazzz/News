import { getDb } from "../db/client";
import { blobToVec, cosine } from "../lib/vectors";
import { recencyScore } from "../lib/date";
import type { ArticleRow } from "../types";

type PrefRow = {
  like_vector: Buffer | null;
  skip_vector: Buffer | null;
  like_count: number;
  skip_count: number;
};

export function rescoreArticles(): void {
  const db = getDb();
  const pref = db
    .prepare(`SELECT like_vector, skip_vector, like_count, skip_count FROM preference WHERE id = 1`)
    .get() as PrefRow | undefined;
  const likeVec = pref?.like_vector ? blobToVec(pref.like_vector) : null;
  const skipVec = pref?.skip_vector ? blobToVec(pref.skip_vector) : null;

  const rows = db
    .prepare(
      `SELECT * FROM articles WHERE fetched_at >= datetime('now', '-7 days')`,
    )
    .all() as ArticleRow[];

  const update = db.prepare(`UPDATE articles SET score = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const row of rows) {
      update.run(scoreArticle(row, likeVec, skipVec), row.id);
    }
  });
  tx();
}

function scoreArticle(
  row: ArticleRow,
  likeVec: Float32Array | null,
  skipVec: Float32Array | null,
): number {
  const recency = recencyScore(row.published_at, row.fetched_at);
  if (!likeVec || !row.embedding) return recency;
  const emb = blobToVec(row.embedding);
  const pos = cosine(emb, likeVec);
  const neg = skipVec ? cosine(emb, skipVec) : 0;
  return 0.8 * (pos - 0.4 * Math.max(0, neg)) + 0.2 * recency;
}
