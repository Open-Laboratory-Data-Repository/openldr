// Heading ids and the "On this page" list for a doc page.
//
// The renderer (DocMarkdown) and the list must agree on every id, or a click scrolls nowhere.
// Both get their ids from `headingIdMaker`, fed the headings in page order. A repeated heading
// gets a numbered suffix (`steps`, `steps-1`), so two headings never share one anchor.

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Returns a function that turns heading text into a unique id, in the order it is called. */
export function headingIdMaker(): (text: string) => string {
  const used = new Map<string, number>();
  return (text) => {
    const base = slugify(text) || 'section';
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/** Heading text as a reader sees it: no emphasis marks, code ticks or link targets. */
export function plainHeading(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    // `_word_` is emphasis, but the `_` inside `period_from` is part of the name.
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
    .trim();
}

/** The h2 and h3 headings of a page, with the ids DocMarkdown gives them. Code blocks are skipped. */
export function extractToc(markdown: string): TocEntry[] {
  const nextId = headingIdMaker();
  const entries: TocEntry[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!match) continue;
    const level = match[1].length;
    const text = plainHeading(match[2]);
    // Every heading takes an id, so h1 and h4 still use up a slug the way the renderer does.
    const id = nextId(text);
    if (level === 2 || level === 3) entries.push({ id, text, level });
  }
  return entries;
}

/** Show the list only when a page is long enough to need it. */
export function wantsToc(entries: TocEntry[]): boolean {
  return entries.filter((entry) => entry.level === 2).length >= 3;
}
