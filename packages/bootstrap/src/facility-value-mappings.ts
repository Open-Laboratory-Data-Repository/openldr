import type { MapType, TerminologyAdminStore } from '@openldr/db';
import {
  CONTROLLED_VALUE_SETS, observedFieldSystem, type ControlledField,
} from './facility-controlled-fields';

/**
 * ⛔ ONE map type for EVERY controlled-field value mapping, and it is load-bearing.
 *
 * `resolveControlledFields` (facility-controlled-fields.ts) reads
 * `termMappings.listOutgoing(fromSystem, raw)` and takes the FIRST ACTIVE row — it never looks at
 * `toSystem` or `mapType` at all. `saveExclusive` (packages/db/src/terminology-admin-store.ts:199)
 * scopes its "exactly one active mapping" guarantee BY `(toSystem, mapType)`. So two mappings for
 * the same raw value written under different scopes would BOTH stay active, and resolution would
 * pick between them arbitrarily — a silent wrong value, not an error.
 *
 * Pinning one constant makes the store's exclusivity and the resolver's lookup describe the same
 * set. `'SAME-AS'` because a register's own word for a concept IS that concept; a mapping like
 * `1st Level Hospital -> district-hospital` is arguably `NARROWER-THAN`, but expressing that nuance
 * would cost the exclusivity guarantee, and the resolver discards the nuance anyway.
 */
export const FACILITY_VALUE_MAP_TYPE: MapType = 'SAME-AS';

export interface ValueMappingEntry {
  field: ControlledField;
  /** The source value EXACTLY as the parser produced it — trimmed, since `text()` already trimmed
   *  it (`packages/terminology/src/facility-csv.ts:114`). `resolveControlledFields` looks it up by
   *  exact string, so a differently-spaced copy would never resolve. */
  rawValue: string;
  /** A code from the field's bound value set. */
  toCode: string;
}

export interface SaveValueMappingsResult {
  written: number;
  /** Mapping ids deactivated because they were the previous active mapping for the same value. */
  superseded: string[];
}

/**
 * Write value mappings for one register's controlled fields.
 *
 * Also creates the source coding system and a concept per raw value. `term_mappings` does not
 * require the source concept to exist, so this could be skipped — it must not be. A mapping with no
 * source term is invisible in Settings -> Terminology and therefore uneditable afterwards, which
 * turns a correction into a support call. This mirrors what `termMappings.create` already does for a
 * missing TARGET concept (terminology-admin-store.ts:724).
 */
export async function saveFacilityValueMappings(
  admin: TerminologyAdminStore,
  nationalSystem: string,
  entries: readonly ValueMappingEntry[],
): Promise<SaveValueMappingsResult> {
  // Validate EVERY entry before writing ANY of them: a half-applied mapping set is worse than a
  // refused one, because the operator cannot tell which half landed.
  const expansions = new Map<ControlledField, Map<string, string | null>>();
  for (const entry of entries) {
    if (!expansions.has(entry.field)) {
      const vs = await admin.valueSets.getByUrl(CONTROLLED_VALUE_SETS[entry.field]);
      if (!vs) throw new Error(`no ${entry.field} value set is seeded on this install`);
      const { codes } = await admin.valueSets.expand(vs.id);
      expansions.set(entry.field, new Map(codes.map((c) => [c.code, c.display ?? null])));
    }
    if (!expansions.get(entry.field)!.has(entry.toCode)) {
      throw new Error(
        `${entry.toCode} is not in the ${entry.field} value set — refusing rather than minting a draft concept`,
      );
    }
  }

  const superseded: string[] = [];
  let written = 0;

  for (const entry of entries) {
    const fromSystem = observedFieldSystem(entry.field, nationalSystem);
    const toDisplay = expansions.get(entry.field)!.get(entry.toCode) ?? null;

    await admin.codingSystems.upsertByUrl({
      systemCode: `FAC-${entry.field.toUpperCase()}-OBSERVED`,
      systemName: `Observed facility ${entry.field} values`,
      url: fromSystem,
      systemVersion: null,
      publisherId: 'pub-system',
    });
    // `terms.create` is itself an upsert (`onConflict(['system','code']).doUpdateSet(...)`,
    // terminology-admin-store.ts:640-647) — it never rejects a duplicate code, so re-running a
    // mapping over the same raw value is already idempotent without a try/catch here.
    await admin.terms.create({
      system: fromSystem, code: entry.rawValue, display: entry.rawValue, status: 'ACTIVE',
    });

    const res = await admin.termMappings.saveExclusive({
      fromSystem,
      fromCode: entry.rawValue,
      toSystem: CONTROLLED_VALUE_SETS[entry.field],
      toCode: entry.toCode,
      toDisplay,
      mapType: FACILITY_VALUE_MAP_TYPE,
      isActive: true,
    });
    superseded.push(...res.superseded);
    written += 1;
  }

  return { written, superseded };
}
