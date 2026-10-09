import { describe, it, expect, vi } from 'vitest';
import { runStorageCopy } from './storage';

const target = () => ({
  endpoint: 'http://storage:3900', region: 'us-east-1', accessKeyId: 'GKt', secretAccessKey: 's',
  bucket: 'openldr', forcePathStyle: true,
});
const full = {
  fromEndpoint: 'http://minio:9000', fromKey: 'k', fromSecret: 's', fromBucket: 'openldr',
  fromRegion: 'us-east-1', json: true,
};
const report = (matches: boolean) => ({
  sourceObjects: 2, sourceBytes: 8, copied: 2, skipped: 0,
  targetObjects: matches ? 2 : 1, targetBytes: matches ? 8 : 3, matches,
});

describe('runStorageCopy', () => {
  it('refuses when a source flag is missing', async () => {
    const copy = vi.fn();
    const code = await runStorageCopy({ ...full, fromSecret: undefined }, { copy, targetConfig: target, audit: vi.fn() });
    expect(code).toBe(1);
    expect(copy).not.toHaveBeenCalled();
  });

  it('refuses when source and target are the same bucket on the same endpoint', async () => {
    const copy = vi.fn();
    const code = await runStorageCopy({ ...full, fromEndpoint: 'http://storage:3900' }, { copy, targetConfig: target, audit: vi.fn() });
    expect(code).toBe(1);
    expect(copy).not.toHaveBeenCalled();
  });

  it('exits 0 and audits when totals match', async () => {
    const audit = vi.fn(async () => {});
    const code = await runStorageCopy(full, { copy: vi.fn(async () => report(true)), targetConfig: target, audit });
    expect(code).toBe(0);
    expect(audit).toHaveBeenCalledWith(report(true));
  });

  it('exits non-zero when totals differ, and still audits', async () => {
    const audit = vi.fn(async () => {});
    const code = await runStorageCopy(full, { copy: vi.fn(async () => report(false)), targetConfig: target, audit });
    expect(code).toBe(1);
    expect(audit).toHaveBeenCalledOnce();
  });
});
