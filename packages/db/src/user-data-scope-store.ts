import type { Kysely, Transaction } from 'kysely';
import type { DataScope, ScopeDistrict } from '@openldr/rbac';

export type { DataScope, ScopeDistrict } from '@openldr/rbac';
import type { InternalSchema } from './schema/internal';

/** A user's data limit, by role subject (design 2026-11-18-roles-scope, part 3). */
export interface UserDataScopeStore {
  /** No row is Everything. */
  get(subject: string): Promise<DataScope>;
  /** Replaces the limit, and returns it as it was and as it is now, both read under the lock the
   *  save holds, so another save cannot slip between them (roles part 1 review FR5, FR10). */
  set(subject: string, scope: DataScope): Promise<{ before: DataScope; after: DataScope }>;
}

type Db = Kysely<InternalSchema> | Transaction<InternalSchema>;

async function read(db: Db, subject: string): Promise<DataScope> {
  const head = await db.selectFrom('user_data_scopes').select('limited').where('subject', '=', subject).executeTakeFirst();
  if (!head?.limited) return { limited: false };
  const items = await db.selectFrom('user_data_scope_items').select(['kind', 'region', 'value'])
    .where('subject', '=', subject).execute();
  const facilities = items.filter((i) => i.kind === 'facility').map((i) => i.value).sort();
  const regions = items.filter((i) => i.kind === 'region').map((i) => i.value).sort();
  const districts: ScopeDistrict[] = items.filter((i) => i.kind === 'district')
    .map((i) => ({ region: i.region, district: i.value }))
    .sort((a, b) => a.region.localeCompare(b.region) || a.district.localeCompare(b.district));
  return { limited: true, facilities, districts, regions };
}

export function createUserDataScopeStore(db: Kysely<InternalSchema>): UserDataScopeStore {
  return {
    get: (subject) => read(db, subject),
    async set(subject, scope) {
      return db.transaction().execute(async (trx) => {
        // Saves for one user take turns on their row. The row is made first so there is one to lock.
        await trx.insertInto('user_data_scopes').values({ subject }).onConflict((oc) => oc.column('subject').doNothing()).execute();
        await trx.selectFrom('user_data_scopes').select('subject').where('subject', '=', subject).forUpdate().execute();
        const before = await read(trx, subject);
        await trx.deleteFrom('user_data_scope_items').where('subject', '=', subject).execute();
        if (!scope.limited) {
          await trx.deleteFrom('user_data_scopes').where('subject', '=', subject).execute();
          return { before, after: await read(trx, subject) };
        }
        await trx.updateTable('user_data_scopes').set({ limited: true, updated_at: new Date() }).where('subject', '=', subject).execute();
        const rows = new Map<string, { subject: string; kind: string; region: string; value: string }>();
        const add = (kind: string, region: string, value: string) => rows.set(JSON.stringify([kind, region, value]), { subject, kind, region, value });
        for (const f of scope.facilities) add('facility', '', f);
        for (const r of scope.regions) add('region', '', r);
        for (const d of scope.districts) add('district', d.region, d.district);
        if (rows.size > 0) await trx.insertInto('user_data_scope_items').values([...rows.values()]).execute();
        return { before, after: await read(trx, subject) };
      });
    },
  };
}
