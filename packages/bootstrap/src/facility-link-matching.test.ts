import { describe, it, expect } from 'vitest';
import { createFacilityRegisterSourceStore, FACILITY_REGISTRY_SYSTEM } from '@openldr/db';
import { linkMatchingFacilityCodes } from './facility-link-matching';
import { resolveObservedFacilities } from './facility-reconcile';
import { makeReconcileDeps, seedPerformers, seedRegistry, seedMapping } from './test-support/facility-reconcile-fixture';
import type { ReconcileDeps } from './facility-reconcile';

const MZ = 'urn:openldr:register:mz-disa';
const WIRE = 'urn:openldr:default_fac';

async function register(deps: ReconcileDeps, url = MZ, code = 'MZDISA'): Promise<void> {
  await createFacilityRegisterSourceStore(deps.internalDb).create({ url, name: `Register ${code}`, code });
}

async function activeMappings(deps: ReconcileDeps) {
  return deps.internalDb.selectFrom('term_mappings').selectAll().where('is_active', '=', true).execute();
}

describe('linkMatchingFacilityCodes', () => {
  it('refuses an unknown register', async () => {
    const deps = await makeReconcileDeps();
    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });
    expect(out).toMatchObject({ ok: false, reason: 'unknown-register' });
  });

  it('refuses a deactivated register', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await deps.internalDb.updateTable('coding_systems').set({ active: false }).where('url', '=', MZ).execute();
    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });
    expect(out).toMatchObject({ ok: false, reason: 'deactivated-register' });
  });

  it('dry run reports a match and a miss and writes nothing', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN' });
    await seedPerformers(deps, [['MICAN', 5], ['ZZZZZ', 2]], { performerSystem: WIRE });

    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: false });

    if (!out.ok) throw new Error(out.error);
    expect(out.result.applied).toBe(false);
    expect(out.result.counts).toEqual({ linked: 1, 'already-linked': 0, kept: 0, 'no-match': 1 });
    expect(out.result.pairs.map((p) => [p.code, p.outcome])).toEqual([['MICAN', 'linked'], ['ZZZZZ', 'no-match']]);
    expect(await activeMappings(deps)).toHaveLength(0);
  });

  it('apply writes a SAME-AS registry mapping that makes the code resolve', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN', region: 'Nampula', district: 'Nacala' });
    await seedPerformers(deps, [['MICAN', 5]], { performerSystem: WIRE });

    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });

    if (!out.ok) throw new Error(out.error);
    expect(out.result.applied).toBe(true);
    const rows = await activeMappings(deps);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_system: WIRE, from_code: 'MICAN', to_system: FACILITY_REGISTRY_SYSTEM, map_type: 'SAME-AS' });
    const [resolved] = await resolveObservedFacilities(deps);
    expect(resolved).toMatchObject({ registryId: 'fac-mican', name: 'CS Micane', region: 'Nampula', resolvedVia: 'registry' });
  });

  it('does not match on a different case', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN' });
    await seedPerformers(deps, [['mican', 1]], { performerSystem: WIRE });

    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: false });

    if (!out.ok) throw new Error(out.error);
    expect(out.result.counts['no-match']).toBe(1);
  });

  it('keeps a code an operator already mapped elsewhere, and leaves that mapping alone', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN' });
    await seedRegistry(deps, { id: 'fac-other', name: 'Other', localCode: 'OTH' });
    await seedPerformers(deps, [['MICAN', 5]], { performerSystem: WIRE });
    await seedMapping(deps, { fromSystem: WIRE, fromCode: 'MICAN', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'OTH' });

    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });

    if (!out.ok) throw new Error(out.error);
    expect(out.result.counts.kept).toBe(1);
    const rows = await activeMappings(deps);
    expect(rows).toHaveLength(1);
    expect(rows[0].to_code).toBe('OTH');
  });

  it('keeps a code that carries only a non-SAME-AS mapping', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN' });
    await seedPerformers(deps, [['MICAN', 5]], { performerSystem: WIRE });
    await seedMapping(deps, { fromSystem: WIRE, fromCode: 'MICAN', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'MICAN', mapType: 'UNMAPPED-FROM' });

    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });

    if (!out.ok) throw new Error(out.error);
    expect(out.result.counts.kept).toBe(1);
    expect((await activeMappings(deps)).filter((m) => m.map_type === 'SAME-AS')).toHaveLength(0);
  });

  it('reports already-linked and writes no second row on a re-run', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN' });
    await seedPerformers(deps, [['MICAN', 5]], { performerSystem: WIRE });

    await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });
    const second = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });

    if (!second.ok) throw new Error(second.error);
    expect(second.result.counts).toEqual({ linked: 0, 'already-linked': 1, kept: 0, 'no-match': 0 });
    expect(await activeMappings(deps)).toHaveLength(1);
  });

  it('targets the fallback concept code when two registers share a code', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await register(deps, 'urn:openldr:register:other', 'OTHER');
    await seedRegistry(deps, { id: 'fac-mz', name: 'Moz row', nationalSystem: MZ, nationalCode: 'X1' });
    await seedRegistry(deps, { id: 'fac-ot', name: 'Other row', nationalSystem: 'urn:openldr:register:other', nationalCode: 'X1' });
    await seedPerformers(deps, [['X1', 3]], { performerSystem: WIRE });

    await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });

    const [resolved] = await resolveObservedFacilities(deps);
    expect(resolved.registryId).toBe('fac-mz');
  });

  // "writes nothing when a write fails part way" moved to facility-link-matching-live.test.ts:
  // pg-mem does not roll back a transaction on a thrown error, so only real Postgres can prove it.
});
