import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type Edition,
  type EditionItem,
  type FeedbackKind,
  type Source,
  type Status,
} from "./api";
import { DeepDiveChat } from "./DeepDive";

type Busy = "ingest" | "edition" | "bootstrap" | null;

function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(d);
}

type BootResult = {
  status: Status;
  edition: Edition | null;
  sources: Source[];
};

let bootInFlight: Promise<BootResult> | null = null;
const bootPhaseListeners = new Set<(phase: Exclude<Busy, null>) => void>();

function isBusyError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("実行中");
}

async function loadToday(sources: Source[]): Promise<BootResult> {
  const status = await api.status();
  const e = await api.edition(status.today);
  return { status, edition: e.edition, sources };
}

async function waitForTodayEdition(sources: Source[]): Promise<BootResult> {
  for (let i = 0; i < 90; i++) {
    const result = await loadToday(sources);
    if (result.status.todayEdition && result.edition) return result;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("朝刊の準備がタイムアウトしました");
}

function ensureTodayEdition(
  onPhase: (phase: Exclude<Busy, null>) => void,
): Promise<BootResult> {
  bootPhaseListeners.add(onPhase);
  if (!bootInFlight) {
    const emit = (phase: Exclude<Busy, null>) => {
      for (const listener of bootPhaseListeners) listener(phase);
    };
    bootInFlight = (async () => {
      const [status, src] = await Promise.all([api.status(), api.sources()]);
      if (status.todayEdition) return loadToday(src.sources);
      emit("ingest");
      try {
        await api.ingest();
      } catch (err) {
        if (!isBusyError(err)) throw err;
        emit("edition");
        return waitForTodayEdition(src.sources);
      }
      emit("edition");
      try {
        const res = await api.generate();
        const next = await api.status();
        return { status: next, edition: res.edition, sources: src.sources };
      } catch (err) {
        if (!isBusyError(err)) throw err;
        return waitForTodayEdition(src.sources);
      }
    })().finally(() => {
      bootInFlight = null;
      bootPhaseListeners.clear();
    });
  }
  return bootInFlight;
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>("bootstrap");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [diveItem, setDiveItem] = useState<EditionItem | null>(null);

  const refresh = useCallback(async () => {
    const s = await api.status();
    const [e, src] = await Promise.all([
      api.edition(s.today),
      api.sources(),
    ]);
    setStatus(s);
    setEdition(e.edition);
    setSources(src.sources);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBusy("bootstrap");
    ensureTodayEdition((phase) => {
      if (!cancelled) setBusy(phase);
    })
      .then((result) => {
        if (cancelled) return;
        setStatus(result.status);
        setEdition(result.edition);
        setSources(result.sources);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "読み込みに失敗しました");
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (kind: "ingest" | "edition") => {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "ingest") await api.ingest();
      else {
        const res = await api.generate();
        setEdition(res.edition);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "処理に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  const onFeedback = async (item: EditionItem, kind: FeedbackKind) => {
    await api.feedback(item.articleIds?.length ? item.articleIds : item.articleId, kind);
    setEdition((cur) => {
      if (!cur) return cur;
      const patch = (row: EditionItem) =>
        row.articleId === item.articleId ? { ...row, feedback: kind } : row;
      return {
        ...cur,
        lead: cur.lead ? patch(cur.lead) : null,
        articles: cur.articles.map(patch),
      };
    });
  };

  const addFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.addSource(name, url);
      setName("");
      setUrl("");
      setSources((await api.sources()).sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
    }
  };

  const dateLabel = useMemo(
    () => formatDate(status?.today || todayJst()),
    [status?.today],
  );

  return (
    <div className="paper-grain min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <header className="border-b-[3px] border-ink pb-4">
          <div className="flex items-end justify-between gap-4 text-xs tracking-widest text-muted">
            <p>{dateLabel}</p>
            <p>データは端末内 · 流出ゼロ</p>
          </div>
          <p className="mt-4 text-center text-sm font-semibold tracking-[0.6em] text-crimson">
            朝　刊
          </p>
          <h1 className="mt-1 text-center font-black text-4xl tracking-[0.18em] sm:text-6xl">
            日刊パーソナル新聞
          </h1>
          <p className="mt-3 text-center text-sm text-muted">
            自分の関心だけに育つ、手元の一紙
          </p>
        </header>

        <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-ink/40 pb-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <ActionButton
              disabled={busy !== null}
              onClick={() => run("ingest")}
            >
              {busy === "ingest" || busy === "bootstrap" ? "巡回中…" : "今すぐ収集"}
            </ActionButton>
            <ActionButton
              disabled={busy !== null}
              onClick={() => run("edition")}
            >
              {busy === "edition" ? "編集中…" : "今日の朝刊を組む"}
            </ActionButton>
            <ActionButton onClick={() => setSettingsOpen((v) => !v)}>
              {settingsOpen ? "紙面に戻る" : "フィード設定"}
            </ActionButton>
          </div>
          {status && (
            <p className="text-xs text-muted">
              記事 {status.articleCount} · フィード {status.sourceCount} · 好み{" "}
              {status.hasPreference ? "学習済" : "未学習"}
              {status.openaiConfigured ? "" : " · 要約は抜粋"}
            </p>
          )}
        </nav>

        {(error || status?.llmError) && (
          <p className="mt-4 border border-crimson/40 bg-crimson/5 px-3 py-2 text-sm text-crimson">
            {error || status?.llmError}
          </p>
        )}

        {settingsOpen ? (
          <SettingsPanel
            sources={sources}
            name={name}
            url={url}
            setName={setName}
            setUrl={setUrl}
            onAdd={addFeed}
            onToggle={async (id, enabled) => {
              await api.toggleSource(id, enabled);
              setSources((await api.sources()).sources);
            }}
            onDelete={async (id) => {
              await api.deleteSource(id);
              setSources((await api.sources()).sources);
            }}
          />
        ) : busy !== null && !edition?.lead ? (
          <PreparingState phase={busy} />
        ) : edition?.lead ? (
          <Paper
            edition={edition}
            onFeedback={onFeedback}
            onDeepDive={setDiveItem}
          />
        ) : edition ? (
          <FinishedState />
        ) : (
          <EmptyState
            hasArticles={(status?.articleCount ?? 0) > 0}
            busy={busy}
            onIngest={() => run("ingest")}
            onGenerate={() => run("edition")}
          />
        )}

        <footer className="mt-12 border-t border-ink/30 pt-4 text-center text-xs tracking-widest text-muted">
          嗜好エンジンはローカル · クラウドへ送るのは記事本文と深掘り会話のみ
        </footer>
      </div>
      {diveItem && (
        <DeepDiveChat item={diveItem} onClose={() => setDiveItem(null)} />
      )}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="border border-ink px-3 py-1 tracking-wider hover:bg-ink hover:text-paper disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function PreparingState({ phase }: { phase: Exclude<Busy, null> }) {
  const label =
    phase === "ingest"
      ? "フィードを巡回しています…"
      : phase === "edition"
        ? "今日の朝刊を組んでいます…"
        : "今日の朝刊を準備しています…";
  return (
    <section className="mt-16 text-center">
      <h2 className="text-2xl font-bold tracking-widest">{label}</h2>
      <p className="mt-3 text-muted">
        最新の記事を集めて、本日の紙面を編集します。
      </p>
    </section>
  );
}

function FinishedState() {
  return (
    <section className="mt-16 text-center">
      <h2 className="text-2xl font-bold tracking-widest">今日の紙面は読み終わりました</h2>
      <p className="mt-3 text-muted">評価は手元の好み学習に使いました。</p>
    </section>
  );
}

function EmptyState({
  hasArticles,
  busy,
  onIngest,
  onGenerate,
}: {
  hasArticles: boolean;
  busy: Busy;
  onIngest: () => void;
  onGenerate: () => void;
}) {
  return (
    <section className="mt-16 text-center">
      <h2 className="text-2xl font-bold tracking-widest">本日の紙面はまだありません</h2>
      <p className="mt-3 text-muted">
        {hasArticles
          ? "収集済みの記事から朝刊を組めます。"
          : "フィードを巡回して記事を集め、朝刊を自動編集します。"}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        {!hasArticles && (
          <ActionButton disabled={busy !== null} onClick={onIngest}>
            {busy === "ingest" ? "巡回中…" : "最初の収集"}
          </ActionButton>
        )}
        <ActionButton disabled={busy !== null} onClick={onGenerate}>
          {busy === "edition" ? "編集中…" : "朝刊を組む"}
        </ActionButton>
      </div>
    </section>
  );
}

function Paper({
  edition,
  onFeedback,
  onDeepDive,
}: {
  edition: Edition;
  onFeedback: (item: EditionItem, kind: FeedbackKind) => void;
  onDeepDive: (item: EditionItem) => void;
}) {
  return (
    <article className="mt-8">
      {edition.lead && (
        <LeadStory
          item={edition.lead}
          onFeedback={onFeedback}
          onDeepDive={onDeepDive}
        />
      )}
      {edition.articles.length > 0 && (
        <>
          <h2 className="mt-10 mb-4 border-y-2 border-ink py-1 text-center text-sm tracking-[0.4em]">
            二　面
          </h2>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {edition.articles.map((item) => (
              <Story
                key={item.articleId}
                item={item}
                onFeedback={onFeedback}
                onDeepDive={onDeepDive}
                compact
              />
            ))}
          </div>
        </>
      )}
    </article>
  );
}

function LeadStory({
  item,
  onFeedback,
  onDeepDive,
}: {
  item: EditionItem;
  onFeedback: (item: EditionItem, kind: FeedbackKind) => void;
  onDeepDive: (item: EditionItem) => void;
}) {
  return (
    <section>
      <p className="text-xs tracking-[0.35em] text-crimson">{item.sourceName}</p>
      <h2 className="mt-2 text-3xl font-black leading-snug sm:text-5xl">{item.title}</h2>
      <p className="summary-lines mt-5 text-lg leading-8">{item.summary}</p>
      <Highlights items={item.highlights} />
      <Angles items={item.angles ?? []} />
      <StoryMeta item={item} onFeedback={onFeedback} onDeepDive={onDeepDive} />
    </section>
  );
}

function Story({
  item,
  onFeedback,
  onDeepDive,
  compact,
}: {
  item: EditionItem;
  onFeedback: (item: EditionItem, kind: FeedbackKind) => void;
  onDeepDive: (item: EditionItem) => void;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "border-t border-ink/20 pt-4" : ""}>
      <p className="text-[11px] tracking-[0.3em] text-crimson">{item.sourceName}</p>
      <h3 className="mt-1 text-xl font-bold leading-snug">{item.title}</h3>
      <p className="summary-lines mt-3 leading-7">{item.summary}</p>
      <Highlights items={item.highlights} />
      <Angles items={item.angles ?? []} />
      <StoryMeta item={item} onFeedback={onFeedback} onDeepDive={onDeepDive} />
    </section>
  );
}

function Highlights({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
      {items.map((h) => (
        <li key={h}>{h}</li>
      ))}
    </ul>
  );
}

function Angles({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm text-muted">
      {items.map((h) => (
        <li key={h}>{h}</li>
      ))}
    </ul>
  );
}

const FEEDBACK_MESSAGE = {
  like: "似た記事の表示頻度を増やします",
  skip: "似た記事の表示頻度を減らします",
} as const;

function StoryMeta({
  item,
  onFeedback,
  onDeepDive,
}: {
  item: EditionItem;
  onFeedback: (item: EditionItem, kind: FeedbackKind) => void;
  onDeepDive: (item: EditionItem) => void;
}) {
  const interest =
    item.feedback === "like" || item.feedback === "skip" ? item.feedback : null;
  const btn = (kind: "like" | "skip", label: string) => (
    <button
      type="button"
      onClick={() => onFeedback(item, kind)}
      className="border border-ink/40 px-2 py-0.5 text-xs tracking-wider hover:border-ink"
    >
      {label}
    </button>
  );
  const sources = item.sources?.length
    ? item.sources
    : [{ name: "原文", url: item.url }];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {interest ? (
        <p className="text-xs tracking-wider text-muted">
          {FEEDBACK_MESSAGE[interest]}
        </p>
      ) : (
        <>
          {btn("like", "興味あり")}
          {btn("skip", "興味なし")}
        </>
      )}
      <button
        type="button"
        onClick={() => onDeepDive(item)}
        className="border border-ink/40 px-2 py-0.5 text-xs tracking-wider hover:border-ink"
      >
        深掘り
      </button>
      <span className="ml-auto flex flex-wrap justify-end gap-2 text-xs tracking-wider">
        {sources.map((source) => (
          <a
            key={`${source.name}-${source.url}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {source.name}
          </a>
        ))}
      </span>
    </div>
  );
}

function SettingsPanel({
  sources,
  name,
  url,
  setName,
  setUrl,
  onAdd,
  onToggle,
  onDelete,
}: {
  sources: Source[];
  name: string;
  url: string;
  setName: (v: string) => void;
  setUrl: (v: string) => void;
  onAdd: (e: React.FormEvent) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <section className="mt-8">
      <h2 className="border-y-2 border-ink py-1 text-center text-sm tracking-[0.4em]">
        フィード
      </h2>
      <form onSubmit={onAdd} className="mt-6 flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名前"
          className="border border-ink/40 bg-transparent px-3 py-2 sm:w-40"
          required
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/rss.xml"
          className="flex-1 border border-ink/40 bg-transparent px-3 py-2"
          required
        />
        <button type="submit" className="border border-ink px-4 py-2 hover:bg-ink hover:text-paper">
          追加
        </button>
      </form>
      <ul className="mt-6 divide-y divide-ink/20 border-y border-ink/20">
        {sources.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{s.name}</p>
              <p className="truncate text-xs text-muted">{s.url}</p>
            </div>
            <label className="text-sm">
              <input
                type="checkbox"
                checked={s.enabled === 1}
                onChange={(e) => onToggle(s.id, e.target.checked)}
                className="mr-1"
              />
              有効
            </label>
            <button
              type="button"
              onClick={() => onDelete(s.id)}
              className="text-xs text-crimson underline"
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
