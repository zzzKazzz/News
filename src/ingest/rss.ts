import Parser from "rss-parser";
import { getDb } from "../db/client";
import { excerptFrom, extractArticle } from "./extract";
import { embedPendingArticles } from "../scoring/embed";
import { rescoreArticles } from "../scoring/score";
import { isPdfContent, isPdfUrl, isReadableText, sanitizeText } from "../lib/text";
import type { IngestResult, Source } from "../types";

const UA = "PersonalNewspaper/0.1 (+local; private reader)";
const parser = new Parser({
  timeout: 20_000,
  headers: { "User-Agent": UA },
  customFields: {
    item: [["content:encoded", "contentEncoded"]],
  },
});

const MAX_ITEMS_PER_FEED = 4;
const EXTRACT_CONCURRENCY = 4;

let running = false;

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx]);
    }
  };
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

export async function runIngest(): Promise<IngestResult> {
  if (running) throw new Error("収集はすでに実行中です");
  running = true;
  const result: IngestResult = {
    feeds: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
    embedded: 0,
  };
  try {
    const db = getDb();
    const sources = db
      .prepare(`SELECT * FROM sources WHERE enabled = 1 ORDER BY id`)
      .all() as Source[];
    result.feeds = sources.length;

    const exists = db.prepare(`SELECT 1 AS n FROM articles WHERE url = ?`);
    const insert = db.prepare(`
      INSERT INTO articles (source_id, title, url, content, excerpt, published_at)
      VALUES (@source_id, @title, @url, @content, @excerpt, @published_at)
    `);

    for (const source of sources) {
      let feed;
      try {
        feed = await parser.parseURL(source.url);
      } catch (err) {
        console.warn(`[ingest] feed failed: ${source.name}`, err);
        result.failed += 1;
        continue;
      }

      const items = (feed.items ?? []).slice(0, MAX_ITEMS_PER_FEED);
      const prepared = await mapPool(items, EXTRACT_CONCURRENCY, async (item) => {
        const url = canonicalItemUrl(item);
        if (!url) return { kind: "failed" as const };
        if (exists.get(url)) return { kind: "skipped" as const };

        const rssText = sanitizeText(
          stripHtml(
            item.contentEncoded || item.content || item.contentSnippet || item.summary || "",
          ),
        );
        let title = sanitizeText((item.title ?? "").trim() || "無題");
        let content = rssText;

        if (isPdfUrl(url) || isPdfContent(rssText)) {
          content = isReadableText(rssText) ? rssText : "";
        } else if (rssText.length < 400) {
          try {
            const extracted = await extractArticle(url);
            if (extracted) {
              if (extracted.title) title = extracted.title;
              content = extracted.content;
            }
          } catch (err) {
            console.warn(`[ingest] extract failed: ${url}`, err);
          }
        }

        if (!isReadableText(content)) return { kind: "failed" as const };
        return {
          kind: "ok" as const,
          row: {
            source_id: source.id,
            title,
            url,
            content,
            excerpt: excerptFrom(content),
            published_at: toIso(item.isoDate || item.pubDate),
          },
        };
      });

      for (const item of prepared) {
        if (item.kind === "skipped") result.skipped += 1;
        else if (item.kind === "failed") result.failed += 1;
        else {
          try {
            insert.run(item.row);
            result.inserted += 1;
          } catch {
            result.skipped += 1;
          }
        }
      }
    }

    result.embedded = await embedPendingArticles();
    rescoreArticles();
    return result;
  } finally {
    running = false;
  }
}

function canonicalItemUrl(item: {
  link?: string;
  content?: string;
  contentEncoded?: string;
  summary?: string;
}): string | null {
  const html = item.contentEncoded || item.content || item.summary || "";
  const fromHtml = html.match(
    /href="(https?:\/\/(?!news\.google\.com)[^"]+)"/i,
  );
  if (fromHtml?.[1]) return fromHtml[1];
  const raw = item.link?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const nested = u.searchParams.get("url");
    if (nested) return nested;
  } catch {
    return raw;
  }
  return raw;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}
