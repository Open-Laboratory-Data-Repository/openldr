import { entryFacilitiesOf, resolveReferenceSource, type CodingAnswer, type FormField, type FormSchema } from '@openldr/forms/pure';
import { referenceSearch, type EntryFacility, type FormEntryContext } from '@/api';

/** What the site rules set on a form (design 2026-11-22-form-entries, 5.2). */
export interface SiteControls {
  /** A clerk's one facility, filled in. */
  initialAnswers: Record<string, unknown>;
  /** The facility fields that show their answer and cannot be changed. */
  readOnly: string[];
  /** The facilities each facility field may offer. */
  offerOnly: Record<string, CodingAnswer[]>;
  /** Facility fields with nothing to offer: the user's limit names no facility. */
  noFacility: string[];
  /** What a read-only field shows when it holds no answer: the locked facility's name. */
  shown: Record<string, string>;
}

export const NO_SITE_CONTROLS: SiteControls = { initialAnswers: {}, readOnly: [], offerOnly: {}, noFacility: [], shown: {} };

/** One search, and the system of the row whose code matches. Null when no row does or it fails. */
async function systemFromSearch(formId: string, fieldId: string, q: string, code: string): Promise<string | null> {
  try {
    const res = await referenceSearch(formId, fieldId, { q });
    return res.kind === 'coding' ? res.rows.find((r) => r.code === code)?.system ?? null : null;
  } catch {
    return null;
  }
}

/**
 * The system a register facility field saves its codings under, as the picker would save it. A field
 * bound to a code system names it. A field bound to a value set does not, so a search reads it: first
 * for the code, then for the name, since a search can match the display text only. Null when it
 * cannot be learned.
 */
async function systemOf(formId: string, field: FormField, facility: EntryFacility): Promise<string | null> {
  const source = resolveReferenceSource(field);
  if (!source.ok || source.source.kind !== 'coding') return null;
  if (source.source.mode === 'codesystem') return source.source.system;
  return (await systemFromSearch(formId, field.id, facility.code, facility.code))
    ?? (await systemFromSearch(formId, field.id, facility.name, facility.code));
}

/**
 * Fills and locks a clerk's one facility, or limits the choice to the facilities of the limit, or
 * leaves nothing to pick for a limit that names no facility. Only fields that pick from the register
 * are touched: a free-text facility field is refused by the server for a limited user, with its own
 * message.
 *
 * A locked clerk never gets the picker. When the system cannot be learned, the field is still locked
 * and shows the facility's name, but holds no answer: a coding with no system would be written as a
 * broken reference (packages/forms/src/answer-value.ts, toAnswer), so the server refuses the
 * submission as outside the limit instead of storing it.
 */
export async function siteControls(formId: string, schema: FormSchema, context: FormEntryContext): Promise<SiteControls> {
  const out: SiteControls = { initialAnswers: {}, readOnly: [], offerOnly: {}, noFacility: [], shown: {} };
  const choices = context.choices;
  if (!choices) return out;

  for (const { id, fromRegister } of entryFacilitiesOf(schema, {}).fields) {
    const field = schema.fields.find((f) => f.id === id);
    if (!fromRegister || !field) continue;
    if (choices.length === 0) {
      out.noFacility.push(id);
      continue;
    }
    const probe = context.facility ?? choices[0]!;
    const system = await systemOf(formId, field, probe);
    const coding = (f: EntryFacility): CodingAnswer | null => (system ? { system, code: f.code, display: f.name } : null);
    if (context.locked && context.facility) {
      out.readOnly.push(id);
      out.shown[id] = context.facility.name;
      const answer = coding(context.facility);
      if (answer) out.initialAnswers[id] = answer;
    } else if (system) {
      out.offerOnly[id] = choices.map((c) => coding(c)!);
    }
  }
  return out;
}
