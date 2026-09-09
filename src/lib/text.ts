export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = Number.parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

export function sanitizeText(s: string): string {
  return decodeEntities(s)
    .replace(/\uFFFD/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPdfUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith(".pdf") || path.includes(".pdf");
  } catch {
    return /\.pdf(\b|$)/i.test(url);
  }
}

export function isPdfContent(s: string): boolean {
  const t = s.slice(0, 800);
  return (
    t.startsWith("%PDF") ||
    /\/Type\s*\/(Catalog|Page|XRef)/i.test(t) ||
    /\/Index\[\d+/i.test(t) ||
    /endobj\b/.test(t)
  );
}

export function isReadableText(s: string): boolean {
  const t = sanitizeText(s);
  if (t.length < 12) return false;
  if (isPdfContent(t)) return false;
  const letters = (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return letters / t.length >= 0.45;
}
