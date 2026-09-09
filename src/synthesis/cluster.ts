import { blobToVec, cosine, meanNormalized } from "../lib/vectors";

export type ClusterArticle = {
  id: number;
  title: string;
  url: string;
  content: string | null;
  excerpt: string | null;
  score: number;
  source_name: string;
  embedding: Float32Array | null;
};

/** 同一事件だけを束ねる。低すぎると朝刊全体が1本になる */
const SIM_TO_SEED = 0.88;
const SIM_TO_CENTROID = 0.9;
const MAX_CLUSTER = 5;

export function clusterArticles(rows: ClusterArticle[]): ClusterArticle[][] {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const clusters: ClusterArticle[][] = [];

  for (const row of sorted) {
    if (!row.embedding) {
      clusters.push([row]);
      continue;
    }
    let bestIdx = -1;
    let bestSim = 0;
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      if (cluster.length >= MAX_CLUSTER) continue;
      const seed = cluster[0]?.embedding;
      if (!seed) continue;
      const toSeed = cosine(row.embedding, seed);
      if (toSeed < SIM_TO_SEED) continue;
      const center = meanNormalized(
        cluster.map((m) => m.embedding).filter((v): v is Float32Array => Boolean(v)),
      );
      if (!center) continue;
      const toCenter = cosine(row.embedding, center);
      if (toCenter < SIM_TO_CENTROID) continue;
      if (toCenter > bestSim) {
        bestSim = toCenter;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) clusters[bestIdx].push(row);
    else clusters.push([row]);
  }

  return clusters.sort((a, b) => clusterScore(b) - clusterScore(a));
}

export function clusterScore(cluster: ClusterArticle[]): number {
  const best = Math.max(...cluster.map((a) => a.score), 0);
  const nSources = new Set(cluster.map((a) => a.source_name)).size;
  const coverage = 1 + 0.28 * Math.min(Math.max(nSources - 1, 0), 4);
  return best * coverage;
}

export function toClusterArticle(row: {
  id: number;
  title: string;
  url: string;
  content: string | null;
  excerpt: string | null;
  score: number | null;
  source_name: string | null;
  embedding: Buffer | null;
}): ClusterArticle {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    content: row.content,
    excerpt: row.excerpt,
    score: row.score ?? 0,
    source_name: row.source_name || "不明",
    embedding: row.embedding ? blobToVec(row.embedding) : null,
  };
}
