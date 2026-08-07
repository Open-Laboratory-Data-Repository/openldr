import { type Kysely } from 'kysely';

// `facility_registry` was registered in `reference_change_log`'s ENTITY_TYPES before its serve and
// apply cases existed. Capture ran anyway, so an upgraded install can hold logged rows for it — and
// `sync-serve.ts` turns an upsert with no body resolver into a DELETE instruction. Those rows are
// therefore not merely inert history; they are bogus delete instructions waiting to be served.
//
// ⛔ Deliberately INLINED, not imported from SUSPENDED_REFERENCE_ENTITY_TYPES: a migration is a
// frozen snapshot of what it did when it ran. If that constant later gains or loses a type, this
// migration must keep deleting exactly what it deleted the day it shipped.
const SUSPENDED = 'facility_registry';

export async function up(db: Kysely<unknown>): Promise<void> {
  const anyDb = db as Kysely<any>;
  // DELETE only. Never INSERT into reference_change_log from a migration: `seq` is global and every
  // site's pendingPush baseline is derived from it, so a synthetic row silently re-queues unrelated
  // entities at every lab.
  await anyDb.deleteFrom('reference_change_log').where('entity_type', '=', SUSPENDED).execute();
}

export async function down(): Promise<void> {
  // Irreversible by design: the deleted rows were bogus delete instructions. Recreating them would
  // reintroduce the defect, and their original `seq` values are gone.
}
