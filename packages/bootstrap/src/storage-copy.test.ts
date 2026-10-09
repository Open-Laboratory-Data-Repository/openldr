import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { CopySide } from '@openldr/adapter-s3-bucket';
import { copyStorage } from './storage-copy';

function memorySide(initial: Record<string, string> = {}) {
  const objects = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]));
  const side: CopySide & { objects: Map<string, Buffer> } = {
    objects,
    async *list() { for (const [key, b] of objects) yield { key, size: b.length }; },
    async sizeOf(key) { return objects.has(key) ? objects.get(key)!.length : null; },
    async read(key) { return { body: Readable.from([objects.get(key)!]), contentType: 'application/octet-stream' }; },
    async write(key, body) {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(c as Buffer);
      objects.set(key, Buffer.concat(chunks));
    },
  };
  return side;
}

describe('copyStorage', () => {
  it('copies every object and reports matching totals', async () => {
    const src = memorySide({ a: 'one', 'b/c': 'three' });
    const dst = memorySide();
    const r = await copyStorage(src, dst);
    expect(r).toEqual({ sourceObjects: 2, sourceBytes: 8, copied: 2, skipped: 0, targetObjects: 2, targetBytes: 8, matches: true });
    expect(dst.objects.get('b/c')!.toString()).toBe('three');
  });

  it('skips an object already on the target with the same size, so a re-run resumes', async () => {
    const src = memorySide({ a: 'one', b: 'two' });
    const dst = memorySide({ a: 'xyz' });
    const write = vi.spyOn(dst, 'write');
    const r = await copyStorage(src, dst);
    expect(r.copied).toBe(1);
    expect(r.skipped).toBe(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('copies again when the target has the key at a different size', async () => {
    const src = memorySide({ a: 'one' });
    const dst = memorySide({ a: 'longer' });
    const r = await copyStorage(src, dst);
    expect(r.copied).toBe(1);
    expect(dst.objects.get('a')!.toString()).toBe('one');
  });

  it('reports a mismatch when the target holds extra objects', async () => {
    const src = memorySide({ a: 'one' });
    const dst = memorySide({ stray: 'x' });
    const r = await copyStorage(src, dst);
    expect(r.matches).toBe(false);
    expect(r.targetObjects).toBe(2);
  });

  it('never writes to the source', async () => {
    const src = memorySide({ a: 'one' });
    const write = vi.spyOn(src, 'write');
    await copyStorage(src, memorySide());
    expect(write).not.toHaveBeenCalled();
  });
});
