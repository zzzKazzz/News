import fs from "node:fs";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";
import { DATA_DIR, DB_PATH, DEFAULT_FEEDS_PATH } from "../paths";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error("DB が初期化されていません");
  return db;
}

export function initDb(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  db.prepare(
    `INSERT OR IGNORE INTO preference (id, like_count, skip_count) VALUES (1, 0, 0)`,
  ).run();
  seedSources(db);
  return db;
}

function seedSources(database: Database.Database) {
  const count = database.prepare(`SELECT COUNT(*) AS n FROM sources`).get() as {
    n: number;
  };
  if (count.n > 0) return;
  const raw = fs.readFileSync(DEFAULT_FEEDS_PATH, "utf8");
  const feeds = JSON.parse(raw) as { name: string; url: string }[];
  const insert = database.prepare(
    `INSERT OR IGNORE INTO sources (name, url, enabled) VALUES (?, ?, 1)`,
  );
  const tx = database.transaction(() => {
    for (const feed of feeds) insert.run(feed.name, feed.url);
  });
  tx();
}
