import { describe, it, expect, vi } from 'vitest';
import type { AcceptInput, IngestBatch } from '@openldr/ingest';
import { ingestAndWait } from './ingest-and-wait';

// Layer under test: the accept, drain and wait loop, with a fake ingest context. The real
// accept, drain and batch store are not run here. The CLI's ingest.test.ts covers the same loop
// through runIngest.

const FAST = { intervalMs: 1, timeoutMs: 20 };
const input: AcceptInput = { data: new Uint8Array([1]), source: 'cli', converter: 'fhir-bundle', filename: 'x.json' };

const batch = (status: string, extra: Partial<IngestBatch> = {}) =>
  ({ batch_id: 'b1', status, resource_count: 0, last_error: null, ...extra }) as IngestBatch;

function fakeCtx(get: () => Promise<IngestBatch | undefined>) {
  const accept = vi.fn(async () => ({ batchId: 'b1', blobKey: 'k' }));
  const drain = vi.fn(async () => ({ processed: 1, failed: 0 }));
  const getFn = vi.fn(get);
  return { ctx: { accept, drain, batches: { get: getFn } as never }, accept, drain, get: getFn };
}

describe('ingestAndWait', () => {
  it('reports a batch that is done at once, after accept and drain', async () => {
    const { ctx, accept, drain, get } = fakeCtx(async () => batch('done', { resource_count: 226 }));
    const out = await ingestAndWait(ctx, input, FAST);
    expect(out).toEqual({ batchId: 'b1', status: 'done', resourceCount: 226, error: null, finished: true });
    expect(accept).toHaveBeenCalledWith(input);
    expect(drain).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
    expect(accept.mock.invocationCallOrder[0]).toBeLessThan(drain.mock.invocationCallOrder[0]);
    expect(drain.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[0]);
  });

  it('waits for a batch the drain left processing, until it turns done', async () => {
    const get = vi.fn<() => Promise<IngestBatch | undefined>>()
      .mockResolvedValueOnce(batch('processing'))
      .mockResolvedValue(batch('done', { resource_count: 3 }));
    const { ctx } = fakeCtx(get);
    const out = await ingestAndWait(ctx, input, FAST);
    expect(out).toMatchObject({ status: 'done', resourceCount: 3, finished: true });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('gives up at the deadline with finished false', async () => {
    const { ctx } = fakeCtx(async () => batch('processing'));
    const out = await ingestAndWait(ctx, input, FAST);
    expect(out).toEqual({ batchId: 'b1', status: 'processing', resourceCount: 0, error: null, finished: false });
  });

  it('reports a failed batch as finished, with its error', async () => {
    const { ctx } = fakeCtx(async () => batch('failed', { last_error: 'bad bundle' }));
    expect(await ingestAndWait(ctx, input, FAST)).toMatchObject({ status: 'failed', error: 'bad bundle', finished: true });
  });

  it('reports a batch that is gone with no status and finished false', async () => {
    const { ctx, get } = fakeCtx(async () => undefined);
    const out = await ingestAndWait(ctx, input, FAST);
    expect(out).toEqual({ batchId: 'b1', status: undefined, resourceCount: undefined, error: undefined, finished: false });
    expect(get).toHaveBeenCalledOnce();
  });
});
