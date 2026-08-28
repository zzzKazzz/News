import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getDb } from "../db/client";
import { runIngest } from "../ingest/rss";
import { applyFeedback } from "../feedback/learn";
import { generateEdition, getEdition } from "../synthesis/edition";
import { isLlmConfigured } from "../synthesis/summarize";
import { todayJst } from "../lib/date";
import type { FeedbackKind, Source, Status } from "../types";

export function createApp() {
  const app = new Hono();
  app.use("*", logger());
  app.use(
    "/api/*",
    cors({
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/status", (c) => {
    const db = getDb();
    const articleCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM articles`).get() as { n: number }
    ).n;
    const sourceCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM sources WHERE enabled = 1`).get() as {
        n: number;
      }
    ).n;
    const last = db
      .prepare(`SELECT MAX(fetched_at) AS t FROM articles`)
      .get() as { t: string | null };
    const pref = db
      .prepare(`SELECT like_count, skip_count, like_vector FROM preference WHERE id = 1`)
      .get() as {
      like_count: number;
      skip_count: number;
      like_vector: Buffer | null;
    };
    const today = todayJst();
    const edition = db
      .prepare(`SELECT 1 AS n FROM editions WHERE date = ?`)
      .get(today) as { n: number } | undefined;
    const status: Status = {
      articleCount,
      sourceCount,
      lastFetchedAt: last.t,
      likeCount: pref?.like_count ?? 0,
      skipCount: pref?.skip_count ?? 0,
      hasPreference: Boolean(pref?.like_vector),
      openaiConfigured: isLlmConfigured(),
      todayEdition: Boolean(edition),
      today,
    };
    return c.json(status);
  });

  app.get("/api/edition", (c) => {
    const date = c.req.query("date");
    const edition = getEdition(date || undefined);
    if (!edition) return c.json({ edition: null });
    return c.json({ edition });
  });

  app.post("/api/ingest", async (c) => {
    try {
      const result = await runIngest();
      return c.json({ ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "収集に失敗しました";
      return c.json({ ok: false, error: message }, 409);
    }
  });

  app.post("/api/edition", async (c) => {
    try {
      const edition = await generateEdition();
      return c.json({ ok: true, edition });
    } catch (err) {
      const message = err instanceof Error ? err.message : "朝刊の生成に失敗しました";
      const status = message.includes("実行中") ? 409 : 400;
      return c.json({ ok: false, error: message }, status);
    }
  });

  app.get("/api/sources", (c) => {
    const sources = getDb()
      .prepare(`SELECT * FROM sources ORDER BY id`)
      .all() as Source[];
    return c.json({ sources });
  });

  app.post("/api/sources", async (c) => {
    const body = await c.req.json<{ name?: string; url?: string }>();
    const name = body.name?.trim();
    const url = body.url?.trim();
    if (!name || !url) return c.json({ error: "name と url が必要です" }, 400);
    try {
      new URL(url);
    } catch {
      return c.json({ error: "URL が不正です" }, 400);
    }
    try {
      const info = getDb()
        .prepare(`INSERT INTO sources (name, url, enabled) VALUES (?, ?, 1)`)
        .run(name, url);
      return c.json({ ok: true, id: Number(info.lastInsertRowid) });
    } catch {
      return c.json({ error: "同じ URL が既にあります" }, 409);
    }
  });

  app.patch("/api/sources/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json<{ enabled?: boolean }>();
    if (typeof body.enabled !== "boolean") {
      return c.json({ error: "enabled が必要です" }, 400);
    }
    getDb()
      .prepare(`UPDATE sources SET enabled = ? WHERE id = ?`)
      .run(body.enabled ? 1 : 0, id);
    return c.json({ ok: true });
  });

  app.delete("/api/sources/:id", (c) => {
    const id = Number(c.req.param("id"));
    getDb().prepare(`DELETE FROM sources WHERE id = ?`).run(id);
    return c.json({ ok: true });
  });

  app.post("/api/articles/:id/feedback", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json<{ kind?: FeedbackKind }>();
    if (!body.kind) return c.json({ error: "kind が必要です" }, 400);
    try {
      applyFeedback(id, body.kind);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "評価に失敗しました";
      return c.json({ error: message }, 400);
    }
  });

  return app;
}
