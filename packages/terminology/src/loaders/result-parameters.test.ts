import { describe, it, expect, vi } from 'vitest';
import { importResultParameters, RESULT_PARAM_SYSTEM } from './result-parameters';

const store = () => ({
  upsertConcepts: vi.fn().mockResolvedValue(undefined),
  upsertMapElements: vi.fn().mockResolvedValue(undefined),
  saveResource: vi.fn().mockResolvedValue({ resourceType: 'CodeSystem', id: 'x' }),
  saveSystem: vi.fn().mockResolvedValue(undefined),
  markSystemChanged: vi.fn().mockResolvedValue(undefined),
});

describe('importResultParameters', () => {
  it('projects each row to a concept carrying result_role and the source properties', async () => {
    const s = store();
    const r = await importResultParameters([
      { code: 'CD4', description: 'CD4 Count', context: -1, units: 'cells/uL', reference: '', result_role: 'result' },
      { code: 'COLBY', description: 'Collected By', context: -1, result_role: 'metadata' },
    ], s);
    expect(r.conceptsLoaded).toBe(2);
    expect(r.byRole).toEqual({ result: 1, metadata: 1 });
    expect(s.upsertConcepts).toHaveBeenCalledTimes(1);
    expect(s.upsertConcepts.mock.calls[0][0][0]).toEqual({
      system: RESULT_PARAM_SYSTEM, code: 'CD4', display: 'CD4 Count', status: null,
      properties: { result_role: 'result', parm_context: -1, parm_units: 'cells/uL' },
    });
  });

  it('omits absent source properties rather than storing nulls', async () => {
    const s = store();
    await importResultParameters([{ code: 'X', description: 'X', result_role: 'admin' }], s);
    expect(s.upsertConcepts.mock.calls[0][0][0].properties).toEqual({ result_role: 'admin' });
  });

  it('records the reference citation, which is NOT a range', async () => {
    const s = store();
    await importResultParameters(
      [{ code: 'SAST', description: 'AST', reference: 'Roche Reference Ranges for Adults and Children', result_role: 'result' }], s);
    expect(s.upsertConcepts.mock.calls[0][0][0].properties.reference_citation)
      .toBe('Roche Reference Ranges for Adults and Children');
  });

  it('THROWS on an unrecognised role rather than skipping it', async () => {
    await expect(importResultParameters([{ code: 'X', result_role: 'wat' }], store()))
      .rejects.toThrow(/unrecognised result_role/);
  });

  it('THROWS on a row with no result_role, so nothing is silently unclassified by import', async () => {
    await expect(importResultParameters([{ code: 'X', description: 'X' }], store()))
      .rejects.toThrow(/unrecognised result_role/);
  });

  it('skips a header-ish row with an empty code and reports the count', async () => {
    const s = store();
    const r = await importResultParameters([
      { code: '', description: 'Parameters' },
      { code: 'CD4', description: 'CD4 Count', result_role: 'result' },
    ], s);
    expect(r.skipped).toBe(1);
    expect(r.conceptsLoaded).toBe(1);
  });

  it('signals the system ONCE, after the concepts land', async () => {
    const s = store();
    await importResultParameters([{ code: 'A', result_role: 'result' }, { code: 'B', result_role: 'result' }], s);
    expect(s.markSystemChanged).toHaveBeenCalledTimes(1);
    expect(s.markSystemChanged).toHaveBeenCalledWith(RESULT_PARAM_SYSTEM);
  });

  it('rejects a non-array payload', async () => {
    await expect(importResultParameters({ nope: true }, store())).rejects.toThrow();
  });
});
