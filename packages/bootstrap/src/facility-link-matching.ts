import { createFacilityRegisterSourceStore, FACILITY_REGISTRY_SYSTEM, resolveFacilityRegisterForImport } from '@openldr/db';
import { registryConceptCodeById, resolveObservedFacilities, type ReconcileDeps } from './facility-reconcile';

// Links each observed facility code to the row in ONE register that carries exactly the same code.
// It writes the same SAME-AS registry mapping an operator writes by hand in the Observed tab, through
// the same writer, so resolution, the Observed tab, sync and audit all work unchanged. It never
// touches a code that already has any active mapping: that is a person's decision.
//
// Built for a register keyed on the feed's own codes (Mozambique's v1 dictionary is keyed on DISA
// facility codes). Spec: docs/superpowers/specs/2026-09-28-v1-facility-dictionary-design.md.

export type LinkOutcome = 'linked' | 'already-linked' | 'kept' | 'no-match';

export interface LinkMatchingPair {
  observedSystem: string;
  code: string;
  sourceDisplay: string | null;
  reportCount: number;
  /** The register row the code matched. Null for `no-match`, and for `kept` with no match. */
  registryId: string | null;
  name: string | null;
  outcome: LinkOutcome;
}

export interface LinkMatchingResult {
  registerUrl: string;
  applied: boolean;
  counts: Record<LinkOutcome, number>;
  /** Sorted by reportCount descending, then code ascending. */
  pairs: LinkMatchingPair[];
}

export type LinkMatchingOutcome =
  | { ok: true; result: LinkMatchingResult }
  | { ok: false; reason: 'unknown-register' | 'deactivated-register'; error: string };

export async function linkMatchingFacilityCodes(
  deps: ReconcileDeps,
  opts: { registerUrl: string; apply: boolean },
): Promise<LinkMatchingOutcome> {
  // The same gate, and the same two messages, as every import door.
  const gate = await resolveFacilityRegisterForImport(createFacilityRegisterSourceStore(deps.internalDb), opts.registerUrl);
  if (!gate.ok) return { ok: false, reason: gate.reason, error: gate.error };

  const observed = await resolveObservedFacilities(deps);

  // The WHOLE registry, not just this register: a code two registers share projects as each row's id,
  // and only a full view can see that collision (see `registryConceptCodeById`).
  const registry = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'name', 'facility_code', 'facility_system'])
    .execute();
  const codeById = registryConceptCodeById(registry);
  const inRegister = new Map<string, { id: string; name: string }>();
  for (const r of registry) {
    if (r.facility_system === opts.registerUrl && r.facility_code !== null) inRegister.set(r.facility_code, r);
  }

  // ANY active mapping, of any map type. A non-SAME-AS row never resolves, but it is still an
  // operator's recorded decision and must not be overridden.
  const systems = [...new Set(observed.map((o) => o.observedSystem))];
  const mapped = new Set<string>();
  if (systems.length > 0) {
    const rows = await deps.internalDb
      .selectFrom('term_mappings')
      .select(['from_system', 'from_code'])
      .where('from_system', 'in', systems)
      .where('is_active', '=', true)
      .execute();
    for (const r of rows) mapped.add(`${r.from_system}\n${r.from_code}`);
  }

  const counts: Record<LinkOutcome, number> = { linked: 0, 'already-linked': 0, kept: 0, 'no-match': 0 };
  const pairs: LinkMatchingPair[] = observed.map((o) => {
    const match = inRegister.get(o.sourceCode) ?? null;
    let outcome: LinkOutcome;
    if (match && o.registryId === match.id) outcome = 'already-linked';
    else if (mapped.has(`${o.observedSystem}\n${o.sourceCode}`)) outcome = 'kept';
    else if (!match) outcome = 'no-match';
    else outcome = 'linked';
    counts[outcome] += 1;
    return {
      observedSystem: o.observedSystem,
      code: o.sourceCode,
      sourceDisplay: o.sourceDisplay,
      reportCount: o.reportCount,
      registryId: match?.id ?? null,
      name: match?.name ?? null,
      outcome,
    };
  });
  pairs.sort((a, b) => b.reportCount - a.reportCount || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const toLink = pairs.filter((p) => p.outcome === 'linked');
  if (opts.apply && toLink.length > 0) {
    // One transaction: every row lands or none does.
    await deps.internalDb.transaction().execute(async (trx) => {
      for (const p of toLink) {
        await deps.admin.termMappings.saveExclusive({
          fromSystem: p.observedSystem,
          fromCode: p.code,
          toSystem: FACILITY_REGISTRY_SYSTEM,
          toCode: codeById.get(p.registryId!)!,
          toDisplay: p.name,
          mapType: 'SAME-AS',
          isActive: true,
        }, { trx });
      }
    });
  }

  return { ok: true, result: { registerUrl: opts.registerUrl, applied: opts.apply, counts, pairs } };
}
