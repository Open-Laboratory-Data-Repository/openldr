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
  //
  // ⛔ `toSystem` for a mapping is the CODE'S OWN coding system (e.g.
  // `urn:openldr:cs:facility-type`), never the value-set url that merely bounds valid choices
  // (`urn:openldr:valueset:facility-type`). `terminology_concepts` rows are only ever inserted
  // under the former — migrations 072/073 — so a mapping written with the value-set url as
  // `toSystem` would miss `saveExclusive`'s `(toSystem, toCode)` lookup on every call and mint an
  // orphaned DRAFT concept under a "system" with no `coding_systems` row
  // (terminology-admin-store.ts:724). `admin.valueSets.expand()` already returns each code's
  // system as `ExpandedConcept.system` (`packages/db/src/value-set-expander.ts:4`), so it is
  // captured here rather than re-derived or hardcoded.
  const expansions = new Map<ControlledField, Map<string, { display: string | null; system: string }>>();
  for (const entry of entries) {
    if (!expansions.has(entry.field)) {
      const vs = await admin.valueSets.getByUrl(CONTROLLED_VALUE_SETS[entry.field]);
      if (!vs) throw new Error(`no ${entry.field} value set is seeded on this install`);
      const { codes } = await admin.valueSets.expand(vs.id);
      // ⛔ Fix pass (whole-branch review, M4): keyed by CODE ALONE, safe today only because the
      // three controlled value sets each compose exactly one coding system. Nothing else enforces
      // that — an expansion carrying one code under two DIFFERENT systems would otherwise pick
      // whichever `expand` happened to list last, silently, and could write a mapping under a
      // `toSystem` the operator never chose. This is the one guard standing between that and the
      // pinned `FACILITY_VALUE_MAP_TYPE` invariant this file's own docblock explains: `saveExclusive`
      // scopes its exclusivity by `(toSystem, mapType)`, so two systems for one code silently
      // defeats it.
      const byCode = new Map<string, { display: string | null; system: string }>();
      for (const c of codes) {
        const existing = byCode.get(c.code);
        if (existing && existing.system !== c.system) {
          throw new Error(
            `code "${c.code}" appears under two different systems (${existing.system} and `
            + `${c.system}) in the ${entry.field} value set — refusing rather than guessing which one`,
          );
        }
        byCode.set(c.code, { display: c.display ?? null, system: c.system });
      }
      expansions.set(entry.field, byCode);
    }
    if (!expansions.get(entry.field)!.has(entry.toCode)) {
      throw new Error(
        `${entry.toCode} is not in the ${entry.field} value set — refusing rather than minting a draft concept`,
      );
    }
  }

  const superseded: string[] = [];
  let written = 0;
  // Dedupe per FIELD, mirroring the `expansions.has(...)` guard above: N entries for one field
  // must issue one upsert, not N identical idempotent ones.
  const upsertedSystems = new Set<ControlledField>();

  for (const entry of entries) {
    const fromSystem = observedFieldSystem(entry.field, nationalSystem);
    const target = expansions.get(entry.field)!.get(entry.toCode)!;

    if (!upsertedSystems.has(entry.field)) {
      await admin.codingSystems.upsertByUrl({
        systemCode: `FAC-${entry.field.toUpperCase()}-OBSERVED`,
        systemName: `Observed facility ${entry.field} values`,
        url: fromSystem,
        systemVersion: null,
        publisherId: 'pub-system',
      });
      upsertedSystems.add(entry.field);
    }
    // `terms.create` is itself an upsert (`onConflict(['system','code']).doUpdateSet(...)`,
    // terminology-admin-store.ts:640-647) — it never rejects a duplicate code, so re-running a
    // mapping over the same raw value is already idempotent without a try/catch here.
    await admin.terms.create({
      system: fromSystem, code: entry.rawValue, display: entry.rawValue, status: 'ACTIVE',
    });

    const res = await admin.termMappings.saveExclusive({
      fromSystem,
      fromCode: entry.rawValue,
      toSystem: target.system,
      toCode: entry.toCode,
      toDisplay: target.display,
      mapType: FACILITY_VALUE_MAP_TYPE,
      isActive: true,
    });
    superseded.push(...res.superseded);
    written += 1;
  }

  return { written, superseded };
}
