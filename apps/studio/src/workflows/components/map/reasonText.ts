import type { RowDraft } from './rows';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A Test reason in the words of the sheet: each target path key becomes that row's label, and
 * when `field` names a row's key or source column, the reason leads with that row's label.
 * A path with no row keeps its text. The reason itself is the server's, in English.
 */
export function reasonText(reason: string, field: string | undefined, drafts: RowDraft[]): string {
  const row = field
    ? (drafts.find((d) => d.targetPath === field) ??
      drafts.find((d) => d.source.kind === 'field' && d.source.fields.includes(field)))
    : undefined;

  let text = reason;
  if (row && field) text = text.replace(new RegExp(`^${escapeRe(field)}\\s*:?\\s*`), '');
  const keys = drafts.map((d) => d.targetPath).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const label = drafts.find((d) => d.targetPath === key)!.label;
    if (label !== key) text = text.replace(new RegExp(`(^|[^\\w.?=&])${escapeRe(key)}(?![\\w.?=&])`, 'g'), `$1${label}`);
  }
  if (!row) return text;
  if (text.startsWith(`${row.label}:`)) return text;
  text = text.replace(new RegExp(`^${escapeRe(row.label)}\\s*:?\\s*`), '');
  return `${row.label}: ${text}`;
}
