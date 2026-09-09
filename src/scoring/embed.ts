import { pipeline, env } from "@xenova/transformers";
import { getDb } from "../db/client";
import { MODEL_CACHE_DIR } from "../paths";
import { vecToBlob } from "../lib/vectors";
import type { ArticleRow } from "../types";
import fs from "node:fs";

env.cacheDir = MODEL_CACHE_DIR;
env.allowLocalModels = false;

type Extractor = (
  text: string,
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let extractorPromise: Promise<Extractor> | null = null;

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    fs.mkdirSync(MODEL_CACHE_DIR, { recursive: true });
    extractorPromise = pipeline(
      "feature-extraction",
      "Xenova/multilingual-e5-small",
    ) as Promise<Extractor>;
  }
  return extractorPromise;
}

export async function embedText(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const input = `passage: ${text.replace(/\s+/g, " ").trim().slice(0, 1800)}`;
  const out = await extractor(input, { pooling: "mean", normalize: true });
  return new Float32Array(out.data);
}

export async function embedPendingArticles(): Promise<number> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM articles WHERE embedding IS NULL ORDER BY id DESC LIMIT 200`,
    )
    .all() as ArticleRow[];
  if (rows.length === 0) return 0;

  let ok = 0;
  const update = db.prepare(`UPDATE articles SET embedding = ? WHERE id = ?`);
  try {
    await getExtractor();
  } catch (err) {
    console.warn("[embed] モデル読み込みに失敗。新しさスコアのみ使います", err);
    return 0;
  }

  for (const row of rows) {
    const text = `${row.title}\n${row.content ?? row.excerpt ?? ""}`;
    try {
      const vec = await embedText(text);
      update.run(vecToBlob(vec), row.id);
      ok += 1;
    } catch (err) {
      console.warn(`[embed] failed article ${row.id}`, err);
    }
  }
  return ok;
}
