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
const report = (matches: boolean, extra = 0) => ({
  sourceObjects: 2, sourceBytes: 8, copied: 2, skipped: 0,
  targetObjects: (matches ? 2 : 1) + extra, targetBytes: (matches ? 8 : 3) + extra,
  extraTargetObjects: extra, missing: matches ? 0 : 1, matches,
});

async function captureStdout(run: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: string | Uint8Array) => {
    chunks.push(String(c));
    return true;
  }) as never);
  try {
    const code = await run();
    return { code, out: chunks.join('') };
  } finally {
    spy.mockRestore();
  }
}

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

  it('exits 0 and audits when every source object is on the target', async () => {
    const audit = vi.fn(async () => {});
    const code = await runStorageCopy(full, { copy: vi.fn(async () => report(true)), targetConfig: target, audit });
    expect(code).toBe(0);
    expect(audit).toHaveBeenCalledWith(report(true));
  });

  it('exits non-zero when source objects are missing, and still audits', async () => {
    const audit = vi.fn(async () => {});
    const code = await runStorageCopy(full, { copy: vi.fn(async () => report(false)), targetConfig: target, audit });
    expect(code).toBe(1);
    expect(audit).toHaveBeenCalledOnce();
  });

  it('prints the missing count and says not to switch when objects are missing', async () => {
    const { code, out } = await captureStdout(() =>
      runStorageCopy({ ...full, json: false }, { copy: vi.fn(async () => report(false)), targetConfig: target, audit: vi.fn() }));
    expect(code).toBe(1);
    expect(out).toContain('1 source object is missing on the target: do not switch yet');
  });

  it('exits 0 and shows the extra objects line when the target holds more than the source', async () => {
    const { code, out } = await captureStdout(() =>
      runStorageCopy({ ...full, json: false }, { copy: vi.fn(async () => report(true, 3)), targetConfig: target, audit: vi.fn() }));
    expect(code).toBe(0);
    expect(out).toContain('every source object is on the target');
    expect(out).toContain('extra on target (written since the copy started, or left over): 3');
    expect(out).toContain('missing: 0');
  });
});
