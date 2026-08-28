import { getDb } from "../db/client";
import { blobToVec, meanNormalized, vecToBlob } from "../lib/vectors";
import { rescoreArticles } from "../scoring/score";
import type { FeedbackKind } from "../types";

const KINDS: FeedbackKind[] = ["like", "skip", "deep_dive"];

export function applyFeedback(articleId: number, kind: FeedbackKind): void {
  if (!KINDS.includes(kind)) throw new Error("不正な評価です");
  const db = getDb();
  const article = db
    .prepare(`SELECT id FROM articles WHERE id = ?`)
    .get(articleId) as { id: number } | undefined;
  if (!article) throw new Error("記事が見つかりません");

  db.prepare(
    `INSERT INTO feedback (article_id, kind) VALUES (?, ?)
     ON CONFLICT(article_id) DO UPDATE SET kind = excluded.kind, created_at = datetime('now')`,
  ).run(articleId, kind);

  recomputePreference();
  rescoreArticles();
}

export function recomputePreference(): void {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.embedding AS embedding, f.kind AS kind
       FROM feedback f
       JOIN articles a ON a.id = f.article_id
       WHERE a.embedding IS NOT NULL`,
    )
    .all() as { embedding: Buffer; kind: FeedbackKind }[];

  const likes: Float32Array[] = [];
  const skips: Float32Array[] = [];
  for (const row of rows) {
    const vec = blobToVec(row.embedding);
    if (row.kind === "skip") skips.push(vec);
    else {
      likes.push(vec);
      if (row.kind === "deep_dive") likes.push(vec);
    }
  }

  const likeMean = meanNormalized(likes);
  const skipMean = meanNormalized(skips);
  db.prepare(
    `UPDATE preference SET
      like_vector = ?, like_count = ?,
      skip_vector = ?, skip_count = ?,
      updated_at = datetime('now')
     WHERE id = 1`,
  ).run(
    likeMean ? vecToBlob(likeMean) : null,
    likes.length,
    skipMean ? vecToBlob(skipMean) : null,
    skips.length,
  );
}
