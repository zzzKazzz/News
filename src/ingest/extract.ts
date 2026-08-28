import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

const UA = "PersonalNewspaper/0.1 (+local; private reader)";

export async function extractArticle(
  url: string,
): Promise<{ title: string; content: string } | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {});
  const dom = new JSDOM(html, { url, virtualConsole });
  const parsed = new Readability(dom.window.document).parse();
  if (!parsed) return null;
  const content = (parsed.textContent ?? "").replace(/\s+/g, " ").trim();
  if (content.length < 80) return null;
  return {
    title: parsed.title?.trim() || "",
    content: content.slice(0, 20_000),
  };
}

export function excerptFrom(content: string, max = 280): string {
  const t = content.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
