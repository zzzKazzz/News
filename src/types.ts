export type FeedbackKind = "like" | "skip" | "deep_dive";

export type Source = {
  id: number;
  name: string;
  url: string;
  enabled: number;
  created_at: string;
};

export type ArticleRow = {
  id: number;
  source_id: number | null;
  title: string;
  url: string;
  content: string | null;
  excerpt: string | null;
  published_at: string | null;
  embedding: Buffer | null;
  score: number | null;
  fetched_at: string;
};

export type EditionSource = {
  name: string;
  url: string;
};

export type EditionItem = {
  articleId: number;
  articleIds: number[];
  title: string;
  url: string;
  sourceName: string;
  sources: EditionSource[];
  summary: string;
  highlights: string[];
  angles: string[];
  score: number;
  feedback: FeedbackKind | null;
};

export type EditionPayload = {
  date: string;
  generatedAt: string;
  usedLlm: boolean;
  items: Omit<EditionItem, "feedback">[];
};

export type EditionView = {
  date: string;
  generatedAt: string;
  usedLlm: boolean;
  lead: EditionItem | null;
  articles: EditionItem[];
};

export type IngestResult = {
  feeds: number;
  inserted: number;
  skipped: number;
  failed: number;
  embedded: number;
};

export type Status = {
  articleCount: number;
  sourceCount: number;
  lastFetchedAt: string | null;
  likeCount: number;
  skipCount: number;
  hasPreference: boolean;
  openaiConfigured: boolean;
  llmError: string | null;
  todayEdition: boolean;
  today: string;
};
