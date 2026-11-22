import { entryFacilitiesOf, resolveReferenceSource, type CodingAnswer, type FormField, type FormSchema } from '@openldr/forms/pure';
import { referenceSearch, type EntryFacility, type FormEntryContext } from '@/api';

/** What the site rules set on a form (design 2026-11-22-form-entries, 5.2). */
export interface SiteControls {
  /** A clerk's one facility, filled in. */
  initialAnswers: Record<string, unknown>;
  /** The facility fields that cannot be changed. */
  readOnly: string[];
  /** The facilities each facility field may offer. */
  offerOnly: Record<string, CodingAnswer[]>;
}

/**
 * The system a register facility field saves its codings under, as the picker would save it. A field
 * bound to a code system names it. A field bound to a value set does not, so one search for a code the
 * context gave reads it from the answer. Null when it cannot be known.
 */
async function systemOf(formId: string, field: FormField, code: string): Promise<string | null> {
  const source = resolveReferenceSource(field);
  if (!source.ok || source.source.kind !== 'coding') return null;
  if (source.source.mode === 'codesystem') return source.source.system;
  const res = await referenceSearch(formId, field.id, { q: code });
  return res.kind === 'coding' ? res.rows.find((r) => r.code === code)?.system ?? null : null;
}

/**
 * Fills and locks a clerk's one facility, or limits the choice to the facilities of the limit. Only
 * fields that pick from the register are touched: a free-text facility field is refused by the server
 * for a limited user, with its own message. A field whose system cannot be known is left as it is, and
 * the server still checks the submission.
 */
export async function siteControls(formId: string, schema: FormSchema, context: FormEntryContext): Promise<SiteControls> {
  const out: SiteControls = { initialAnswers: {}, readOnly: [], offerOnly: {} };
  const choices = context.choices;
  if (!choices) return out;
  const probe = context.facility ?? choices[0];
  if (!probe) return out;

  for (const { id, fromRegister } of entryFacilitiesOf(schema, {}).fields) {
    const field = schema.fields.find((f) => f.id === id);
    if (!fromRegister || !field) continue;
    const system = await systemOf(formId, field, probe.code).catch(() => null);
    if (!system) continue;
    const coding = (f: EntryFacility): CodingAnswer => ({ system, code: f.code, display: f.name });
    if (context.locked && context.facility) {
      out.initialAnswers[id] = coding(context.facility);
      out.readOnly.push(id);
    } else {
      out.offerOnly[id] = choices.map(coding);
    }
  }
  return out;
}
