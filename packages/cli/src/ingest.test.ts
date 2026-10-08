import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  createIngestContext: vi.fn(),
  accept: vi.fn(),
  drain: vi.fn(),
  get: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));
vi.mock('@openldr/bootstrap', () => ({ createIngestContext: mocks.createIngestContext }));

import { runIngest } from './ingest';

const FAST = { intervalMs: 1, timeoutMs: 50 };
const opts = { json: false, source: 'cli', converter: 'fhir-bundle' };

describe('openldr ingest', () => {
  let out: string[];
  let file: string;

  beforeEach(() => {
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    file = join(mkdtempSync(join(tmpdir(), 'ingest-test-')), 'bundle.json');
    writeFileSync(file, '{"resourceType":"Bundle","type":"transaction","entry":[]}');
    mocks.accept.mockResolvedValue({ batchId: 'b1' });
    mocks.drain.mockResolvedValue({ processed: 0 });
    mocks.close.mockResolvedValue(undefined);
    mocks.createIngestContext.mockResolvedValue({ accept: mocks.accept, drain: mocks.drain, batches: { get: mocks.get }, close: mocks.close });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.get.mockReset();
  });

  const batch = (status: string, extra: Record<string, unknown> = {}) => ({ batch_id: 'b1', status, resource_count: 0, last_error: null, ...extra });

  it('reports done when this process drained the batch itself', async () => {
    mocks.get.mockResolvedValue(batch('done', { resource_count: 1 }));
    expect(await runIngest(file, opts, FAST)).toBe(0);
    expect(out.join('')).toContain('batch b1: done (1 resources)');
  });

  // The running API server's worker can claim the batch first, so this process's drain finds
  // nothing and the batch is still received or processing when it is first read.
  it('waits for a batch another process is still working on', async () => {
    mocks.get
      .mockResolvedValueOnce(batch('received'))
      .mockResolvedValueOnce(batch('processing'))
      .mockResolvedValue(batch('done', { resource_count: 1 }));
    expect(await runIngest(file, opts, FAST)).toBe(0);
    expect(out.join('')).toContain('batch b1: done (1 resources)');
  });

  it('exits 1 with the error when the batch fails', async () => {
    mocks.get.mockResolvedValueOnce(batch('processing')).mockResolvedValue(batch('failed', { last_error: 'bad bundle' }));
    expect(await runIngest(file, opts, FAST)).toBe(1);
    expect(out.join('')).toContain('batch b1: failed (0 resources) — bad bundle');
  });

  it('exits 1 and says where to look when the batch is still running at the deadline', async () => {
    mocks.get.mockResolvedValue(batch('processing'));
    expect(await runIngest(file, opts, FAST)).toBe(1);
    expect(out.join('')).toContain('still processing');
    expect(out.join('')).toContain('openldr pipeline status');
  });
});
