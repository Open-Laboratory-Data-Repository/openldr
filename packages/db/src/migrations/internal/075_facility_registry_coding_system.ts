import { type Kysely } from 'kysely';
import { FACILITY_REGISTRY_SYSTEM } from '../../facility-observed';

// `urn:openldr:cs:facility-registry` is CE's OWN structural system — one concept per
// `facility_registry` row, a projection of a CE table, not site data — so (unlike
// `urn:openldr:default_fac`, the OBSERVED facility dictionary; see `facility-observed.ts`'s
// docblock and `packages/terminology/src/loaders/organisms.ts`'s docblock for why THAT one must
// never be seeded) it belongs on every install, empty, from the first migration onward. Before
// this migration it only existed after an operator ran a scan/publish
// (`publishRegistryConcepts`, `packages/bootstrap/src/facility-reconcile.ts`), which left
// `TermMappingDialog`'s target-system dropdown with nothing to pick on a fresh install and no
// indication that pressing "Publish" first was what created it.
//
// `systemCode`/`systemName`/`publisherId` here MUST match what `publishRegistryConcepts` passes
// to `codingSystems.upsertByUrl` exactly, or the two create competing rows: `upsertByUrl` derives
// the row id as `cs-url-${systemCode}` (`terminology-admin-store.ts`), so matching `systemCode`
// is what makes this migration's row and `upsertByUrl`'s row the SAME row.
const SYSTEM_CODE = 'FACILITY-REGISTRY';
const SYSTEM_NAME = 'OpenLDR facility registry';
const PUBLISHER_ID = 'pub-system';

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  // ON CONFLICT (url) DO NOTHING — not an upsert: if `publishRegistryConcepts` already created
  // this row (an upgraded install where an operator ran a scan/publish before applying this
  // migration), leave it exactly as it is, including a deliberate deactivation, rather than
  // fighting with it. A fresh install has no such row, so the insert proceeds and the row is
  // seeded ACTIVE.
  await seedDb.insertInto('coding_systems').values({
    id: `cs-url-${SYSTEM_CODE}`,
    system_code: SYSTEM_CODE,
    system_name: SYSTEM_NAME,
    url: FACILITY_REGISTRY_SYSTEM,
    active: true,
    publisher_id: PUBLISHER_ID,
    seeded: true,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await seedDb.deleteFrom('coding_systems').where('id', '=', `cs-url-${SYSTEM_CODE}`).execute();
}
