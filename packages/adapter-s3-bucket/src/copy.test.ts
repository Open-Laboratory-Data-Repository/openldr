import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createS3CopySide } from './copy';

const cfg = {
  endpoint: 'http://x', region: 'us-east-1', accessKeyId: 'k', secretAccessKey: 's',
  bucket: 'openldr', forcePathStyle: true,
};

function clientWith(handlers: Record<string, (input: any) => any>) {
  return {
    send: vi.fn(async (cmd: { constructor: { name: string }; input: unknown }) => {
      const h = handlers[cmd.constructor.name];
      if (!h) throw new Error(`unexpected ${cmd.constructor.name}`);
      return h(cmd.input);
    }),
  };
}

describe('createS3CopySide', () => {
  it('lists every object across pages', async () => {
    const client = clientWith({
      ListObjectsV2Command: (input) =>
        input.ContinuationToken === 't2'
          ? { Contents: [{ Key: 'c', Size: 3 }] }
          : { Contents: [{ Key: 'a', Size: 1 }, { Key: 'b', Size: 2 }], NextContinuationToken: 't2' },
    });
    const side = createS3CopySide(cfg, { client: client as never });
    const seen = [];
    for await (const o of side.list()) seen.push(o);
    expect(seen).toEqual([{ key: 'a', size: 1 }, { key: 'b', size: 2 }, { key: 'c', size: 3 }]);
  });

  it('returns null size for a missing key', async () => {
    const client = clientWith({
      HeadObjectCommand: () => { throw { name: 'NotFound', $metadata: { httpStatusCode: 404 } }; },
    });
    expect(await createS3CopySide(cfg, { client: client as never }).sizeOf('nope')).toBeNull();
  });

  it('returns the size of an existing key', async () => {
    const client = clientWith({ HeadObjectCommand: () => ({ ContentLength: 42 }) });
    expect(await createS3CopySide(cfg, { client: client as never }).sizeOf('k')).toBe(42);
  });

  it('rethrows a non-404 head error instead of reading it as absent', async () => {
    const client = clientWith({
      HeadObjectCommand: () => { throw { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }; },
    });
    await expect(createS3CopySide(cfg, { client: client as never }).sizeOf('k')).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it('reads the body and content type', async () => {
    const client = clientWith({
      GetObjectCommand: () => ({ Body: Readable.from([Buffer.from('hi')]), ContentType: 'text/plain' }),
    });
    const r = await createS3CopySide(cfg, { client: client as never }).read('k');
    expect(r.contentType).toBe('text/plain');
    const chunks: Buffer[] = [];
    for await (const c of r.body) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hi');
  });
});
