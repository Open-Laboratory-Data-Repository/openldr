import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resultFields = { list: vi.fn(), link: vi.fn(), unlink: vi.fn(), exportCsv: vi.fn(), importPreview: vi.fn(), importApply: vi.fn() };
const audit: unknown[] = [];
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
vi.mock('@openldr/bootstrap', async (orig) => {
  const actual = await orig<typeof import('@openldr/bootstrap')>();
  return {
    ...actual,
    createAppContext: async () => ({ resultFields, close: async () => {} }),
    recordAuditEvent: async (_ctx: unknown, _actor: unknown, e: unknown) => { audit.push(e); },
  };
});

import { runResultFieldsImport, runResultFieldsLink, runResultFieldsList, runResultFieldsUnlink } from './result-fields';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
  return { out: () => out.join(''), err: () => err.join('') };
}

beforeEach(() => { vi.restoreAllMocks(); audit.length = 0; for (const f of Object.values(resultFields)) f.mockReset(); });

describe('openldr test-catalog result-fields', () => {
  it('list refuses a bad filter in the route parser\'s words', async () => {
    const io = capture();
    expect(await runResultFieldsList({ loinc: 'some', json: false })).toBe(1);
    expect(io.err()).toContain('loinc must be linked, none or all');
    expect(resultFields.list).not.toHaveBeenCalled();
  });

  it('list prints one line per field', async () => {
    resultFields.list.mockResolvedValue({ rows: [{ code: 'VLC', display: 'HIV VL copies', role: 'result', units: 'copies/mL', loinc: '20447-9' }], total: 1, ownedHere: true, loaded: true });
    const io = capture();
    expect(await runResultFieldsList({ json: false })).toBe(0);
    expect(io.out()).toContain('VLC  HIV VL copies  result  copies/mL  LOINC 20447-9');
  });

  it('link audits as the CLI actor', async () => {
    resultFields.link.mockResolvedValue({ code: 'VLC', before: null, after: '20447-9' });
    capture();
    expect(await runResultFieldsLink('VLC', '20447-9', { json: false })).toBe(0);
    expect(audit[0]).toMatchObject({ action: 'result_field.link', entityId: 'VLC', after: { loinc: '20447-9' } });
  });

  it('unlink and an applied import refuse without --force', async () => {
    capture();
    expect(await runResultFieldsUnlink('VLC', { force: false, json: false })).toBe(1);
    expect(resultFields.unlink).not.toHaveBeenCalled();
    const file = join(mkdtempSync(join(tmpdir(), 'rf-')), 'links.csv');
    writeFileSync(file, 'code,loinc\nVLC,20447-9\n');
    expect(await runResultFieldsImport(file, { apply: true, force: false, json: false })).toBe(1);
    expect(resultFields.importApply).not.toHaveBeenCalled();
  });

  it('import previews by default', async () => {
    resultFields.importPreview.mockResolvedValue({ counts: { new: 1, changed: 0, unchanged: 0, refused: 0 }, refused: [] });
    const file = join(mkdtempSync(join(tmpdir(), 'rf-')), 'links.csv');
    writeFileSync(file, 'code,loinc\nVLC,20447-9\n');
    const io = capture();
    expect(await runResultFieldsImport(file, { apply: false, force: false, json: false })).toBe(0);
    expect(io.out()).toContain('would link 1 new, change 0, leave 0 unchanged, refuse 0');
  });
});
