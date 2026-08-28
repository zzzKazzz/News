export function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

export function formatJstDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(d);
}

export function recencyScore(publishedAt: string | null, fetchedAt: string): number {
  const t = publishedAt ? Date.parse(publishedAt) : Date.parse(fetchedAt);
  if (Number.isNaN(t)) return 0.3;
  const ageHours = Math.max(0, (Date.now() - t) / 3_600_000);
  return Math.exp(-ageHours / 36);
}
