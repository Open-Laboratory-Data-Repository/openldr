import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  ctx: {
    internalDb: { marker: 'internalDb' },
    connectors: { list: vi.fn() },
    audit: { marker: 'audit' },
    logger: { marker: 'logger' },
    close: vi.fn(),
  },
  store: { getByName: vi.fn(), get: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn() },
  createAppContext: vi.fn(),
  createCustomQueryStore: vi.fn(),
  referenceCapture: { marker: 'referenceCapture' },
  exportCustomQueries: vi.fn(),
  importCustomQueries: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));
vi.mock('@openldr/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return {
    createAppContext: mocks.createAppContext,
    exportCustomQueries: mocks.exportCustomQueries,
    importCustomQueries: mocks.importCustomQueries,
    recordAuditEvent: mocks.recordAuditEvent,
    CustomQueryTransferError: actual.CustomQueryTransferError,
  };
});
vi.mock('@openldr/db', () => ({
  createCustomQueryStore: mocks.createCustomQueryStore,
  referenceCapture: mocks.referenceCapture,
}));

import { CustomQueryTransferError } from '@openldr/bootstrap';
import { runQueryExport, runQueryImport } from './query';

let dir: string;
let out: string[];
let err: string[];

beforeEach(() => {
  vi.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cq-cli-'));
  mocks.createAppContext.mockResolvedValue(mocks.ctx);
  mocks.createCustomQueryStore.mockReturnValue(mocks.store);
  mocks.ctx.connectors.list.mockResolvedValue([]);
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const FILE = { format: 'openldr.custom-queries', version: 1, exportedAt: 'x', queries: [] };
function writeInput(content: unknown = FILE): string {
  const p = path.join(dir, 'in.json');
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

describe('the store', () => {
  it('is built with referenceCapture so central imports sync to labs', async () => {
    mocks.importCustomQueries.mockResolvedValue({ results: [] });
    await runQueryImport(writeInput(), { force: false, json: false });
    expect(mocks.createCustomQueryStore).toHaveBeenCalledTimes(1);
    expect(mocks.createCustomQueryStore.mock.calls[0][0]).toBe(mocks.ctx.internalDb);
    expect(mocks.createCustomQueryStore.mock.calls[0][1]).toBe(mocks.referenceCapture);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });
});

describe('runQueryExport', () => {
  it('writes the file with 2-space indent and a trailing newline, selecting by name', async () => {
    const file = { ...FILE, queries: [{ name: 'A', sql: 'select 1', params: [] }] };
    mocks.exportCustomQueries.mockResolvedValue(file);
    const outPath = path.join(dir, 'out.json');
    const code = await runQueryExport({ name: ['A'], out: outPath, json: false });
    expect(code).toBe(0);
    expect(fs.readFileSync(outPath, 'utf8')).toBe(JSON.stringify(file, null, 2) + '\n');
    expect(mocks.exportCustomQueries.mock.calls[0][1]).toEqual({ names: ['A'] });
    expect(out.join('')).toContain('1');
  });

  it('exports everything when no name is given', async () => {
    mocks.exportCustomQueries.mockResolvedValue(FILE);
    await runQueryExport({ out: path.join(dir, 'o.json'), json: false });
    expect(mocks.exportCustomQueries.mock.calls[0][1]).toBeUndefined();
  });

  it('exits 1 with a plain message on failure', async () => {
    mocks.exportCustomQueries.mockRejectedValue(new Error('boom'));
    const code = await runQueryExport({ out: path.join(dir, 'o.json'), json: false });
    expect(code).toBe(1);
    expect(err.join('')).toContain('boom');
    expect(mocks.ctx.close).toHaveBeenCalled();
  });
});

describe('runQueryImport', () => {
  it('prints one line per query and a count', async () => {
    mocks.importCustomQueries.mockResolvedValue({
      results: [
        { name: 'A', outcome: 'created', id: 'cq_1' },
        { name: 'B', outcome: 'skipped', id: 'cq_2' },
      ],
    });
    const code = await runQueryImport(writeInput(), { force: false, json: false });
    expect(code).toBe(0);
    const text = out.join('');
    expect(text).toMatch(/created\s+A/);
    expect(text).toMatch(/skipped\s+B/);
    expect(text).toMatch(/1 created, 0 replaced, 1 skipped/);
  });

  it('passes replace only when --force is set, and the connector name', async () => {
    mocks.importCustomQueries.mockResolvedValue({ results: [] });
    await runQueryImport(writeInput(), { force: false, json: false });
    expect(mocks.importCustomQueries.mock.calls[0][2]).toEqual({ connectorName: undefined, replace: false });
    await runQueryImport(writeInput(), { force: true, connector: 'X Y', json: false });
    expect(mocks.importCustomQueries.mock.calls[1][2]).toEqual({ connectorName: 'X Y', replace: true });
  });

  it('skips existing names without --force, exits 0 and writes no audit', async () => {
    mocks.store.getByName.mockResolvedValue({ id: 'cq_2', name: 'B' });
    mocks.importCustomQueries.mockResolvedValue({ results: [{ name: 'B', outcome: 'skipped', id: 'cq_2' }] });
    const code = await runQueryImport(writeInput(), { force: false, json: false });
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/skipped\s+B/);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('prints the ImportResult as JSON with --json', async () => {
    const result = { results: [{ name: 'A', outcome: 'created', id: 'cq_1' }] };
    mocks.importCustomQueries.mockResolvedValue(result);
    mocks.store.get.mockResolvedValue({ id: 'cq_1', name: 'A' });
    const code = await runQueryImport(writeInput(), { force: false, json: true });
    expect(code).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual(result);
  });

  it('audits each written query with the CLI actor, before null on create and before/after on replace', async () => {
    const existingB = { id: 'cq_2', name: 'B', sql: 'select 0' };
    const afterA = { id: 'cq_1', name: 'A', sql: 'select 1' };
    const afterB = { id: 'cq_2', name: 'B', sql: 'select 2' };
    mocks.store.getByName.mockImplementation(async (n: string) => (n === 'B' ? existingB : null));
    mocks.store.get.mockImplementation(async (id: string) => (id === 'cq_1' ? afterA : afterB));
    mocks.importCustomQueries.mockResolvedValue({
      results: [
        { name: 'A', outcome: 'created', id: 'cq_1' },
        { name: 'B', outcome: 'replaced', id: 'cq_2' },
        { name: 'C', outcome: 'skipped', id: 'cq_3' },
      ],
    });
    const file = { ...FILE, queries: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
    await runQueryImport(writeInput(file), { force: true, json: false });

    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(2);
    const [ctxArg, actor, a] = mocks.recordAuditEvent.mock.calls[0];
    expect(ctxArg).toBe(mocks.ctx);
    expect(actor.actorType).toBe('cli');
    expect(a).toEqual({ action: 'customQuery.create', entityType: 'customQuery', entityId: 'cq_1', before: null, after: afterA });
    const [, , b] = mocks.recordAuditEvent.mock.calls[1];
    expect(b).toEqual({ action: 'customQuery.update', entityType: 'customQuery', entityId: 'cq_2', before: existingB, after: afterB });
  });

  it('exits 1 and prints the query name when the bootstrap function rejects the file', async () => {
    mocks.importCustomQueries.mockRejectedValue(new CustomQueryTransferError('query "Bad One": only SELECT is allowed'));
    const code = await runQueryImport(writeInput(), { force: false, json: false });
    expect(code).toBe(1);
    expect(err.join('')).toContain('Bad One');
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(mocks.ctx.close).toHaveBeenCalled();
  });

  it('exits 1 with a plain message on invalid JSON, without opening the app', async () => {
    const code = await runQueryImport(writeInput('{ not json'), { force: false, json: false });
    expect(code).toBe(1);
    expect(err.join('')).toMatch(/not valid JSON/);
    expect(mocks.importCustomQueries).not.toHaveBeenCalled();
  });

  it('exits 1 when the file cannot be read', async () => {
    const code = await runQueryImport(path.join(dir, 'missing.json'), { force: false, json: false });
    expect(code).toBe(1);
    expect(err.join('')).toMatch(/cannot read/);
  });
});
