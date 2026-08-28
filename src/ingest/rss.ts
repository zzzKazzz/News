import Parser from "rss-parser";
import { getDb } from "../db/client";
import { excerptFrom, extractArticle } from "./extract";
import { embedPendingArticles } from "../scoring/embed";
import { rescoreArticles } from "../scoring/score";
import type { IngestResult, Source } from "../types";

const UA = "PersonalNewspaper/0.1 (+local; private reader)";
const parser = new Parser({
  timeout: 20_000,
  headers: { "User-Agent": UA },
});

const MAX_ITEMS_PER_FEED = 8;
const FETCH_GAP_MS = 350;

let running = false;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
      for (const item of items) {
        const url = item.link?.trim();
        if (!url) {
          result.failed += 1;
          continue;
        }
        if (exists.get(url)) {
          result.skipped += 1;
          continue;
        }

        const rssText = stripHtml(
          item.contentSnippet || item.content || item.summary || "",
        );
        let title = (item.title ?? "").trim() || "無題";
        let content = rssText;

        try {
          const extracted = await extractArticle(url);
          if (extracted) {
            if (extracted.title) title = extracted.title;
            content = extracted.content;
          }
        } catch (err) {
          console.warn(`[ingest] extract failed: ${url}`, err);
        }

        if (!content) {
          result.failed += 1;
          continue;
        }

        insert.run({
          source_id: source.id,
          title,
          url,
          content,
          excerpt: excerptFrom(content),
          published_at: toIso(item.isoDate || item.pubDate),
        });
        result.inserted += 1;
        await sleep(FETCH_GAP_MS);
      }
    }

    result.embedded = await embedPendingArticles();
    rescoreArticles();
    return result;
  } finally {
    running = false;
  }
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
