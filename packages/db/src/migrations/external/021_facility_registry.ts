import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, floatType, timestampType, nowExpr } from './dialect';

// A copy of the internal `facility_registry`: every register, every row, every register_state.
// The Query page and custom queries reach only the warehouse, so without this copy no query can
// list a register. `publishFacilityMap` deletes and rewrites it in the same transaction as
// `facility_map`. Spec: docs/superpowers/specs/2026-10-07-warehouse-facility-registry-design.md.
//
// Same name as the internal table on purpose: it is the same data, in a different database.
// `extras` is JSON text, because SQL Server and MySQL have no jsonb.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  const float = sql.raw(floatType(engine));
  let built = db.schema.createTable('facility_registry')
    .addColumn('id', key, (c) => c.primaryKey())
    // NULL for a facility in no register, as in the internal table (migration 086).
    .addColumn('facility_system', key)
    .addColumn('facility_code', key, (c) => c.notNull())
    .addColumn('name', text, (c) => c.notNull())
    .addColumn('level', text)
    .addColumn('ownership', text)
    .addColumn('status', text)
    .addColumn('register_state', text)
    .addColumn('country', text)
    .addColumn('zone', text)
    .addColumn('region', text)
    .addColumn('district', text)
    .addColumn('council', text)
    .addColumn('ward', text)
    .addColumn('village', text)
    .addColumn('address_text', text)
    .addColumn('phone', text)
    .addColumn('latitude', float)
    .addColumn('longitude', float)
    .addColumn('extras', text)
    .addColumn('updated_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  // Facility names carry diacritics, and a self-hosted MySQL may default to latin1 (see 012).
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  await built.execute();
  // Every lookup filters on the register and the code together.
  await db.schema.createIndex('facility_registry_code_idx')
    .on('facility_registry').columns(['facility_system', 'facility_code']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('facility_registry').execute();
}
