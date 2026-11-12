import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The Form Builder shipped in English only: switching the studio to French or Portuguese left every
 * builder screen in English. This scans its source for words a user reads that do not go through
 * `t()`, so a new screen cannot quietly go back to English.
 *
 * It is a heuristic, not a parser. It looks for:
 * - text between JSX tags, on one line or alone on a line;
 * - aria-label, placeholder, title and alt attributes holding words;
 * - toast calls with a literal message.
 * FHIR element names, field ids and code-system URLs are data, not words, so they stay as they are.
 */

const ROOT = __dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [path] : [];
  });
}

/** A run of text that holds a real word: two letters or more. */
const WORD = /[A-Za-z]{2,}/;

const RULES: { name: string; re: RegExp }[] = [
  // `<Label>Display Label</Label>` or `>+ Add a part<`
  { name: 'inline JSX text', re: />\s*([^<>{}`'"=]*[A-Za-z]{2,}[^<>{}`'"=]*?)\s*<\//g },
  { name: 'attribute', re: /\b(?:aria-label|placeholder|title|alt|description|confirmLabel|label|noSuggestionsLabel|emptyLabel)="([^"]*)"/g },
  { name: 'toast', re: /toast\.(?:success|error|info|warning|message)\(\s*['"`]([^'"`]*)['"`]/g },
];

/** A line that is nothing but JSX text, as Prettier wraps a long label. */
const TEXT_LINE = /^\s*([A-Za-z+(][^<>{}=;`"]*[A-Za-z]{2,}[^<>{}=;`"]*)$/;

function findings(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('import ')) return;
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        if (WORD.test(m[1] ?? '')) out.push(`${relative(ROOT, file)}:${i + 1} ${rule.name}: ${m[1]!.trim()}`);
      }
    }
    // Text alone on a line counts only between a closing `>` and an opening `<`. Expressions in
    // braces are dropped first, so `{n} fields ({m} enabled)` still shows its words.
    const m = TEXT_LINE.exec(line.replace(/\{[^{}]*\}/g, ' ').replace(/\s+$/, ''));
    if (m && !/[,(]$/.test(trimmed) && /[>]\s*$/.test(lines[i - 1] ?? '') && /^\s*</.test(lines[i + 1] ?? '')) {
      out.push(`${relative(ROOT, file)}:${i + 1} text line: ${m[1]!.trim()}`);
    }
  });
  return out;
}

/** Placeholders that show a code value to type, not words to read. Same in every language. */
const CODE_EXAMPLES = new Set(['http://loinc.org', 'displayName', 'id']);

describe('the Form Builder', () => {
  it('has no English text outside t()', () => {
    const found = sourceFiles(ROOT).flatMap(findings).filter((f) => !CODE_EXAMPLES.has(f.slice(f.indexOf(': ') + 2)));
    expect(found).toEqual([]);
  });
});
