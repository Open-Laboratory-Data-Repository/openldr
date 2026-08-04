import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';
import type { ReferenceCapture } from './reference-capture';

/** A curated facility. camelCase; the store translates to/from the snake_case row. */
export interface FacilityRecord {
  id: string;
  /** OURS — required at data entry, absent on a nationally-imported row. */
  localCode?: string | null;
  nationalSystem?: string | null;
  /** THEIRS — the only code an imported row carries. */
  nationalCode?: string | null;
  name: string;
  level?: string | null;
  ownership?: string | null;
  status?: string | null;
  country?: string | null;
  zone?: string | null;
  region?: string | null;
  district?: string | null;
  council?: string | null;
  ward?: string | null;
  village?: string | null;
  addressText?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Fields a form added beyond the core — extend without a migration (the Users pattern). */
  extras?: Record<string, unknown>;
  /** NULL = lab-local, 'central' = central-managed and replaceable by down-sync. */
  managedOrigin?: string | null;
  source: 'manual' | 'import';
}

export interface FacilityAlias {
  sourceSystem: string;
  sourceCode: string;
  registryId: string;
  createdBy?: string | null;
}

export interface FacilityListOptions {
  region?: string;
  district?: string;
  council?: string;
  status?: string;
  limit?: number;
}

export interface FacilityRegistryStore {
  get(id: string): Promise<FacilityRecord | undefined>;
  list(opts?: FacilityListOptions): Promise<FacilityRecord[]>;
  upsert(rec: FacilityRecord): Promise<FacilityRecord>;
  remove(id: string): Promise<void>;
  /** Attach an observed feed code to a facility. Idempotent; re-points if already attached elsewhere. */
  attachAlias(alias: FacilityAlias): Promise<void>;
  detachAlias(sourceSystem: string, sourceCode: string): Promise<void>;
  /** What facility did this feed's code mean? `undefined` when nothing has been attached yet. */
  resolve(sourceSystem: string, sourceCode: string): Promise<FacilityRecord | undefined>;
  listAliases(registryId: string): Promise<FacilityAlias[]>;
}

type Row = InternalSchema['facility_registry'];

function toRecord(r: Row): FacilityRecord {
  return {
    id: r.id,
    localCode: r.local_code,
    nationalSystem: r.national_system,
    nationalCode: r.national_code,
    name: r.name,
    level: r.level,
    ownership: r.ownership,
    status: r.status,
    country: r.country,
    zone: r.zone,
    region: r.region,
    district: r.district,
    council: r.council,
    ward: r.ward,
    village: r.village,
    addressText: r.address_text,
    phone: r.phone,
    latitude: r.latitude,
    longitude: r.longitude,
    extras: (r.extras ?? {}) as Record<string, unknown>,
    managedOrigin: r.managed_origin,
    source: r.source as 'manual' | 'import',
  };
}

function toRow(rec: FacilityRecord): Omit<Row, 'created_at' | 'updated_at'> {
  return {
    id: rec.id,
    local_code: rec.localCode ?? null,
    national_system: rec.nationalSystem ?? null,
    national_code: rec.nationalCode ?? null,
    name: rec.name,
    level: rec.level ?? null,
    ownership: rec.ownership ?? null,
    status: rec.status ?? null,
    country: rec.country ?? null,
    zone: rec.zone ?? null,
    region: rec.region ?? null,
    district: rec.district ?? null,
    council: rec.council ?? null,
    ward: rec.ward ?? null,
    village: rec.village ?? null,
    address_text: rec.addressText ?? null,
    phone: rec.phone ?? null,
    latitude: rec.latitude ?? null,
    longitude: rec.longitude ?? null,
    extras: rec.extras ?? {},
    managed_origin: rec.managedOrigin ?? null,
    source: rec.source,
  };
}

/** Hash the STORED record, not the input, so the captured hash reflects what is served. */
function hashOf(rec: FacilityRecord): string {
  return createHash('sha256').update(JSON.stringify(rec)).digest('hex');
}

export function createFacilityRegistryStore(
  db: Kysely<InternalSchema>,
  capture?: ReferenceCapture,
): FacilityRegistryStore {
  return {
    async get(id) {
      const r = await db.selectFrom('facility_registry').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? toRecord(r as Row) : undefined;
    },

    async list(opts = {}) {
      let q = db.selectFrom('facility_registry').selectAll();
      if (opts.region) q = q.where('region', '=', opts.region);
      if (opts.district) q = q.where('district', '=', opts.district);
      if (opts.council) q = q.where('council', '=', opts.council);
      if (opts.status) q = q.where('status', '=', opts.status);
      q = q.orderBy('name', 'asc');
      if (opts.limit) q = q.limit(opts.limit);
      return (await q.execute()).map((r) => toRecord(r as Row));
    },

    async upsert(rec) {
      const row = toRow(rec);
      return db.transaction().execute(async (trx) => {
        await trx
          .insertInto('facility_registry')
          .values(row as never)
          .onConflict((oc) => oc.column('id').doUpdateSet({ ...row, updated_at: new Date().toISOString() } as never))
          .execute();
        const stored = toRecord(
          (await trx.selectFrom('facility_registry').selectAll().where('id', '=', rec.id).executeTakeFirstOrThrow()) as Row,
        );
        if (capture) await capture.record(trx, 'facility_registry', rec.id, 'upsert', hashOf(stored));
        return stored;
      });
    },

    async remove(id) {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('facility_registry').where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'facility_registry', id, 'delete', null);
      });
    },

    // ⚠ Alias writes are NOT captured. An alias maps ONE lab's feed codes to a facility; it is
    // meaningless at central and actively wrong at another lab whose identical code means something
    // else. Registry syncs down; aliases stay local.
    async attachAlias(alias) {
      await db
        .insertInto('facility_aliases')
        .values({
          source_system: alias.sourceSystem,
          source_code: alias.sourceCode,
          registry_id: alias.registryId,
          created_by: alias.createdBy ?? null,
        } as never)
        .onConflict((oc) =>
          oc.columns(['source_system', 'source_code']).doUpdateSet({ registry_id: alias.registryId } as never),
        )
        .execute();
    },

    async detachAlias(sourceSystem, sourceCode) {
      await db
        .deleteFrom('facility_aliases')
        .where('source_system', '=', sourceSystem)
        .where('source_code', '=', sourceCode)
        .execute();
    },

    async resolve(sourceSystem, sourceCode) {
      const r = await db
        .selectFrom('facility_aliases')
        .innerJoin('facility_registry', 'facility_registry.id', 'facility_aliases.registry_id')
        .selectAll('facility_registry')
        .where('facility_aliases.source_system', '=', sourceSystem)
        .where('facility_aliases.source_code', '=', sourceCode)
        .executeTakeFirst();
      return r ? toRecord(r as Row) : undefined;
    },

    async listAliases(registryId) {
      const rows = await db
        .selectFrom('facility_aliases')
        .selectAll()
        .where('registry_id', '=', registryId)
        .orderBy('source_system', 'asc')
        .execute();
      return rows.map((r) => ({
        sourceSystem: r.source_system,
        sourceCode: r.source_code,
        registryId: r.registry_id,
        createdBy: r.created_by,
      }));
    },
  };
}
