import { describe, it, expect, vi } from 'vitest';
import { LOINC_SYSTEM, RESULT_PARAM_SYSTEM } from '@openldr/terminology';
import { createResultFields, parseResultFieldQuery, type ResultFieldQuery } from './result-fields';
import { buildMapping, seedParam } from './test-support/test-mapping-fixture';

const Q: ResultFieldQuery = { q: '', loinc: 'all', role: null, limit: 25, offset: 0 };
const csv = (text: string) => new TextEncoder().encode(text);

async function build() {
  const base = await buildMapping();
  const onChanged = vi.fn();
  const fields = createResultFields({ db: base.internalDb, admin: base.admin, onChanged });
  return { ...base, fields, onChanged };
}

async function activeLinks(admin: Awaited<ReturnType<typeof build>>['admin'], code: string): Promise<string[]> {
  return (await admin.termMappings.listOutgoing(RESULT_PARAM_SYSTEM, code))
    .filter((m) => m.isActive && m.toSystem === LOINC_SYSTEM).map((m) => m.toCode);
}

describe('result fields', () => {
  it('lists fields with role, units and LOINC, sorted by code', async () => {
    const { internalDb, fields } = await build();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { units: 'copies/mL', loinc: '20447-9' });
    await seedParam(internalDb, 'AGE', 'Age', { role: 'metadata' });
    expect(await fields.list(Q)).toEqual({
      rows: [
        { code: 'AGE', display: 'Age', role: 'metadata', units: null, loinc: null },
        { code: 'VLC', display: 'HIV VL copies', role: 'result', units: 'copies/mL', loinc: '20447-9' },
      ],
      total: 2, ownedHere: true, loaded: true,
    });
  });

  it('filters by LOINC, role and search, and pages', async () => {
    const { internalDb, fields } = await build();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedParam(internalDb, 'AGE', 'Age', { role: 'metadata' });
    const codes = async (q: Partial<typeof Q>) => (await fields.list({ ...Q, ...q })).rows.map((r) => r.code);
    expect(await codes({ loinc: 'linked' })).toEqual(['VLC']);
    expect(await codes({ loinc: 'none' })).toEqual(['AGE']);
    expect(await codes({ role: 'metadata' })).toEqual(['AGE']);
    expect(await codes({ q: 'copies' })).toEqual(['VLC']);
    expect(await codes({ q: '20447' })).toEqual(['VLC']);
    const page = await fields.list({ ...Q, limit: 1, offset: 1 });
    expect([page.total, page.rows.map((r) => r.code)]).toEqual([2, ['VLC']]);
  });

  // Review focus 2.
  it('says when no dictionary is loaded', async () => {
    const { fields } = await build();
    expect(await fields.list(Q)).toEqual({ rows: [], total: 0, ownedHere: true, loaded: false });
  });

  it('links, relinks and unlinks, calling onChanged each time', async () => {
    const { internalDb, admin, fields, onChanged } = await build();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');

    expect(await fields.link('VLC', '20447-9')).toEqual({ code: 'VLC', before: null, after: '20447-9' });
    expect(await fields.link('VLC', '25836-8')).toEqual({ code: 'VLC', before: '20447-9', after: '25836-8' });
    expect(await activeLinks(admin, 'VLC')).toEqual(['25836-8']);
    expect(await fields.unlink('VLC')).toEqual({ code: 'VLC', before: '25836-8', after: null });
    expect(await activeLinks(admin, 'VLC')).toEqual([]);
    expect(onChanged).toHaveBeenCalledTimes(3);
    await expect(fields.unlink('VLC')).rejects.toMatchObject({ kind: 'not-found', message: 'VLC has no LOINC link' });
  });

  it('refuses an unknown field and a malformed LOINC code', async () => {
    const { internalDb, fields } = await build();
    await expect(fields.link('NOPE', '20447-9')).rejects.toMatchObject({ kind: 'not-found', message: 'no result field has code NOPE' });
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await expect(fields.link('VLC', 'abc')).rejects.toMatchObject({ kind: 'invalid', message: '"abc" is not a LOINC code. LOINC codes look like 12345-6.' });
  });

  it('refuses every change when the dictionary came from central', async () => {
    const { internalDb, fields } = await build();
    await internalDb.insertInto('terminology_systems').values({
      url: RESULT_PARAM_SYSTEM, version: null, kind: 'CodeSystem', resource_id: 'cs-params', managed_origin: 'central',
    }).execute();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    expect((await fields.list(Q)).ownedHere).toBe(false);
    await expect(fields.link('VLC', '20447-9')).rejects.toMatchObject({ kind: 'central-managed' });
    await expect(fields.unlink('VLC')).rejects.toMatchObject({ kind: 'central-managed' });
    await expect(fields.importPreview(csv('code,loinc\nVLC,20447-9'))).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('exports and imports links as CSV', async () => {
    const { internalDb, admin, fields, onChanged } = await build();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedParam(internalDb, 'CD4', 'CD4 count', { units: 'cells/uL' });
    await seedParam(internalDb, 'AGE', 'Age', { role: 'metadata' });
    await seedParam(internalDb, 'HB', 'Haemoglobin');

    expect(await fields.exportCsv()).toBe(
      'code,display,role,units,loinc\n'
      + 'AGE,Age,metadata,,\n'
      + 'CD4,CD4 count,result,cells/uL,\n'
      + 'HB,Haemoglobin,result,,\n'
      + 'VLC,HIV VL copies,result,,20447-9\n',
    );

    const file = csv([
      'code,loinc',
      'VLC,20447-9',   // unchanged
      'CD4,24467-3',   // new
      'AGE,',          // blank: no change
      'NOPE,1234-5',   // refused
      'VLC,1-1',       // refused, listed twice
      'HB,abc',        // refused, not a LOINC code
    ].join('\n'));
    const preview = await fields.importPreview(file);
    expect(preview).toEqual({
      counts: { new: 1, changed: 0, unchanged: 2, refused: 3 },
      refused: [
        { line: 5, code: 'NOPE', reason: 'no result field has code NOPE' },
        { line: 6, code: 'VLC', reason: 'listed twice in the file' },
        { line: 7, code: 'HB', reason: '"abc" is not a LOINC code. LOINC codes look like 12345-6.' },
      ],
    });
    expect(onChanged).not.toHaveBeenCalled();

    await fields.importApply(file);
    expect(await activeLinks(admin, 'CD4')).toEqual(['24467-3']);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe('parseResultFieldQuery', () => {
  it('defaults and refuses bad values in plain words', () => {
    expect(parseResultFieldQuery({})).toEqual({ ok: true, query: { q: '', loinc: 'all', role: null, limit: 25, offset: 0 } });
    expect(parseResultFieldQuery({ loinc: 'some' })).toEqual({ ok: false, error: 'loinc must be linked, none or all' });
    expect(parseResultFieldQuery({ role: 'boss' })).toEqual({ ok: false, error: 'role must be result, specimen, metadata or admin' });
    expect(parseResultFieldQuery({ limit: '0' })).toEqual({ ok: false, error: 'limit must be a whole number from 1 to 200' });
  });
});
