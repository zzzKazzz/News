export type FeedbackKind = "like" | "skip" | "deep_dive";

export type EditionItem = {
  articleId: number;
  title: string;
  url: string;
  sourceName: string;
  summary: string;
  highlights: string[];
  score: number;
  feedback: FeedbackKind | null;
};

export type Edition = {
  date: string;
  generatedAt: string;
  usedLlm: boolean;
  lead: EditionItem | null;
  articles: EditionItem[];
};

export type Status = {
  articleCount: number;
  sourceCount: number;
  lastFetchedAt: string | null;
  likeCount: number;
  skipCount: number;
  hasPreference: boolean;
  openaiConfigured: boolean;
  todayEdition: boolean;
  today: string;
};

export type Source = {
  id: number;
  name: string;
  url: string;
  enabled: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  status: () => request<Status>("/api/status"),
  edition: (date?: string) =>
    request<{ edition: Edition | null }>(
      date ? `/api/edition?date=${encodeURIComponent(date)}` : "/api/edition",
    ),
  ingest: () => request<{ ok: boolean; result: unknown }>("/api/ingest", { method: "POST" }),
  generate: () => request<{ ok: boolean; edition: Edition }>("/api/edition", { method: "POST" }),
  sources: () => request<{ sources: Source[] }>("/api/sources"),
  addSource: (name: string, url: string) =>
    request<{ ok: boolean }>("/api/sources", {
      method: "POST",
      body: JSON.stringify({ name, url }),
    }),
  toggleSource: (id: number, enabled: boolean) =>
    request(`/api/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  deleteSource: (id: number) => request(`/api/sources/${id}`, { method: "DELETE" }),
  feedback: (articleId: number, kind: FeedbackKind) =>
    request(`/api/articles/${articleId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),
};
