import { randomUUID } from 'node:crypto';
import { type Kysely, type Selectable, sql } from 'kysely';
import type { FormEntriesTable, InternalSchema } from './schema/internal';

export type FormEntryStatus = 'active' | 'incomplete' | 'entered-in-error';

/** The ids of the records a save made: the form copy, and each order, sample or result. */
export interface FormEntrySaved { responseId: string | null; resources: { resourceType: string; id: string }[] }

/** One saved form submission. `facilityId` is the facility register's row id. `entryKey` is the
 *  requisition number. `saved` is null until the save has run. */
export interface FormEntry {
  id: string; formId: string;
  facilityId: string | null; facilityCode: string | null; facilityName: string | null;
  entryKey: string | null; summary: { label: string; value: string }[];
  enteredBy: string; enteredByName: string; enteredAt: string;
  status: FormEntryStatus; statusBy: string | null; statusAt: string | null; statusReason: string | null;
  saved: FormEntrySaved | null;
}

export interface NewFormEntry {
  formId: string; facilityId: string | null; facilityCode: string | null; facilityName: string | null;
  entryKey: string | null; summary: { label: string; value: string }[]; enteredBy: string; enteredByName: string;
}

/** The requisition number is already held by an active or incomplete entry. `existing` is that entry. */
export class FormEntryRepeat extends Error {
  constructor(readonly existing: FormEntry) {
    super(`requisition number ${existing.entryKey ?? ''} is already used by entry ${existing.id}`);
    this.name = 'FormEntryRepeat';
  }
}

/** `facilityIds` limits the list to those facilities; left out, every facility shows. With
 *  `orEnteredBy` as well, a row shows if either matches. `orEnteredBy` alone limits nothing, since
 *  every row already shows. `search` matches the start of `entryKey`, ignoring case. */
export interface FormEntryFilter {
  formId: string; facilityIds?: string[]; orEnteredBy?: string; status?: FormEntryStatus;
  enteredBy?: string; search?: string; limit: number; offset: number;
}

export interface FormEntryStore {
  /** Throws FormEntryRepeat when the unique index refuses it. */
  create(input: NewFormEntry): Promise<FormEntry>;
  get(id: string): Promise<FormEntry | null>;
  /** Newest first, with the id breaking ties. `total` counts every match, not just the page. */
  list(filter: FormEntryFilter): Promise<{ entries: FormEntry[]; total: number }>;
  /** Records what the save stored. An entry already entered-in-error keeps that status. */
  setSaved(id: string, saved: FormEntrySaved, status: 'active' | 'incomplete'): Promise<FormEntry>;
  /** Deletes an entry whose save failed. An entry already entered-in-error is kept, so a void is never lost. */
  remove(id: string): Promise<void>;
  /** Null when the entry is already entered-in-error. */
  void(id: string, by: { id: string; reason: string }): Promise<FormEntry | null>;
}

const T = 'form_entries' as const;
type Row = Selectable<FormEntriesTable>;

const iso = (v: Date | string | null): string | null => (v == null ? null : new Date(v).toISOString());

function toEntry(r: Row): FormEntry {
  return {
    id: r.id, formId: r.form_id,
    facilityId: r.facility_id, facilityCode: r.facility_code, facilityName: r.facility_name,
    entryKey: r.entry_key, summary: r.summary,
    enteredBy: r.entered_by, enteredByName: r.entered_by_name, enteredAt: new Date(r.entered_at).toISOString(),
    status: r.status as FormEntryStatus, statusBy: r.status_by, statusAt: iso(r.status_at),
    statusReason: r.status_reason, saved: r.saved,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

export function createFormEntryStore(db: Kysely<InternalSchema>): FormEntryStore {
  /** The active or incomplete entry that holds this number, matched the way the unique index matches. */
  const holder = async (input: NewFormEntry): Promise<FormEntry | null> => {
    if (input.entryKey == null) return null;
    const row = await db.selectFrom(T).selectAll()
      .where('form_id', '=', input.formId)
      .where(sql<string>`coalesce(facility_id, '')`, '=', input.facilityId ?? '')
      .where('entry_key', '=', input.entryKey)
      .where('status', 'in', ['active', 'incomplete'])
      .executeTakeFirst();
    return row ? toEntry(row) : null;
  };

  return {
    async create(input) {
      try {
        const row = await db.insertInto(T).values({
          id: randomUUID(), form_id: input.formId,
          facility_id: input.facilityId, facility_code: input.facilityCode, facility_name: input.facilityName,
          entry_key: input.entryKey, summary: JSON.stringify(input.summary),
          entered_by: input.enteredBy, entered_by_name: input.enteredByName,
        }).returningAll().executeTakeFirstOrThrow();
        return toEntry(row);
      } catch (err) {
        // No read before the write: two saves at once both reach the insert, and the index refuses
        // the second. Only then do we look up the entry that holds the number.
        if (!isUniqueViolation(err)) throw err;
        const existing = await holder(input);
        if (!existing) throw err;
        throw new FormEntryRepeat(existing);
      }
    },

    async get(id) {
      const row = await db.selectFrom(T).selectAll().where('id', '=', id).executeTakeFirst();
      return row ? toEntry(row) : null;
    },

    async list(filter) {
      let q = db.selectFrom(T).where('form_id', '=', filter.formId);
      if (filter.facilityIds !== undefined) {
        const ids = filter.facilityIds;
        const by = filter.orEnteredBy;
        q = q.where((eb) => {
          const ors = [];
          if (ids.length > 0) ors.push(eb('facility_id', 'in', ids));
          if (by !== undefined) ors.push(eb('entered_by', '=', by));
          return ors.length > 0 ? eb.or(ors) : eb.val(false);
        });
      }
      if (filter.status !== undefined) q = q.where('status', '=', filter.status);
      if (filter.enteredBy !== undefined) q = q.where('entered_by', '=', filter.enteredBy);
      if (filter.search) {
        // `substring ... = `, not `like`: no wildcard in the search needs escaping, and pg-mem ignores
        // LIKE escapes.
        const n = [...filter.search].length;
        q = q.where(sql<string>`substring(lower(entry_key) from 1 for ${n})`, '=', sql<string>`lower(${filter.search})`);
      }
      const [rows, count] = await Promise.all([
        q.selectAll().orderBy('entered_at', 'desc').orderBy('id', 'desc')
          .limit(filter.limit).offset(filter.offset).execute(),
        q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      ]);
      return { entries: rows.map(toEntry), total: Number(count.n) };
    },

    async setSaved(id, saved, status) {
      // A row marked in error while its save ran keeps that status; it still learns what was saved.
      const row = await db.updateTable(T)
        .set({ saved: JSON.stringify(saved), status: sql`case when status = 'entered-in-error' then status else ${status} end` as never })
        .where('id', '=', id).returningAll().executeTakeFirst();
      if (!row) throw new Error(`form entry ${id} not found`);
      return toEntry(row);
    },

    async remove(id) {
      await db.deleteFrom(T).where('id', '=', id).where('status', '!=', 'entered-in-error').execute();
    },

    async void(id, by) {
      const row = await db.updateTable(T)
        .set({ status: 'entered-in-error', status_by: by.id, status_reason: by.reason, status_at: sql`now()` as never })
        .where('id', '=', id).where('status', '!=', 'entered-in-error')
        .returningAll().executeTakeFirst();
      return row ? toEntry(row) : null;
    },
  };
}
