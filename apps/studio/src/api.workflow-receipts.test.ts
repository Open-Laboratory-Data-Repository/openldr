import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkflowReceipts, fetchWorkflowReceipt } from './api';

afterEach(() => vi.restoreAllMocks());
describe('workflow receipt API', () => {
  it('encodes workflow identity and sends bounded page options', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('[]'));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchWorkflowReceipts('flow/1', { limit: 26, offset: 25 })).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledWith('/api/workflows/flow%2F1/receipts?limit=26&offset=25');
  });
  it('encodes request identity and rejects a failed detail lookup', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchWorkflowReceipt('flow/1', 'request/2')).rejects.toThrow('404');
    expect(fetch).toHaveBeenCalledWith('/api/workflows/flow%2F1/receipts/request%2F2');
  });
});
