// The website's own docs pages were written with English, French and Portuguese side by side:
// either three sections headed `## English`, `## Français`, `## Português`, or, on the older
// pages, the same section repeated in each language one after the other. This module shows only
// the reader's language.
//
// A page is cut into its `## ` sections. Each section gets a language: from its marker heading
// when it has one, otherwise from the commonest small words in it. Three neighbouring sections
// in English, French and Portuguese are one translated group, and only the reader's language is
// kept from it. A section with no translation is always kept, so nothing on a page is lost.

export type DocLanguage = 'en' | 'fr' | 'pt';

const MARKERS: Record<string, DocLanguage> = { English: 'en', 'Français': 'fr', 'Português': 'pt' };

// Short words that are frequent in one language and rare in the other two.
const WORDS: Record<DocLanguage, string[]> = {
  en: ['the', 'and', 'is', 'to', 'of', 'it', 'with', 'this', 'that', 'are', 'from', 'when', 'you', 'not', 'an'],
  fr: ['le', 'la', 'les', 'des', 'est', 'et', 'du', 'une', 'pour', 'dans', 'pas', 'vous', 'sur', 'avec', 'qui'],
  pt: ['o', 'os', 'as', 'do', 'da', 'dos', 'é', 'não', 'uma', 'para', 'com', 'em', 'ao', 'que', 'se'],
};

interface Section {
  text: string;
  lang: DocLanguage | null;
  marker: boolean;
}

/** Guess a block's language from its small words. Code, links and inline code are ignored. */
export function guessLanguage(text: string): DocLanguage | null {
  const prose = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .toLowerCase();
  const tokens = prose.match(/[a-zà-ÿ]+/g) ?? [];
  const score: Record<DocLanguage, number> = { en: 0, fr: 0, pt: 0 };
  for (const token of tokens) {
    for (const lang of ['en', 'fr', 'pt'] as const) if (WORDS[lang].includes(token)) score[lang] += 1;
  }
  const ranked = (Object.entries(score) as Array<[DocLanguage, number]>).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] < 3 || ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

/** Split at `## ` headings that are not inside a fenced code block. */
function splitSections(markdown: string): { preamble: string; sections: string[] } {
  const lines = markdown.split('\n');
  const starts: number[] = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && /^## /.test(line)) starts.push(i);
  });
  if (starts.length === 0) return { preamble: markdown, sections: [] };
  const preamble = lines.slice(0, starts[0]).join('\n');
  const sections = starts.map((start, i) => lines.slice(start, starts[i + 1] ?? lines.length).join('\n'));
  return { preamble, sections };
}

/** A marker block drops its `## English` line, and its `### ` headings move up one level. */
function unwrapMarker(section: string): string {
  return section
    .split('\n')
    .slice(1)
    .join('\n')
    .replace(/^(#{3,6}) /gm, (_match, hashes: string) => `${hashes.slice(1)} `);
}

/**
 * Some sections are trilingual inside: `### English`, `### Français`, `### Português` blocks, or
 * paragraphs that start with `**English.**`. Keep the heading and any shared text, and only the
 * reader's block or paragraph. Returns null when the section has neither layout.
 */
function filterInside(section: string, lang: DocLanguage): string | null {
  const lines = section.split('\n');
  const starts: Array<{ index: number; lang: DocLanguage }> = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && /^### (English|Français|Português)\s*$/.exec(line);
    if (m) starts.push({ index: i, lang: MARKERS[m[1]] });
  });
  if (starts.length === 3 && new Set(starts.map((s) => s.lang)).size === 3) {
    const head = lines.slice(0, starts[0].index).join('\n').trimEnd();
    const at = starts.findIndex((s) => s.lang === lang);
    const pick = starts[at];
    const end = starts[at + 1]?.index ?? lines.length;
    const block = lines
      .slice(pick.index + 1, end)
      .join('\n')
      .replace(/^(#{4,6}) /gm, (_match, hashes: string) => `${hashes.slice(1)} `)
      .trim();
    return `${head}\n\n${block}`;
  }
  const paragraphs = section.split(/\n{2,}/);
  const marked = /^\*\*(English|Français|Português)\.\*\*\s*/;
  const tagged = paragraphs.filter((p) => marked.test(p));
  if (tagged.length === 3 && new Set(tagged.map((p) => MARKERS[marked.exec(p)![1]])).size === 3) {
    return paragraphs
      .filter((p) => {
        const m = marked.exec(p);
        return !m || MARKERS[m[1]] === lang;
      })
      .map((p) => p.replace(marked, ''))
      .join('\n\n');
  }
  return null;
}

export interface LanguageView {
  /** The page with only the reader's language kept. */
  markdown: string;
  /** True when the page has translated groups, so a language choice changes what it shows. */
  translated: boolean;
  /** True when the reader asked for French or Portuguese and some kept text has no translation. */
  partlyEnglish: boolean;
}

export function selectLanguage(markdown: string, lang: DocLanguage): LanguageView {
  const { preamble, sections } = splitSections(markdown);
  const parsed: Section[] = sections.map((text) => {
    const heading = text.split('\n')[0].slice(3).trim();
    const marker = MARKERS[heading];
    return marker ? { text, lang: marker, marker: true } : { text, lang: guessLanguage(text), marker: false };
  });

  const kept: string[] = [];
  let translated = false;
  let untranslated = false;
  let i = 0;
  while (i < parsed.length) {
    const group = parsed.slice(i, i + 3);
    const langs = new Set(group.map((s) => s.lang));
    if (group.length === 3 && langs.size === 3 && !langs.has(null)) {
      const pick = group.find((s) => s.lang === lang) ?? group.find((s) => s.lang === 'en')!;
      kept.push(pick.marker ? unwrapMarker(pick.text) : pick.text);
      translated = true;
      i += 3;
    } else {
      const section = parsed[i];
      const inside = section.marker ? null : filterInside(section.text, lang);
      if (inside != null) {
        kept.push(inside);
        translated = true;
      } else {
        kept.push(section.marker ? unwrapMarker(section.text) : section.text);
        if (section.lang === 'en') untranslated = true;
      }
      i += 1;
    }
  }
  if (guessLanguage(preamble.replace(/^\s*#[^#\n][^\n]*\n/, '')) === 'en') untranslated = true;

  const body = [preamble.trimEnd(), ...kept.map((s) => s.trim())].filter((s) => s.length > 0).join('\n\n');
  return { markdown: `${body}\n`, translated, partlyEnglish: lang !== 'en' && translated && untranslated };
}
