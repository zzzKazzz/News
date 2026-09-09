import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./api/routes";
import { initDb } from "./db/client";
import { startScheduler } from "./jobs/scheduler";
import { rescoreArticles } from "./scoring/score";
import { WEB_DIST_DIR } from "./paths";

initDb();
rescoreArticles();
startScheduler();

const app = createApp();

if (fs.existsSync(path.join(WEB_DIST_DIR, "index.html"))) {
  app.use(
    "/*",
    serveStatic({
      root: "./web/dist",
    }),
  );
}

const port = Number(process.env.PORT) || 8787;
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`朝刊サーバー http://127.0.0.1:${info.port}`);
  console.log("開発UIは npm run dev で http://localhost:5173");
});
