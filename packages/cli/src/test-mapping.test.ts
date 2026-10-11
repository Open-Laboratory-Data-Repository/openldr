import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const testMapping = {
  observed: vi.fn(), set: vi.fn(), clear: vi.fn(), exportCsv: vi.fn(),
  importPreview: vi.fn(), importApply: vi.fn(), publish: vi.fn(), rebuildNow: vi.fn(),
};
const audit: unknown[] = [];
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
vi.mock('@openldr/bootstrap', async (orig) => {
  const actual = await orig<typeof import('@openldr/bootstrap')>();
  return {
    ...actual,
    createAppContext: async () => ({ testMapping, close: async () => {} }),
    recordAuditEvent: async (_ctx: unknown, _actor: unknown, e: unknown) => { audit.push(e); },
  };
});

import { runTestMappingClear, runTestMappingImport, runTestMappingList, runTestMappingRebuild, runTestMappingSet } from './test-mapping';

const DISA = 'urn:openldr:disa';
const REBUILT = { ok: true, result: { mapped: 1, ambiguous: [], targetMissing: [], written: 1 } };

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
  return { out: () => out.join(''), err: () => err.join('') };
}

beforeEach(() => { vi.restoreAllMocks(); audit.length = 0; for (const f of Object.values(testMapping)) f.mockReset(); });

describe('openldr test-catalog map', () => {
  it('list refuses a bad status in the route parser\'s words', async () => {
    const io = capture();
    expect(await runTestMappingList({ status: 'gone', json: false })).toBe(1);
    expect(io.err()).toContain('status must be unmapped, mapped, ambiguous or all');
    expect(testMapping.observed).not.toHaveBeenCalled();
  });

  it('list prints one line per code', async () => {
    testMapping.observed.mockResolvedValue({ rows: [{ system: DISA, code: 'HIVVL', description: null, requests: 2, lastSeen: null, status: 'mapped', catalog: { code: 'VL', name: 'HIV viral load', loinc: '25836-8' }, centralManaged: false }], total: 1, warehouse: { stale: false, error: null } });
    const io = capture();
    expect(await runTestMappingList({ json: false })).toBe(0);
    expect(io.out()).toContain(`${DISA}  HIVVL  2  mapped  VL HIV viral load (LOINC 25836-8)`);
  });

  it('set writes, audits as cli, and prints the change', async () => {
    testMapping.set.mockResolvedValue({ system: DISA, code: 'HIVVL', before: null, after: 'VL', rebuild: REBUILT });
    const io = capture();
    expect(await runTestMappingSet(DISA, 'HIVVL', 'VL', { json: false })).toBe(0);
    expect(io.out()).toContain('HIVVL now maps to VL.');
    expect(audit).toMatchObject([{ action: 'test_mapping.set', before: { catalogCode: null }, after: { catalogCode: 'VL' } }]);
  });

  it('set says when the warehouse copy could not be rebuilt, and still exits 0', async () => {
    testMapping.set.mockResolvedValue({ system: DISA, code: 'HIVVL', before: null, after: 'VL', rebuild: { ok: false, error: 'boom' } });
    const io = capture();
    expect(await runTestMappingSet(DISA, 'HIVVL', 'VL', { json: false })).toBe(0);
    expect(io.err()).toContain('the warehouse copy test_map is out of date: boom. Run openldr test-catalog map rebuild --apply.');
  });

  it('clear refuses without --force and writes nothing', async () => {
    const io = capture();
    expect(await runTestMappingClear(DISA, 'HIVVL', { force: false, json: false })).toBe(1);
    expect(io.err()).toContain('pass --force');
    expect(testMapping.clear).not.toHaveBeenCalled();
  });

  it('import previews unless --apply, and --apply needs --force', async () => {
    testMapping.importPreview.mockResolvedValue({ counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [], rebuild: null });
    const dir = mkdtempSync(join(tmpdir(), 'test-mapping-cli-'));
    const file = join(dir, 'mappings.csv');
    writeFileSync(file, `system,code,catalog_code\n${DISA},HIVVL,VL\n`, 'utf8');
    const io = capture();
    expect(await runTestMappingImport(file, { apply: false, force: false, json: false })).toBe(0);
    expect(io.out()).toContain('would map 1 new, change 0, leave 0 unchanged, refuse 0');
    expect(await runTestMappingImport(file, { apply: true, force: false, json: false })).toBe(1);
    expect(testMapping.importApply).not.toHaveBeenCalled();
  });

  it('rebuild without --apply is a dry run', async () => {
    testMapping.publish.mockResolvedValue({ mapped: 3, ambiguous: [{ system: DISA, code: 'X', catalogCodes: ['A', 'B'] }], targetMissing: [], written: 3 });
    const io = capture();
    expect(await runTestMappingRebuild({ apply: false, json: false })).toBe(0);
    expect(testMapping.publish).toHaveBeenCalledWith({ apply: false });
    expect(io.out()).toContain('would write 3 row(s); 1 ambiguous, 0 with a missing catalog test');
    expect(io.out()).toContain(`  ambiguous ${DISA} X: A, B`);
  });
});
