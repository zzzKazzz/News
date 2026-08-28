# 日刊パーソナル新聞

ローカルファーストの自律型・日刊パーソナル新聞。閲覧履歴・評価・関心ベクトルは SQLite に閉じ、クラウド LLM には記事本文の要約だけを送る。

## 起動

```bash
cp .env.example .env   # OPENAI_API_KEY を入れる（無くても抜粋で朝刊は組める）
npm install
npm run dev
```

- UI: http://localhost:5173
- API: http://127.0.0.1:8787

1. 「今すぐ収集」で RSS を巡回
2. 「今日の朝刊を組む」で紙面を生成
3. 各記事を「刺さった / 興味なし / 深掘り希望」で育成

本番相当（Cron 付き・ビルド済み UI を同一ポートで配信）:

```bash
npm run build
npm run start
```

定期実行（Asia/Tokyo）: 05:00 収集 / 06:30 朝刊生成
