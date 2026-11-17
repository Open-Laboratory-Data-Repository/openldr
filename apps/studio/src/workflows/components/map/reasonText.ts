import { parseTargetPath } from '@openldr/forms/pure';
import type { RowDraft } from './rows';

/** The service's fixed text for a value outside the codes a coded field takes. */
const CODED_VALUE_TEXT = 'this value is not one the field accepts';

/** A key or a path with pins and list indexes dropped. */
function plainPath(path: string): string {
  const parsed = parseTargetPath(path);
  return (parsed ? parsed.path : path).split('.').filter((s) => !/^\d+$/.test(s)).join('.');
}

/**
 * One part of a rule check reason, `record N (Type) path: text`, with the row whose key is that type
 * and path leading in its label. A coded value fault on a row with no Values or Code list rule ends
 * with `addValuesRule`. A part that names no row is kept as it is.
 */
function recordPart(part: string, drafts: RowDraft[], addValuesRule: string): string | null {
  const m = /^record \d+ \(([A-Za-z]+)\) ([^:]+): (.*)$/s.exec(part);
  if (!m) return null;
  const at = plainPath(`${m[1]}.${m[2]}`);
  const row = drafts.find((d) => plainPath(d.targetPath) === at);
  if (!row) return part;
  const text = m[3];
  const needsRule = text === CODED_VALUE_TEXT && row.rule.kind !== 'values' && row.rule.kind !== 'codeList' && addValuesRule !== '';
  return needsRule ? `${row.label}: ${text}. ${addValuesRule}` : `${row.label}: ${text}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A Test reason in the words of the sheet: each target path key becomes that row's label, and
 * when `field` names a row's key or source column, the reason leads with that row's label. A rule
 * check reason (`record N (Type) path: ...`) leads each part with the label of the row for that
 * type and path. A path with no row keeps its text. The reason itself is the server's, in English.
 */
export function reasonText(reason: string, field: string | undefined, drafts: RowDraft[], addValuesRule = ''): string {
  const parts = reason.split('; ');
  if (parts.some((p) => /^record \d+ \(/.test(p))) {
    return parts.map((p) => recordPart(p, drafts, addValuesRule) ?? p).join('; ');
  }
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
