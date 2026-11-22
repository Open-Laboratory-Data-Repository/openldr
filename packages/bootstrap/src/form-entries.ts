import type { FormEntry, FormEntrySaved, FormEntryStatus, FormEntryStore } from '@openldr/db';
import { entryFacilitiesOf, entryKeyOf, entryValuesOf, type FacilityAnswer, type FormSchema } from '@openldr/forms';
import type { DataScope } from '@openldr/rbac';
import type { WorkflowTriggerRunner } from '@openldr/workflows';
import type { AuditActor, AuditDetails } from './record-audit';
import { inDataScope, type ScopeRegistryRow } from './data-scope';
import { registryConceptCodeById, registryRowIdByConceptCode } from './facility-reconcile';

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

/** A facility as the form's picker names it: the register row id, the code the picker saves, the name. */
export interface EntryFacility { id: string; code: string; name: string }

/** The site rules the form screen applies before a submission. `locked`: the limit covers exactly one
 *  facility, and `facility` is it. `choices`: the facilities the limit covers, null for no limit. */
export interface EntryContext { facility: EntryFacility | null; locked: boolean; choices: EntryFacility[] | null }

/** Who is asking. A limited user sees entries inside the limit and entries they made. */
export interface EntryViewer { id: string; dataScope: DataScope }

export interface FormEntriesService {
  /** One page of a form's entries the user may see, newest first. `total` counts every match. */
  list(input: {
    formId: string; user: EntryViewer; status?: FormEntryStatus; enteredBy?: string; search?: string;
    limit: number; offset: number;
  }): Promise<{ entries: FormEntry[]; total: number }>;
  /** Null when there is no such entry, or when the user may not see it. */
  get(id: string, user: EntryViewer): Promise<FormEntry | null>;
  /** What the form screen pre-fills. Only the user's limit decides it, so it is the same on every form. */
  context(user: EntryViewer): Promise<EntryContext>;

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

  /** Marks an entry entered in error, which frees its number, then saves every record it made again
   *  with that FHIR status. The row is marked first and stays marked if the re-save fails; `warning`
   *  then says the records were not updated. `skipped` counts records that could not be read or whose
   *  type has no such status. Throws when the reason is empty or longer than 500 characters. */
  voidEntry(input: {
    entryId: string; reason: string; user: { id: string; name: string; dataScope: DataScope }; actor: AuditActor;
  }): Promise<VoidedEntry | 'not-found' | 'already-void'>;
}

export interface VoidedEntry { entry: FormEntry; resaved: number; skipped: number; warning?: string }

export interface FormEntriesDeps {
  store: FormEntryStore;
  /** Every facility register row. A limit and a picked code are both resolved against all of them. */
  registryRows(): Promise<ScopeRegistryRow[]>;
  /** Reads the records an entry made, to mark them in error. */
  fhir: { get(resourceType: string, id: string): Promise<Record<string, unknown> | null> };
  /** Runs the ingest workflow that saves them again, the same one the submit route uses. */
  runner: Pick<WorkflowTriggerRunner, 'runAndRecord'>;
  audit(actor: AuditActor, details: AuditDetails): Promise<void>;
}

/** The record types whose FHIR status allows `entered-in-error`. Each is checked against its schema
 *  in packages/fhir/src/resources. A record of any other type is left as it is. */
const VOIDABLE_TYPES = new Set(['QuestionnaireResponse', 'ServiceRequest', 'Specimen', 'Observation', 'DiagnosticReport']);
const MAX_REASON = 500;
const NOT_UPDATED = 'The entry is marked in error, but its saved records were not updated.';

const EMPTY_LIMIT = 'your data limit names no facility, so you cannot enter this form';
const FREE_TEXT = "this form's facility field is free text, so it cannot be used by a user limited to a site";
const OUTSIDE = 'this entry names a facility outside your limit';

export function createFormEntriesService(deps: FormEntriesDeps): FormEntriesService {
  const idsIn = (rows: ScopeRegistryRow[], scope: Extract<DataScope, { limited: true }>): string[] =>
    rows.filter((r) => inDataScope(r, scope)).map((r) => r.id);
  const facilityIdsOf = async (scope: DataScope): Promise<string[] | null> =>
    scope.limited ? idsIn(await deps.registryRows(), scope) : null;

  const get = async (id: string, user: EntryViewer): Promise<FormEntry | null> => {
    const entry = await deps.store.get(id);
    if (!entry) return null;
    if (!user.dataScope.limited || entry.enteredBy === user.id) return entry;
    const ids = await facilityIdsOf(user.dataScope);
    return entry.facilityId !== null && ids !== null && ids.includes(entry.facilityId) ? entry : null;
  };

  return {
    facilityIdsOf,

    async list({ formId, user, status, enteredBy, search, limit, offset }) {
      const ids = await facilityIdsOf(user.dataScope);
      return deps.store.list({
        formId, status, enteredBy, search, limit, offset,
        // A limited user: entries at a facility inside the limit, or entries they made.
        ...(ids === null ? {} : { facilityIds: ids, orEnteredBy: user.id }),
      });
    },

    get,

    async context(user) {
      const scope = user.dataScope;
      if (!scope.limited) return { facility: null, locked: false, choices: null };
      const rows = await deps.registryRows();
      // The code a register field saves depends on the whole register, so map every row first.
      const codeById = registryConceptCodeById(rows);
      const choices = rows.filter((r) => inDataScope(r, scope))
        .map((r) => ({ id: r.id, code: codeById.get(r.id)!, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const only = choices.length === 1 ? choices[0]! : null;
      return { facility: only, locked: only !== null, choices };
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

    async voidEntry({ entryId, reason: raw, user, actor }) {
      const reason = raw.trim();
      if (reason.length === 0 || reason.length > MAX_REASON) {
        throw new Error(`a reason of 1 to ${MAX_REASON} characters is required`);
      }
      const before = await get(entryId, user);
      if (!before) return 'not-found';
      // The row is the source of truth: once marked, a failed re-save does not undo it.
      const entry = await deps.store.void(entryId, { id: user.id, reason });
      if (!entry) return 'already-void';

      const refs = [
        ...(before.saved?.responseId ? [{ resourceType: 'QuestionnaireResponse', id: before.saved.responseId }] : []),
        ...(before.saved?.resources ?? []),
      ];
      let skipped = 0;
      const changed: Record<string, unknown>[] = [];
      for (const ref of refs) {
        if (!VOIDABLE_TYPES.has(ref.resourceType)) { skipped += 1; continue; }
        let record: Record<string, unknown> | null = null;
        try {
          record = await deps.fhir.get(ref.resourceType, ref.id);
        } catch {
          record = null;
        }
        if (!record) { skipped += 1; continue; }
        changed.push({ ...record, status: 'entered-in-error' });
      }

      let resaved = 0;
      let warning: string | undefined;
      if (changed.length > 0) {
        const bundle = {
          resourceType: 'Bundle', type: 'transaction',
          entry: changed.map((resource) => ({
            resource, request: { method: 'PUT', url: `${String(resource.resourceType)}/${String(resource.id)}` },
          })),
        };
        try {
          const outcome = await deps.runner.runAndRecord('wf-ingest', 'form', {
            method: 'POST', body: bundle, headers: {}, query: {}, __provenance: { sourceSystem: 'form-capture' },
          });
          if (outcome && outcome.status === 'completed' && !outcome.held) resaved = changed.length;
          else warning = outcome ? `${NOT_UPDATED} Check run ${outcome.runId}.` : `${NOT_UPDATED} The ingest workflow is missing or disabled.`;
        } catch {
          warning = NOT_UPDATED;
        }
      }

      await deps.audit(actor, {
        action: 'form.entry.void', entityType: 'form-entry', entityId: entry.id, before, after: entry,
        metadata: { reason, resaved, skipped, ...(warning ? { warning } : {}) },
      });
      return { entry, resaved, skipped, ...(warning ? { warning } : {}) };
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
