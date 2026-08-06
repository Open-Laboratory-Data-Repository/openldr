import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// The CDR toolchain now sends an `Organization` per testing facility alongside the report
// (`facility-reconcile.md`/branch brief), carrying an `address[0]` the projection previously
// discarded entirely (`relational/facility.ts`'s `projectFacility` never read `address`). Measured
// against the real source (`LOCNDIC4`): there is NO city field. `Address.state` holds the region
// (e.g. "Dar es Salaam", "Tanga") and `Address.district` the district (e.g. "Ilala", "Kinondoni") —
// `line`/`city`/`postalCode`/`country` are never sent, so only these two columns are added.
//
// Column names deliberately match `facility_registry`'s own `region`/`district` vocabulary (see
// migration 070) even though the FHIR field is named `state` — the Observed tab already renders
// "region"/"district" for a MAPPED row (from `facility_registry`), and reusing that vocabulary here
// keeps one language across the UI for an UNMAPPED row's location too, rather than introducing a
// second `state` column meaning the same thing under a different name. `council` is deliberately NOT
// added: `facility_registry.council` is a curated field the CDR source never supplies (measured: no
// third admin-area part on the wire), and an always-null column would be speculative surface.
//
// Both `textType`, neither a key — free text copied off the wire, never a join predicate (the join
// predicate is `facilities.facility_code`, unaffected by this migration).
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  await db.schema.alterTable('facilities').addColumn('region', text).execute();
  await db.schema.alterTable('facilities').addColumn('district', text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('facilities').dropColumn('region').execute();
  await db.schema.alterTable('facilities').dropColumn('district').execute();
}
