import type { DiscriminatorCondition, DiscriminatorRule, FieldDiscriminator } from './schema/form-schema';

/**
 * One place that reads a field's `fhirDiscriminator`, in either shape.
 *
 * Ported from corlix `apps/desktop/src/renderer/lib/discriminator.ts` and `discriminatorLabel.ts`.
 * Corlix also has `matchesDiscriminator` and `discriminatorSeed`, which pick and create a list entry
 * when a record is saved. CE does not read the discriminator on save yet, so they are not ported.
 */

function isRule(d: FieldDiscriminator): d is DiscriminatorRule {
  return Array.isArray((d as DiscriminatorRule).conds);
}

/**
 * Either shape as a condition list. Null only when there is no discriminator at all, which differs
 * from an empty one: ticking the editor's checkbox writes `{}`. Keys are sorted, so one
 * discriminator always normalises the same however it was written.
 */
export function normalizeDiscriminator(d: FieldDiscriminator | undefined): DiscriminatorRule | null {
  if (!d) return null;
  if (isRule(d)) return d;
  return {
    join: 'all',
    conds: Object.keys(d).sort().map((el) => ({ el, op: 'equals' as const, val: d[el] })),
  };
}

/**
 * A stable key for "which list entry does this discriminator mean". A map and the rule that means
 * the same thing get one key, so both on one path is a duplicate. The join is part of the key:
 * `all` and `any` over the same conditions are different questions. No discriminator and an empty
 * one both key as the empty string, because neither names an entry.
 */
export function discriminatorIdentity(d: FieldDiscriminator | undefined): string {
  const rule = normalizeDiscriminator(d);
  if (!rule || rule.conds.length === 0) return '';
  const conds = rule.conds
    .map((c) => `${c.el}${c.op === 'equals' ? '=' : `|${c.op}|`}${c.val}`)
    .sort()
    .join('&');
  return rule.join === 'any' ? `any(${conds})` : conds;
}

/**
 * What the editor writes after the author changes a condition.
 *
 * A rule a map can express is stored as a map, so opening an old form and changing nothing leaves
 * it byte-identical. The rule is kept for `any`, for an operator beyond equality, for two conditions
 * on one element (a map would drop one), and when a map would reorder the rows under the author's
 * cursor. Corlix found that last case by driving the editor: a new blank row sorted to the top.
 */
export function toStoredDiscriminator(rule: DiscriminatorRule): FieldDiscriminator {
  if (rule.join === 'any') return rule;
  if (rule.conds.some((c) => c.op !== 'equals')) return rule;
  const els = rule.conds.map((c) => c.el);
  if (new Set(els).size !== els.length) return rule;
  const sorted = [...els].sort();
  if (els.some((el, i) => el !== sorted[i])) return rule;
  const record: Record<string, string> = {};
  for (const c of rule.conds) record[c.el] = c.val;
  return record;
}

function condText(c: DiscriminatorCondition): string {
  switch (c.op) {
    case 'equals':
      return `${c.el} = ${c.val}`;
    case 'not equals':
      return `${c.el} != ${c.val}`;
    case 'starts with':
      // Spelled out: no symbol for this reads unambiguously at 10px.
      return `${c.el} starts with ${c.val}`;
  }
}

/**
 * A field's discriminator as one short line for the field row, for example `system = urn:x`.
 * Two fields bound to `Location.identifier.value` are the same text on screen, and this line is
 * the only thing telling them apart. Null when there is nothing to show, so the row skips the line.
 * `all` joins with a comma; `any` says "or", because a comma would read as "and".
 */
export function discriminatorLabel(d: FieldDiscriminator | undefined): string | null {
  const rule = normalizeDiscriminator(d);
  if (!rule || rule.conds.length === 0) return null;
  return rule.conds.map(condText).join(rule.join === 'any' ? ' or ' : ', ');
}
