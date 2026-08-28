import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const DB_PATH = path.join(DATA_DIR, "news.db");
export const MODEL_CACHE_DIR = path.join(DATA_DIR, "models");
export const DEFAULT_FEEDS_PATH = path.join(
  ROOT_DIR,
  "src/config/feeds.default.json",
);
export const WEB_DIST_DIR = path.join(ROOT_DIR, "web/dist");
