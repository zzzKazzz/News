import cron from "node-cron";
import { runIngest } from "../ingest/rss";
import { generateEdition } from "../synthesis/edition";

export function startScheduler() {
  cron.schedule(
    "0 5 * * *",
    async () => {
      console.log("[cron] 05:00 収集を開始");
      try {
        const result = await runIngest();
        console.log("[cron] 収集完了", result);
      } catch (err) {
        console.error("[cron] 収集失敗", err);
      }
    },
    { timezone: "Asia/Tokyo" },
  );

  cron.schedule(
    "30 6 * * *",
    async () => {
      console.log("[cron] 06:30 朝刊を編集");
      try {
        const edition = await generateEdition();
        console.log(`[cron] 朝刊完了 ${edition.date} 記事${edition.articles.length + (edition.lead ? 1 : 0)}件`);
      } catch (err) {
        console.error("[cron] 朝刊失敗", err);
      }
    },
    { timezone: "Asia/Tokyo" },
  );

  console.log("[cron] スケジュール登録: 05:00 収集 / 06:30 朝刊 (Asia/Tokyo)");
}
