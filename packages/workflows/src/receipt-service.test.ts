import { describe, it, expect } from 'vitest';
import { webhookInputDigest } from './receipt-service';

describe('webhook semantic identity', () => {
  it('ignores transport headers and object key order but preserves execution data', async () => {
    const a = await webhookInputDigest({ body: { b: 2, a: 1 }, headers: { host: 'one', prefer: 'respond-async', 'x-source': 'lab' } });
    expect(await webhookInputDigest({ headers: { 'x-source': 'lab', host: 'two' }, body: { a: 1, b: 2 } })).toBe(a);
    expect(await webhookInputDigest({ body: { b: 3, a: 1 }, headers: { 'x-source': 'lab' } })).not.toBe(a);
    expect(await webhookInputDigest({ body: { b: 2, a: 1 }, headers: { 'x-source': 'other' } })).not.toBe(a);
  });
  it('retains ordinary custom headers while removing known authentication headers', async () => {
    expect(await webhookInputDigest({ headers: { 'x-token-count': '1' } })).not.toBe(await webhookInputDigest({ headers: { 'x-token-count': '2' } }));
    expect(await webhookInputDigest({ headers: { authorization: 'secret1', 'x-webhook-token': 'secret2' } })).toBe(await webhookInputDigest({ headers: {} }));
  });
  it('compares binary bytes instead of generated object keys', async () => {
    const ref = { objectKey: 'one', byteSize: 3, contentType: 'text/plain', fileName: 'a.txt' };
    const read = async (key: string) => Buffer.from(key === 'changed' ? 'def' : 'abc');
    const a = await webhookInputDigest({ body: {} }, { file: ref }, read);
    expect(await webhookInputDigest({ body: {} }, { file: { ...ref, objectKey: 'two' } }, read)).toBe(a);
    expect(await webhookInputDigest({ body: {} }, { file: { ...ref, objectKey: 'changed' } }, read)).not.toBe(a);
  });
});
