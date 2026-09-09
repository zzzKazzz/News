import { useEffect, useRef, useState } from "react";
import { api, type ChatTurn, type EditionItem } from "./api";

const chatCache = new Map<number, ChatTurn[]>();

function itemIds(item: EditionItem): number[] {
  return item.articleIds?.length ? item.articleIds : [item.articleId];
}

export function DeepDiveChat({
  item,
  onClose,
}: {
  item: EditionItem;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatTurn[]>(
    () => chatCache.get(item.articleId) ?? [],
  );
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(
    () => (chatCache.get(item.articleId) ?? []).length === 0,
  );
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatCache.set(item.articleId, messages);
  }, [item.articleId, messages]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  const story = {
    title: item.title,
    summary: item.summary,
    highlights: item.highlights,
    angles: item.angles ?? [],
  };

  const ask = async (history: ChatTurn[]) => {
    setMessages(history);
    setPending(true);
    setError(null);
    try {
      const res = await api.chat(itemIds(item), history, story);
      setMessages([...history, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "深掘りに失敗しました");
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if ((chatCache.get(item.articleId) ?? []).length > 0) return;
    let cancelled = false;
    setPending(true);
    setError(null);
    void api
      .chat(itemIds(item), [], story)
      .then((res) => {
        if (cancelled) return;
        setMessages([{ role: "assistant", content: res.reply }]);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "深掘りに失敗しました");
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.articleId]);

  const send = () => {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    void ask([...messages, { role: "user", content: text }]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dive-title"
        className="paper-grain flex max-h-[88vh] min-h-[28rem] w-full max-w-2xl flex-col border-[3px] border-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b-[3px] border-ink px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs tracking-[0.4em] text-crimson">深　掘　り</p>
            <h2 id="dive-title" className="mt-1 text-lg font-bold leading-snug">
              {item.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-ink px-2 py-0.5 text-xs tracking-wider hover:bg-ink hover:text-paper"
          >
            閉じる
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.map((turn, i) => (
            <p
              key={`${turn.role}-${i}`}
              className={`summary-lines whitespace-pre-wrap text-sm leading-7 ${
                turn.role === "user" ? "border-l-2 border-crimson pl-3" : ""
              }`}
            >
              <span className="mr-2 text-[11px] tracking-widest text-muted">
                {turn.role === "user" ? "あなた" : "編集部"}
              </span>
              {turn.content}
            </p>
          ))}
          {pending && (
            <p className="text-sm tracking-wider text-muted">調べています…</p>
          )}
          {error && (
            <div className="border border-crimson/40 bg-crimson/5 px-3 py-2 text-sm text-crimson">
              <p>{error}</p>
              {messages.length === 0 && (
                <button
                  type="button"
                  className="mt-2 underline"
                  onClick={() => void ask([])}
                >
                  もう一度
                </button>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="flex gap-2 border-t border-ink/30 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="続きを聞く…"
            disabled={pending}
            className="flex-1 resize-none border border-ink/40 bg-transparent px-3 py-2 text-sm disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="self-end border border-ink px-4 py-2 text-sm tracking-wider hover:bg-ink hover:text-paper disabled:opacity-40"
          >
            送る
          </button>
        </form>
      </section>
    </div>
  );
}
