import type { FormEntry, FormEntrySaved, FormEntryStore } from '@openldr/db';
import { entryFacilitiesOf, entryKeyOf, entryValuesOf, type FacilityAnswer, type FormSchema } from '@openldr/forms';
import type { DataScope } from '@openldr/rbac';
import { inDataScope, type ScopeRegistryRow } from './data-scope';
import { registryRowIdByConceptCode } from './facility-reconcile';

// Form entries (design 2026-11-22-form-entries). The submit route writes an entry row before the
// save runs, so a repeated requisition number is refused before anything is stored, then settles the
// row once the save is done.

/** A submission refused by the site rules: the user's data limit does not allow the facility. */
export class EntrySiteError extends Error {
  constructor(message: string, readonly reason: 'outside-limit' | 'free-text-facility' | 'empty-limit') {
    super(message);
    this.name = 'EntrySiteError';
  }
}

export interface FormEntriesService {
  /** The facility register row ids a limit covers. Null means no limit. Reads the register itself. */
  facilityIdsOf(scope: DataScope): Promise<string[] | null>;
  /** Checks the site rules, then writes the row. Throws EntrySiteError or FormEntryRepeat. */
  begin(input: {
    form: { id: string; schema: FormSchema };
    answers: Record<string, unknown>;
    user: { id: string; name: string; dataScope: DataScope };
  }): Promise<FormEntry>;
  /** After the save: `stored` is what the save left behind. ok true means it completed.
   *  `somethingStored` says the save stored records even when `stored` names none, because their
   *  ids could not be found. Left out, it is worked out from `stored`. */
  finish(entryId: string, outcome: { ok: boolean; stored: FormEntrySaved; somethingStored?: boolean }): Promise<FormEntry | null>;
}

export interface FormEntriesDeps {
  store: FormEntryStore;
  /** Every facility register row. A limit and a picked code are both resolved against all of them. */
  registryRows(): Promise<ScopeRegistryRow[]>;
}

const EMPTY_LIMIT = 'your data limit names no facility, so you cannot enter this form';
const FREE_TEXT = "this form's facility field is free text, so it cannot be used by a user limited to a site";
const OUTSIDE = 'this entry names a facility outside your limit';

export function createFormEntriesService(deps: FormEntriesDeps): FormEntriesService {
  const idsIn = (rows: ScopeRegistryRow[], scope: Extract<DataScope, { limited: true }>): string[] =>
    rows.filter((r) => inDataScope(r, scope)).map((r) => r.id);

  return {
    async facilityIdsOf(scope) {
      if (!scope.limited) return null;
      return idsIn(await deps.registryRows(), scope);
    },

    async begin({ form, answers, user }) {
      const values = entryValuesOf(form.schema, answers);
      // Every facility field counts: a form may carry two, and the order keeps the last answered one.
      const facilities = entryFacilitiesOf(form.schema, answers);
      const picked = facilities.order?.facility ?? null;
      const scope = user.dataScope;
      // Read the register once, only when the limit or a picked facility needs it.
      const rows = scope.limited || facilities.answered.some((a) => a.facility) ? await deps.registryRows() : [];
      // The code a register field saves is the register concept code, which maps back to one row.
      const idByCode = registryRowIdByConceptCode(rows);
      const rowIdOf = (a: FacilityAnswer): string | null => (a.facility ? idByCode.get(a.facility.code) ?? null : null);

      if (scope.limited) {
        const allowed = idsIn(rows, scope);
        if (allowed.length === 0) throw new EntrySiteError(EMPTY_LIMIT, 'empty-limit');
        if (facilities.fields.some((f) => !f.fromRegister)) throw new EntrySiteError(FREE_TEXT, 'free-text-facility');
        const outside = facilities.answered.some((a) => {
          const id = rowIdOf(a);
          return id === null || !allowed.includes(id);
        });
        if (outside || (facilities.fields.length > 0 && facilities.answered.length === 0)) {
          throw new EntrySiteError(OUTSIDE, 'outside-limit');
        }
      }

      // The entry names the facility the order will carry, so the list and the order agree.
      const facilityId = facilities.order ? rowIdOf(facilities.order) : null;
      const facilityName = facilities.order?.name ?? rows.find((r) => r.id === facilityId)?.name ?? null;

      // Never inside a transaction: on Postgres the unique violation aborts it, and the store's
      // follow-up read of the holding entry would then fail.
      return deps.store.create({
        formId: form.id,
        facilityId,
        facilityCode: picked?.code ?? null,
        facilityName,
        // The number the order carries, so the repeat check and the order agree.
        entryKey: entryKeyOf(form.schema, answers),
        summary: values.summary,
        enteredBy: user.id,
        enteredByName: user.name,
      });
    },

    async finish(entryId, outcome) {
      if (outcome.ok) return deps.store.setSaved(entryId, outcome.stored, 'active');
      const stored = outcome.somethingStored
        ?? (outcome.stored.responseId !== null || outcome.stored.resources.length > 0);
      if (!stored) {
        await deps.store.remove(entryId);
        return null;
      }
      // An order may exist, so the row keeps the number until someone marks it in error.
      return deps.store.setSaved(entryId, outcome.stored, 'incomplete');
    },
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `CS-0001 was already entered on 22 Nov 2026 at 13:50 by aisha.` The time is in the lab's time
 *  zone when one is set, else UTC. */
export function repeatMessage(
  entry: Pick<FormEntry, 'entryKey' | 'enteredAt' | 'enteredByName'>,
  timeZone?: string,
): string {
  const at = new Date(entry.enteredAt);
  const partsIn = (zone: string) => new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = partsIn(timeZone?.trim() || 'UTC');
  } catch {
    parts = partsIn('UTC');
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${Number(part('day'))} ${MONTHS[Number(part('month')) - 1]} ${part('year')}`;
  // A name that already ends the sentence, such as "Aisha M.", takes no second full stop.
  const stop = entry.enteredByName.endsWith('.') ? '' : '.';
  return `${entry.entryKey ?? ''} was already entered on ${date} at ${part('hour')}:${part('minute')} by ${entry.enteredByName}${stop}`;
}
