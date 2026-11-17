import { describe, it, expect } from 'vitest';
import { extractFromFileHandler } from './extract-from-file';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeCtxWith(objectKey: string, bytes: Uint8Array) {
  const store = new Map<string, Uint8Array>([[objectKey, bytes]]);
  const services = {
    readBinary: async (k: string) => { const b = store.get(k); if (!b) throw new Error('not found'); return b; },
  } as unknown as import('../services').WorkflowServices;
  return createContext(undefined, () => {}, [], undefined, services);
}
const ref = (objectKey: string): BinaryRef => ({ objectKey, contentType: 'application/octet-stream', fileName: 'f', byteSize: 1 });
const node = (cfg: Record<string, unknown>) => ({ id: 'ef1', type: 'action', data: { action: 'extract-from-file', config: cfg } });

describe('extractFromFileHandler', () => {
  it('parses a JSON array file into items', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify([{ a: 1 }, { a: 2 }]));
    const ctx = fakeCtxWith('k1', bytes);
    const result = await extractFromFileHandler(node({ format: 'json', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k1') } }]);
    expect(result).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('parses a CSV file into items', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,x\n2,y\n');
    const ctx = fakeCtxWith('k2', bytes);
    const result = await extractFromFileHandler(node({ format: 'csv', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k2') } }]);
    expect(result).toEqual([{ json: { a: 1, b: 'x' } }, { json: { a: 2, b: 'y' } }]);
  });
  it('with cellsAsText, a CSV cell keeps its leading zeros, decimal comma and date text', async () => {
    const bytes = new TextEncoder().encode('id,val,dob,d2\n00123,"12,5",1990-04-12,01/12/2024\n');
    const ctx = fakeCtxWith('k6', bytes);
    const result = await extractFromFileHandler(node({ format: 'csv', sourceField: 'file', cellsAsText: true }), ctx, [{ json: {}, binary: { file: ref('k6') } }]);
    expect(result).toEqual([{ json: { id: '00123', val: '12,5', dob: '1990-04-12', d2: '01/12/2024' } }]);
  });
  it('without cellsAsText, a CSV cell is read as today (pinned)', async () => {
    const bytes = new TextEncoder().encode('id,val,dob,d2\n00123,"12,5",1990-04-12,01/12/2024\n');
    const ctx = fakeCtxWith('k7', bytes);
    const result = await extractFromFileHandler(node({ format: 'csv', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k7') } }]);
    expect(result).toEqual([{ json: { id: 123, val: 125, dob: 32975, d2: 45303 } }]);
  });
  it('wraps text content under a field', async () => {
    const bytes = new TextEncoder().encode('hello world');
    const ctx = fakeCtxWith('k3', bytes);
    const result = await extractFromFileHandler(node({ format: 'text', sourceField: 'file', outputField: 'content' }), ctx, [{ json: {}, binary: { file: ref('k3') } }]);
    expect(result).toEqual([{ json: { content: 'hello world' } }]);
  });
  it('throws a clear error when the input item has no file', async () => {
    const ctx = fakeCtxWith('k4', new Uint8Array());
    await expect(extractFromFileHandler(node({ format: 'json', sourceField: 'file' }), ctx, [{ json: {} }])).rejects.toThrow(/no file/);
  });
  it('throws a clear error for invalid JSON', async () => {
    const bytes = new TextEncoder().encode('{not json');
    const ctx = fakeCtxWith('k5', bytes);
    await expect(extractFromFileHandler(node({ format: 'json', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k5') } }])).rejects.toThrow(/invalid JSON/);
  });
});
