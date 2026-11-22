import { entryFacilitiesOf, type CodingAnswer, type FormSchema } from '@openldr/forms/pure';
import type { EntryFacility, FormEntryContext } from '@/api';

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
}

export const NO_SITE_CONTROLS: SiteControls = { initialAnswers: {}, readOnly: [], offerOnly: {}, noFacility: [] };

/** The coding the facility picker saves for this facility. The server names its system. */
const codingOf = (f: EntryFacility): CodingAnswer => ({ system: f.system, code: f.code, display: f.name });

/**
 * Fills and locks a clerk's one facility, limits the choice to the facilities of the limit, or leaves
 * nothing to pick for a limit that names no facility. Only fields that pick from the register are
 * touched, whether bound to a code system or a value set: a free-text facility field is refused by the
 * server for a limited user, with its own message.
 */
export function siteControls(schema: FormSchema, context: FormEntryContext): SiteControls {
  const out: SiteControls = { initialAnswers: {}, readOnly: [], offerOnly: {}, noFacility: [] };
  const choices = context.choices;
  if (!choices) return out;

  for (const { id, fromRegister } of entryFacilitiesOf(schema, {}).fields) {
    if (!fromRegister) continue;
    if (choices.length === 0) {
      out.noFacility.push(id);
    } else if (context.locked && context.facility) {
      out.readOnly.push(id);
      out.initialAnswers[id] = codingOf(context.facility);
    } else {
      out.offerOnly[id] = choices.map(codingOf);
    }
  }
  return out;
}
