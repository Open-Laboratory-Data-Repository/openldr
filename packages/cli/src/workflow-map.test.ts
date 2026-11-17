import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { FakeConfigError } = vi.hoisted(() => ({ FakeConfigError: class extends Error {} }));
const ctx = vi.hoisted(() => ({
  close: vi.fn(),
  workflows: { store: { get: vi.fn() }, mapToFhir: { test: vi.fn() } },
}));
vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({})) }));
vi.mock('@openldr/bootstrap', async () => {
  const real = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return {
    createAppContext: vi.fn(async () => ctx),
    MAP_TEST_MAX_ITEMS: 20,
    MapConfigError: FakeConfigError,
    readTableFile: real.readTableFile,
    TableFileError: real.TableFileError,
    dangerResetDashboards: vi.fn(), dangerClearAudit: vi.fn(), dangerFactoryReset: vi.fn(),
  };
});
import { buildProgram } from './program';
import { readMapTestRows } from './workflow-map';
// The CLI does not depend on @openldr/workflows, so Extract from File's reader is read by path.
import { fileToRows } from '../../workflows/src/engine/node-handlers/file-codecs';

const node = (over: Record<string, unknown> = {}) => ({
  id: 'n1', type: 'action',
  data: { action: 'map-to-fhir', config: { targetId: 'target-a', formIds: [], mappings: [{ id: 'm1' }], sourcePath: 'ignored.path' }, ...over },
});
const workflow = (nodes = [node()]) => ({ id: 'wf-1', name: 'W', definition: { nodes, edges: [] } });
const okResult = { ok: true, kind: 'mapped', resourceTypes: ['Patient'], resources: [{ resourceType: 'Patient', note: 'QZXRES' }] };
const heldA = { ok: false, reason: 'unknown shape' };
const heldB = { ok: false, reason: 'missing required field', field: 'f1' };

let dir: string;
let out: string;
let err: string;
const file = (name: string, text: string) => { const p = join(dir, name); writeFileSync(p, text); return p; };
const run = (...args: string[]) => buildProgram().exitOverride().parseAsync(['node', 'openldr', 'workflows', 'map-test', ...args]);

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = mkdtempSync(join(tmpdir(), 'maptest-'));
  out = ''; err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out += String(s); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err += String(s); return true; });
  ctx.workflows.store.get.mockResolvedValue(workflow());
});
afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; rmSync(dir, { recursive: true, force: true }); });

describe('workflows map-test', () => {
  it('maps a JSON file through the shared test, with the node config and the rows as they are', async () => {
    ctx.workflows.mapToFhir.test.mockResolvedValue([okResult, okResult]);
    await run('wf-1', 'n1', file('rows.json', JSON.stringify([{ a: 'QZX1' }, { a: 'QZX2' }])));
    expect(ctx.workflows.mapToFhir.test).toHaveBeenCalledWith({
      config: { targetId: 'target-a', formIds: [], mappings: [{ id: 'm1' }] },
      items: [{ a: 'QZX1' }, { a: 'QZX2' }],
    });
    expect(process.exitCode).toBe(0);
    expect(out).toContain('Rows: 2');
    expect(out).toContain('Passed: 2 (mapped 2)');
    expect(out).toContain('Held: 0');
    expect(ctx.close).toHaveBeenCalledOnce();
  });

  it('prints no row value and no record without --json', async () => {
    ctx.workflows.mapToFhir.test.mockResolvedValue([okResult, heldA]);
    await run('wf-1', 'n1', file('rows.json', JSON.stringify([{ a: 'QZX1' }, { a: 'QZX2' }])));
    expect(out + err).not.toContain('QZX');
  });

  it('reports each held reason with its count and the first 5 row numbers, and exits 1', async () => {
    const results = [okResult, heldA, heldB, heldA, heldA, heldA, heldA, heldA];
    ctx.workflows.mapToFhir.test.mockResolvedValue(results);
    await run('wf-1', 'n1', file('rows.json', JSON.stringify(results.map((_, i) => ({ i })))));
    expect(process.exitCode).toBe(1);
    expect(out).toContain('Rows: 8');
    expect(out).toContain('Held: 7');
    expect(out).toContain('unknown shape: 6 rows (rows 2, 4, 5, 6, 7, ...)');
    expect(out).toContain('missing required field (f1): 1 row (row 3)');
  });

  it('prints the full results as JSON with --json, records included', async () => {
    ctx.workflows.mapToFhir.test.mockResolvedValue([okResult, heldA]);
    await run('wf-1', 'n1', file('rows.json', JSON.stringify([{ a: 1 }, { a: 2 }])), '--json');
    expect(JSON.parse(out)).toEqual({ rows: 2, passed: 1, held: 1, results: [okResult, heldA] });
    expect(process.exitCode).toBe(1);
  });

  it('reads a CSV, leaves blank cells out and keeps the rest as text', async () => {
    ctx.workflows.mapToFhir.test.mockResolvedValue([okResult, okResult]);
    await run('wf-1', 'n1', file('rows.csv', 'a,b,c\n1,,x\n,2,y\n'));
    expect(ctx.workflows.mapToFhir.test.mock.calls[0][0].items).toEqual([{ a: '1', c: 'x' }, { b: '2', c: 'y' }]);
  });

  it('sends rows in batches of 20 and reports every row in order', async () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ i }));
    ctx.workflows.mapToFhir.test.mockImplementation(async ({ items }: { items: { i: number }[] }) =>
      items.map((it) => (it.i === 44 ? heldA : okResult)));
    await run('wf-1', 'n1', file('rows.json', JSON.stringify(rows)));
    expect(ctx.workflows.mapToFhir.test.mock.calls.map((c) => c[0].items.length)).toEqual([20, 20, 5]);
    expect(out).toContain('Rows: 45');
    expect(out).toContain('(row 45)');
  });

  it('says so for a node that is missing', async () => {
    await run('wf-1', 'nope', file('rows.json', '[{"a":1}]'));
    expect(process.exitCode).toBe(1);
    expect(err).toContain('No node "nope" in workflow "wf-1".');
    expect(ctx.workflows.mapToFhir.test).not.toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalledOnce();
  });

  it('says so for a workflow that is missing', async () => {
    ctx.workflows.store.get.mockResolvedValue(undefined);
    await run('wf-9', 'n1', file('rows.json', '[{"a":1}]'));
    expect(process.exitCode).toBe(1);
    expect(err).toContain('No workflow "wf-9".');
  });

  it('refuses a node that is not a Map to FHIR node', async () => {
    ctx.workflows.store.get.mockResolvedValue(workflow([node({ action: 'set-fields' })]));
    await run('wf-1', 'n1', file('rows.json', '[{"a":1}]'));
    expect(process.exitCode).toBe(1);
    expect(err).toContain('Node "n1" is not a Map to FHIR node.');
    expect(ctx.workflows.mapToFhir.test).not.toHaveBeenCalled();
  });

  it('refuses another file type, an unreadable file and a file with no rows', async () => {
    await run('wf-1', 'n1', file('rows.txt', 'x'));
    expect(err).toContain('The file must be .json or .csv.');
    err = '';
    await run('wf-1', 'n1', join(dir, 'missing.json'));
    expect(err).toContain('The file cannot be read.');
    err = '';
    await run('wf-1', 'n1', file('empty.json', '[]'));
    expect(err).toContain('The file holds no rows.');
    err = '';
    await run('wf-1', 'n1', file('bad.json', '{"a":1}'));
    expect(err).toContain('The JSON file must hold a list of objects.');
    expect(process.exitCode).toBe(1);
    expect(ctx.workflows.mapToFhir.test).not.toHaveBeenCalled();
  });

  it('prints a config fault from the service as it is', async () => {
    ctx.workflows.mapToFhir.test.mockRejectedValue(new FakeConfigError('Map to FHIR node config: mapping 0 is not a saved mapping'));
    await run('wf-1', 'n1', file('rows.json', '[{"a":"QZX"}]'));
    expect(process.exitCode).toBe(1);
    expect(err).toContain('Map to FHIR node config: mapping 0 is not a saved mapping');
    expect(ctx.close).toHaveBeenCalledOnce();
  });

  it('does not print a raw error from anything else', async () => {
    ctx.workflows.mapToFhir.test.mockRejectedValue(new Error('private QZX'));
    await run('wf-1', 'n1', file('rows.json', '[{"a":"QZX"}]'));
    expect(process.exitCode).toBe(1);
    expect(out + err).not.toContain('QZX');
  });
});

describe('a CSV file read by map-test and by Extract from File with Read every cell as text', () => {
  it('gives the same rows, except that map-test cuts the spaces around a header or a cell', () => {
    const text = 'id, name ,dec,blank,big,when\n007, QZX 1 ,"12,5",,12345678901234567890,03/11/2026\nQZX-2,QZX 3,12.5,,1,2026-11-03\n';
    const cli = readMapTestRows(file('rows.csv', text));
    const node = fileToRows(new TextEncoder().encode(text), { cellsAsText: true });
    const trimmed = node.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), String(v).trim()]).filter(([, v]) => v !== '')));
    expect(cli).toEqual(trimmed);
    expect(cli[0]).toEqual({ id: '007', name: 'QZX 1', dec: '12,5', big: '12345678901234567890', when: '03/11/2026' });
    expect(node[0][' name ']).toBe(' QZX 1 ');
  });

  it('says what it prints in the help, with and without --json', () => {
    const help = buildProgram().commands.find((c) => c.name() === 'workflows')!.commands.find((c) => c.name() === 'map-test')!.description();
    expect(help).toContain('Prints counts and reasons; with --json, each row\'s result including its records.');
    expect(help).not.toContain('no row values');
  });

  it('says so in the help', () => {
    const help = buildProgram().commands.find((c) => c.name() === 'workflows')!.commands.find((c) => c.name() === 'map-test')!.description();
    expect(help).toContain("A CSV cell is read as text with the spaces around it cut, and a blank cell is left out.");
    expect(help).toContain("Extract from File with 'Read every cell as text' on gives the same rows but keeps those spaces.");
  });
});

describe('workflows map-test on a mapping as the panel saves it', () => {
  it('parses the saved config the same way, through the real api and service', async () => {
    const real = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
    const { seededStarterPacks } = await import('@openldr/forms');
    const packs = seededStarterPacks().map((p) => ({ id: p.id, resourceType: p.resourceType, entries: p.entries }));
    // The bootstrap index exports the api but not the service, so the service is read by path.
    const { createMapToFhirService } = await import('../../bootstrap/src/map-to-fhir-service');
    const service = createMapToFhirService({
      forms: { get: async () => null },
      validateForm: async () => ({ items: [], meta: { formId: 'f', validated: 0, invalid: [] } }),
      packs: async () => packs,
      translateCode: async () => null,
      validate: async () => ({ ok: true }) as never,
    });
    const api = real.createMapToFhirApi({ mapToFhir: service, packs: async () => packs, conceptMaps: async () => [], localSourceSystems: async () => [] });
    ctx.workflows.mapToFhir.test.mockImplementation((input: Parameters<typeof api.test>[0]) => api.test(input));
    // Made up, in the shape the panel saves: tests per column, a coded Values rule, an Excel date.
    const mapping = {
      shapeHash: 'h-isolate', fieldNames: ['AMP', 'CIP', 'GEN', 'coll_dt', 'dob', 'pat_no', 'sample_type'], targetId: 'lab-result',
      rows: [
        { targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } },
        { targetPath: 'Patient.birthDate', from: { field: 'dob' }, rule: { kind: 'date', format: 'excel' } },
        { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'coll_dt' } },
        { targetPath: 'Specimen.type', from: { field: 'sample_type' }, rule: { kind: 'values', map: { Urine: { system: 'urn:test:specimen', code: 'UR' } } } },
        { targetPath: 'Observation.code', from: { fixedList: ['AMP', 'CIP', 'GEN'] } },
        { targetPath: 'Observation.valueString', from: { fields: ['AMP', 'CIP', 'GEN'] } },
      ],
    };
    const saved = JSON.parse(JSON.stringify(node({ config: { targetId: 'lab-result', formIds: [], mappings: [mapping] } })));
    ctx.workflows.store.get.mockResolvedValue(workflow([saved]));
    await run('wf-1', 'n1', file('rows.csv', 'pat_no,dob,coll_dt,sample_type,AMP,CIP,GEN\nT-0401,45000,2026-11-05,Urine,R,S,\n'));
    expect(err).toBe('');
    expect(out).toContain('Passed: 1 (mapped 1)');
    expect(process.exitCode).toBe(0);
  });
});
