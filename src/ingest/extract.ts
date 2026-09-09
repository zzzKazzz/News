import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { isPdfContent, isPdfUrl, sanitizeText } from "../lib/text";

const UA = "PersonalNewspaper/0.1 (+local; private reader)";

export async function extractArticle(
  url: string,
): Promise<{ title: string; content: string } | null> {
  if (isPdfUrl(url)) return null;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (/pdf|octet-stream/i.test(ct)) return null;
  const html = await res.text();
  if (isPdfContent(html)) return null;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {});
  const dom = new JSDOM(html, { url, virtualConsole });
  const parsed = new Readability(dom.window.document).parse();
  if (!parsed) return null;
  const content = sanitizeText(parsed.textContent ?? "");
  if (content.length < 80 || isPdfContent(content)) return null;
  return {
    title: sanitizeText(parsed.title ?? ""),
    content: content.slice(0, 20_000),
  };
}

export function excerptFrom(content: string, max = 280): string {
  const t = sanitizeText(content);
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
