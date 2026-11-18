import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

/** The roles that may open and that may submit one form. Empty: every role with the capability. */
export interface FormAccess { open: string[]; submit: string[] }

export interface FormAccessStore {
  get(formId: string): Promise<FormAccess>;
  /** Replaces both lists, and returns them as they were and as they are now, both read under the
   *  lock the save holds, so another save cannot slip between them (roles review FR10). */
  set(formId: string, access: FormAccess): Promise<{ before: FormAccess; after: FormAccess }>;
  /** The lists of the given forms. A form with no row is absent. */
  forForms(formIds: string[]): Promise<Map<string, FormAccess>>;
  /** Takes a deleted role off every form. */
  removeRole(roleId: string): Promise<void>;
}

const CHUNK = 1000;

export function createFormAccessStore(db: Kysely<InternalSchema>): FormAccessStore {
  const collect = (rows: Array<{ form_id: string; role_id: string; mode: string }>): Map<string, FormAccess> => {
    const out = new Map<string, FormAccess>();
    for (const r of rows) {
      const a = out.get(r.form_id) ?? { open: [], submit: [] };
      if (r.mode === 'open') a.open.push(r.role_id);
      else if (r.mode === 'submit') a.submit.push(r.role_id);
      out.set(r.form_id, a);
    }
    for (const a of out.values()) { a.open.sort(); a.submit.sort(); }
    return out;
  };
  return {
    async get(formId) {
      const rows = await db.selectFrom('form_access').select(['form_id', 'role_id', 'mode']).where('form_id', '=', formId).execute();
      return collect(rows).get(formId) ?? { open: [], submit: [] };
    },
    async set(formId, access) {
      return db.transaction().execute(async (trx) => {
        // Saves of one form take turns: each holds the form's row until it commits, so the next
        // one deletes this one's rows before it inserts its own. Without it two saves at once
        // both delete, then both insert, and the lists merge (roles review FR5).
        await trx.selectFrom('form_definitions').select('id').where('id', '=', formId).forUpdate().execute();
        const read = async () => collect(await trx.selectFrom('form_access').select(['form_id', 'role_id', 'mode'])
          .where('form_id', '=', formId).execute()).get(formId) ?? { open: [], submit: [] };
        const before = await read();
        await trx.deleteFrom('form_access').where('form_id', '=', formId).execute();
        const rows = [
          ...[...new Set(access.open)].map((role_id) => ({ form_id: formId, role_id, mode: 'open' })),
          ...[...new Set(access.submit)].map((role_id) => ({ form_id: formId, role_id, mode: 'submit' })),
        ];
        if (rows.length > 0) await trx.insertInto('form_access').values(rows).execute();
        return { before, after: await read() };
      });
    },
    async forForms(formIds) {
      const out = new Map<string, FormAccess>();
      const unique = [...new Set(formIds)];
      for (let i = 0; i < unique.length; i += CHUNK) {
        const rows = await db.selectFrom('form_access').select(['form_id', 'role_id', 'mode'])
          .where('form_id', 'in', unique.slice(i, i + CHUNK)).execute();
        for (const [k, v] of collect(rows)) out.set(k, v);
      }
      return out;
    },
    async removeRole(roleId) {
      await db.deleteFrom('form_access').where('role_id', '=', roleId).execute();
    },
  };
}
