import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { FieldDiscriminator, FieldType } from './schema/form-schema';
import type { SeededStarterPack, StarterPack, StarterPackEntry, StarterPackWithEntries } from './starter-pack';

/**
 * The only file that knows the starter pack tables' column names. Everything else speaks
 * `StarterPack`. Read-only apart from `replaceSeeded`, which boot calls. Ported from corlix
 * `apps/desktop/src/main/starter-packs.ts`.
 */

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function toTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

interface PackRow {
  id: string;
  resource_type: string;
  name: string;
  version: string;
  seeded: boolean;
  created_at: unknown;
  updated_at: unknown;
}

interface EntryRow {
  ord: number;
  fhir_path: string | null;
  label: string;
  api_property: string | null;
  field_type: string | null;
  fhir_value_field: string | null;
  required: boolean;
  locked: boolean;
  default_on: boolean;
  discriminator: unknown;
  bound_value_set: string | null;
  reference_target: string | null;
  reference_multiple: boolean;
  rationale: string;
}

function toPack(r: PackRow): StarterPack {
  return {
    id: r.id,
    resourceType: r.resource_type,
    name: r.name,
    version: r.version,
    seeded: r.seeded,
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
  };
}

function toEntry(r: EntryRow): StarterPackEntry {
  const entry: StarterPackEntry = {
    ord: r.ord,
    fhirPath: r.fhir_path,
    label: r.label,
    apiProperty: r.api_property,
    fieldType: r.field_type as FieldType | null,
    fhirValueField: r.fhir_value_field,
    required: r.required,
    locked: r.locked,
    defaultOn: r.default_on,
    boundValueSet: r.bound_value_set,
    referenceTarget: r.reference_target,
    referenceMultiple: r.reference_multiple,
    rationale: r.rationale,
  };
  const discriminator = parseJson(r.discriminator);
  if (discriminator) entry.discriminator = discriminator as FieldDiscriminator;
  return entry;
}

export function createStarterPackStore(db: Kysely<InternalSchema>) {
  return {
    /** The packs for one resource type, by name. Empty when the type has none, which is a real answer. */
    async listForResource(resourceType: string): Promise<StarterPack[]> {
      const rows = await db.selectFrom('starter_packs').selectAll().where('resource_type', '=', resourceType).orderBy('name').execute();
      return rows.map(toPack);
    },

    /** One pack with its entries in pack order, or null for an unknown id. */
    async get(id: string): Promise<StarterPackWithEntries | null> {
      const row = await db.selectFrom('starter_packs').selectAll().where('id', '=', id).executeTakeFirst();
      if (!row) return null;
      const entries = await db.selectFrom('starter_pack_entries').selectAll().where('pack_id', '=', id).orderBy('ord').execute();
      return { ...toPack(row), entries: entries.map(toEntry) };
    },

    /**
     * Make the seeded packs exactly `packs`: each is written with its entries, and a seeded pack no
     * longer listed goes. One transaction, so no pack is left half-written. Boot calls this on every
     * start, so `updated_at` says when the pack was last written.
     */
    async replaceSeeded(packs: readonly SeededStarterPack[]): Promise<void> {
      const ids = new Set(packs.map((p) => p.id));
      await db.transaction().execute(async (trx) => {
        const seeded = await trx.selectFrom('starter_packs').select('id').where('seeded', '=', true).execute();
        for (const { id } of seeded) {
          if (ids.has(id)) continue;
          await trx.deleteFrom('starter_pack_entries').where('pack_id', '=', id).execute();
          await trx.deleteFrom('starter_packs').where('id', '=', id).execute();
        }
        for (const pack of packs) {
          await trx
            .insertInto('starter_packs')
            .values({ id: pack.id, resource_type: pack.resourceType, name: pack.name, version: pack.version, seeded: true })
            .onConflict((oc) =>
              oc.column('id').doUpdateSet({
                resource_type: pack.resourceType,
                name: pack.name,
                version: pack.version,
                seeded: true,
                updated_at: sql`now()`,
              }),
            )
            .execute();
          await trx.deleteFrom('starter_pack_entries').where('pack_id', '=', pack.id).execute();
          if (pack.entries.length === 0) continue;
          await trx
            .insertInto('starter_pack_entries')
            .values(
              pack.entries.map((e) => ({
                pack_id: pack.id,
                ord: e.ord,
                fhir_path: e.fhirPath,
                label: e.label,
                api_property: e.apiProperty,
                field_type: e.fieldType,
                fhir_value_field: e.fhirValueField,
                required: e.required,
                locked: e.locked,
                default_on: e.defaultOn,
                discriminator: e.discriminator ? (JSON.stringify(e.discriminator) as never) : null,
                bound_value_set: e.boundValueSet,
                reference_target: e.referenceTarget,
                reference_multiple: e.referenceMultiple,
                rationale: e.rationale,
              })),
            )
            .execute();
        }
      });
    },
  };
}

export type StarterPackStore = ReturnType<typeof createStarterPackStore>;
