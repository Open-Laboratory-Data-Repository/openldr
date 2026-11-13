import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readlinkSync, realpathSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readdir, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import type { BlobStoragePort } from '@openldr/ports';
import { createFsBucket, BlobKeyError, BlobPresignUnsupportedError } from './index';

const MiB = 1024 * 1024;

// A forced collection without `--expose-gc` on the command line: a new context created after
// the flag is set gets a `gc` global.
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** Every file and folder under `root`, as sorted relative paths. Folders end in `/`. */
async function listEverythingUnder(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      const rel = relative(root, p).split(sep).join('/');
      out.push(e.isDirectory() ? `${rel}/` : rel);
      if (e.isDirectory()) await walk(p);
    }
  }
  await walk(root);
  return out.sort();
}

/** Sizes of the files in `<dir>/tmp/` right now. */
async function tmpFileSizes(dir: string): Promise<number[]> {
  const tmp = join(dir, 'tmp');
  let names: string[];
  try {
    names = await readdir(tmp);
  } catch {
    return [];
  }
  const sizes: number[] = [];
  for (const n of names) {
    try {
      sizes.push((await stat(join(tmp, n))).size);
    } catch {
      // renamed away between readdir and stat
    }
  }
  return sizes;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

describe('createFsBucket', () => {
  let parent: string;
  let dir: string;
  let bucket: BlobStoragePort;

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'openldr-fs-bucket-'));
    dir = join(parent, 'store');
    await mkdir(dir);
    bucket = createFsBucket({ dir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await chmod(dir, 0o700).catch(() => {});
    await chmod(join(dir, 'tmp'), 0o700).catch(() => {});
    await rm(parent, { recursive: true, force: true });
  });

  it('stores and reads back bytes and text', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await bucket.put('bin/one', bytes);
    expect(Buffer.from(await bucket.get('bin/one')).equals(Buffer.from(bytes))).toBe(true);

    await bucket.put('text/one.json', '{"hello":"wörld"}', 'application/json');
    expect(Buffer.from(await bucket.get('text/one.json')).toString('utf8')).toBe('{"hello":"wörld"}');
    expect((await readAll(await bucket.getStream('text/one.json'))).toString('utf8')).toBe('{"hello":"wörld"}');

    expect(await bucket.exists('bin/one')).toBe(true);
    await bucket.delete('bin/one');
    expect(await bucket.exists('bin/one')).toBe(false);
  });

  it('reads a missing key as a rejection, exists as false, delete as success', async () => {
    await expect(bucket.get('nope/missing')).rejects.toThrow();
    await expect(bucket.getStream('nope/missing')).rejects.toThrow();
    expect(await bucket.exists('nope/missing')).toBe(false);
    await expect(bucket.delete('nope/missing')).resolves.toBeUndefined();

    // A key whose parent part is an object, and a key that names a folder, are missing too.
    await bucket.put('file', 'x');
    await bucket.put('folder/child', 'y');
    expect(await bucket.exists('file/below')).toBe(false);
    expect(await bucket.exists('folder')).toBe(false);
    await expect(bucket.delete('file/below')).resolves.toBeUndefined();
    await expect(bucket.delete('folder')).resolves.toBeUndefined();
    await expect(bucket.get('folder')).rejects.toThrow();
    await expect(bucket.getStream('folder')).rejects.toThrow();
    expect(Buffer.from(await bucket.get('folder/child')).toString()).toBe('y');
  });

  it('refuses keys that leave the folder or are not usable paths', async () => {
    const keys = [
      '',
      '/abs',
      'a/../b',
      '..',
      '../escape', // would land in dir, beside objects/
      'a/../../escape', // the same, by way of a folder
      '../../escape', // would land beside dir
      'a//b',
      'a/./b',
      'a\\b',
      'a\0b',
      'x'.repeat(256),
      'a/',
      '.',
      `ok/${'é'.repeat(128)}`, // 128 characters, 256 bytes
    ];
    for (const key of keys) {
      await expect(bucket.put(key, 'x')).rejects.toBeInstanceOf(BlobKeyError);
      await expect(bucket.putStream(key, Readable.from(['x']))).rejects.toBeInstanceOf(BlobKeyError);
      await expect(bucket.get(key)).rejects.toBeInstanceOf(BlobKeyError);
      await expect(bucket.getStream(key)).rejects.toBeInstanceOf(BlobKeyError);
      await expect(bucket.exists(key)).rejects.toBeInstanceOf(BlobKeyError);
      await expect(bucket.delete(key)).rejects.toBeInstanceOf(BlobKeyError);
    }
    // Nothing was written anywhere: not in the folder, and not beside it, where `../../escape`
    // would land.
    expect(await listEverythingUnder(parent)).toEqual(['store/']);

    // A part of exactly 255 bytes is allowed.
    await bucket.put(`ok/${'x'.repeat(255)}`, 'fine');
    expect(await bucket.exists(`ok/${'x'.repeat(255)}`)).toBe(true);
  });

  it('writes nothing outside the folder', async () => {
    const before = (await listEverythingUnder(parent)).filter((p) => !p.startsWith('store/'));
    await bucket.put('ok/key', 'value');
    const after = await listEverythingUnder(parent);
    expect(after.filter((p) => !p.startsWith('store/'))).toEqual(before);
    expect(after.filter((p) => p.startsWith('store/'))).toEqual([
      'store/',
      'store/objects/',
      'store/objects/ok/',
      'store/objects/ok/key',
      'store/tmp/',
    ]);
  });

  it('streams a 64 MiB object in and out without holding it in memory', async () => {
    const chunkCount = 64;
    const inHash = createHash('sha256');
    // Measure live buffers, not garbage the collector has not reached yet. Without a forced
    // collection a streaming adapter still showed a 48 MB peak, which is V8's timing, not a leak.
    // The free happens on a later tick, hence the setImmediate.
    const liveArrayBuffers = async (): Promise<number> => {
      gc();
      await new Promise((r) => setImmediate(r));
      return process.memoryUsage().arrayBuffers;
    };
    const base = await liveArrayBuffers();
    let peak = base;
    const sample = async (): Promise<void> => {
      peak = Math.max(peak, await liveArrayBuffers());
    };

    // A fresh 1 MiB buffer per chunk, so an adapter that kept every chunk would hold 64 MiB.
    async function* body(): AsyncGenerator<Buffer> {
      for (let i = 0; i < chunkCount; i++) {
        const chunk = Buffer.allocUnsafe(MiB).fill(i * 7 + 1);
        chunk.writeUInt32BE(i, 0);
        inHash.update(chunk);
        if (i % 8 === 7) await sample();
        yield chunk;
      }
    }
    await bucket.putStream('big/object', Readable.from(body()));
    await sample();
    expect((await stat(join(dir, 'objects', 'big', 'object'))).size).toBe(chunkCount * MiB);

    const outHash = createHash('sha256');
    let total = 0;
    let sinceSample = 0;
    for await (const c of await bucket.getStream('big/object')) {
      outHash.update(c as Buffer);
      total += (c as Buffer).length;
      sinceSample += (c as Buffer).length;
      if (sinceSample >= 8 * MiB) {
        sinceSample = 0;
        await sample();
      }
    }
    await sample();
    expect(total).toBe(chunkCount * MiB);
    expect(outHash.digest('hex')).toBe(inHash.digest('hex'));
    expect(peak - base).toBeLessThan(16 * MiB);
  });

  // Windows may refuse a rename over a file that is open for reading. Unproven there, so skipped.
  it.skipIf(process.platform === 'win32')('lets a reader see the old object or the new one, never a partial one', async () => {
    const A = Buffer.alloc(MiB, 'a');
    const B = Buffer.alloc(8 * MiB, 'b');
    await bucket.put('doc', A);

    const release = deferred();
    const bChunk = Buffer.alloc(MiB, 'b');
    async function* body(): AsyncGenerator<Buffer> {
      for (let i = 0; i < 4; i++) yield bChunk;
      await release.promise;
      for (let i = 0; i < 4; i++) yield bChunk;
    }
    const writing = bucket.putStream('doc', Readable.from(body()));

    // Half of B is on disk while the write is held. The second check lets an adapter that
    // wrote in place reach the read below and fail there, not on a timeout.
    const target = join(dir, 'objects', 'doc');
    await waitFor(
      async () =>
        (await tmpFileSizes(dir)).some((s) => s >= 4 * MiB) || (await stat(target)).size !== A.length,
    );
    expect(Buffer.from(await bucket.get('doc')).equals(A)).toBe(true);
    expect(await bucket.exists('doc')).toBe(true);
    // A stream opened before the swap keeps reading the old object after it.
    const openedBefore = await bucket.getStream('doc');

    release.resolve();
    await writing;

    expect(Buffer.from(await bucket.get('doc')).equals(B)).toBe(true);
    expect((await readAll(openedBefore)).equals(A)).toBe(true);
    expect(await readdir(join(dir, 'tmp'))).toEqual([]);
  });

  it('keeps one whole object when two writers race on a key', async () => {
    const X = Buffer.alloc(4 * MiB, 'x');
    const Y = Buffer.alloc(4 * MiB, 'y');
    const go = deferred();
    function body(fill: string): Readable {
      const chunk = Buffer.alloc(MiB, fill);
      return Readable.from(
        (async function* () {
          for (let i = 0; i < 2; i++) yield chunk;
          await go.promise;
          for (let i = 0; i < 2; i++) yield chunk;
        })(),
      );
    }
    const w1 = bucket.putStream('race', body('x'));
    const w2 = bucket.putStream('race', body('y'));
    // Both writers have half their body on disk at the same moment.
    await waitFor(async () => (await tmpFileSizes(dir)).filter((s) => s >= 2 * MiB).length === 2);
    go.resolve();
    await Promise.all([w1, w2]);

    const result = Buffer.from(await bucket.get('race'));
    expect(result.equals(X) || result.equals(Y)).toBe(true);
    expect(await readdir(join(dir, 'tmp'))).toEqual([]);

    // The same through put, with two different bodies in flight together.
    const P = Buffer.alloc(8 * MiB, 'p');
    const Q = Buffer.alloc(8 * MiB, 'q');
    await Promise.all([bucket.put('race2', P), bucket.put('race2', Q)]);
    const result2 = Buffer.from(await bucket.get('race2'));
    expect(result2.equals(P) || result2.equals(Q)).toBe(true);
    expect(await readdir(join(dir, 'tmp'))).toEqual([]);
  });

  it('removes its temporary file when a stream fails part way', async () => {
    let wroteHalf = false;
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.alloc(MiB, 'z');
      yield Buffer.alloc(MiB, 'z');
      wroteHalf = true;
      throw new Error('source broke');
    }
    await expect(bucket.putStream('broken', Readable.from(body()))).rejects.toThrow('source broke');
    expect(wroteHalf).toBe(true);
    expect(await readdir(join(dir, 'tmp'))).toEqual([]);
    expect(await bucket.exists('broken')).toBe(false);

    // A failed rename (the key names a folder) also leaves tmp/ empty.
    await bucket.put('taken/child', 'c');
    await expect(bucket.put('taken', 'over a folder')).rejects.toThrow();
    expect(await readdir(join(dir, 'tmp'))).toEqual([]);
  });

  /** The prototype every FileHandle shares, so a spy on its `sync` sees every flush. */
  async function fileHandlePrototype(): Promise<FileHandle> {
    const fh = await open(join(parent, 'probe'), 'w');
    await fh.close();
    await rm(join(parent, 'probe'));
    return Object.getPrototypeOf(fh) as FileHandle;
  }

  // Reads which file or folder each flush was for from /proc, so Linux only. No test can cut the
  // power, so this shows the flushes happen, and in what order. It cannot show they are enough.
  it.runIf(process.platform === 'linux')(
    'flushes the folder that holds a new object after the rename, and each folder it made for it',
    async () => {
      const proto = await fileHandlePrototype();
      const original = proto.sync;
      const real = realpathSync(dir);
      let target = '';
      const synced: Array<{ path: string; targetThere: boolean }> = [];
      vi.spyOn(proto, 'sync').mockImplementation(async function (this: FileHandle) {
        synced.push({ path: readlinkSync(`/proc/self/fd/${this.fd}`), targetThere: existsSync(target) });
        return original.call(this);
      });

      target = join(dir, 'objects', 'a', 'b', 'c');
      await bucket.put('a/b/c', 'x');
      // First the file's own bytes, in tmp/, before the rename.
      expect(synced[0]!.path.startsWith(join(real, 'tmp') + sep)).toBe(true);
      expect(synced[0]!.targetThere).toBe(false);
      // Then, after the rename, the folder that holds it, and each folder made for it up to the
      // parent of the first one made (objects/ was made by this put too).
      expect(synced.slice(1)).toEqual([
        { path: join(real, 'objects', 'a', 'b'), targetThere: true },
        { path: join(real, 'objects', 'a'), targetThere: true },
        { path: join(real, 'objects'), targetThere: true },
        { path: real, targetThere: true },
      ]);

      // Into a folder that already exists, only that folder.
      synced.length = 0;
      target = join(dir, 'objects', 'a', 'b', 'd');
      await bucket.putStream('a/b/d', Readable.from([Buffer.from('y')]));
      expect(synced.slice(1)).toEqual([{ path: join(real, 'objects', 'a', 'b'), targetThere: true }]);
    },
  );

  it.runIf(process.platform === 'linux')(
    'ignores a folder flush the file system cannot do, and fails on any other flush error',
    async () => {
      const proto = await fileHandlePrototype();
      const original = proto.sync;
      let folderError = 'EINVAL';
      vi.spyOn(proto, 'sync').mockImplementation(async function (this: FileHandle) {
        if ((await this.stat()).isDirectory()) throw Object.assign(new Error(`folder flush ${folderError}`), { code: folderError });
        return original.call(this);
      });
      await expect(bucket.put('k1', 'one')).resolves.toBeUndefined();
      folderError = 'ENOTSUP';
      await expect(bucket.put('k2', 'two')).resolves.toBeUndefined();
      folderError = 'EIO';
      await expect(bucket.put('k3', 'three')).rejects.toMatchObject({ code: 'EIO' });
      expect(await readdir(join(dir, 'tmp'))).toEqual([]);
    },
  );

  it('overwrites an existing key', async () => {
    await bucket.put('k', 'first, and longer than the second');
    await bucket.put('k', 'second');
    expect(Buffer.from(await bucket.get('k')).toString()).toBe('second');
    await bucket.putStream('k', Readable.from([Buffer.from('third')]));
    expect(Buffer.from(await bucket.get('k')).toString()).toBe('third');
  });

  it('creates the folders it needs under an empty dir', async () => {
    expect(await listEverythingUnder(dir)).toEqual([]);
    await bucket.put('a/b/c/d', 'deep');
    expect(Buffer.from(await bucket.get('a/b/c/d')).toString()).toBe('deep');

    // A folder that does not exist yet is created too.
    const fresh = createFsBucket({ dir: join(parent, 'later', 'store') });
    await fresh.putStream('x/y', Readable.from([Buffer.from('streamed')]));
    expect(Buffer.from(await fresh.get('x/y')).toString()).toBe('streamed');
  });

  // A read-only folder needs Unix modes. Unproven on Windows, so skipped there.
  it.skipIf(process.platform === 'win32')('reports health as up, and as down when the folder is not writable', async () => {
    const up = await bucket.healthCheck();
    expect(up.status).toBe('up');
    expect(up.detail).toBe('file storage ready');
    expect(await readdir(join(dir, 'tmp'))).toEqual([]); // the probe file is gone

    if (process.getuid?.() === 0) return; // root ignores file modes

    await chmod(join(dir, 'tmp'), 0o500);
    expect((await bucket.healthCheck()).status).toBe('down');

    const lockedDir = join(parent, 'locked');
    await mkdir(lockedDir);
    await chmod(lockedDir, 0o500);
    try {
      const down = await createFsBucket({ dir: lockedDir }).healthCheck();
      expect(down.status).toBe('down');
      expect(down.detail).toBeTruthy();
    } finally {
      await chmod(lockedDir, 0o700);
    }
  });

  it('refuses an empty folder at construction', () => {
    for (const empty of ['', '   ', '\t\n']) {
      expect(() => createFsBucket({ dir: empty })).toThrow(Error);
    }
  });

  it('keeps the folder it was given when the working folder changes later', async () => {
    const startCwd = process.cwd();
    const other = join(parent, 'elsewhere');
    await mkdir(other);
    let relBucket: BlobStoragePort;
    try {
      process.chdir(parent);
      relBucket = createFsBucket({ dir: 'relative-store' });
      process.chdir(other);
      await relBucket.put('k', 'v');
      expect(await relBucket.exists('k')).toBe(true);
    } finally {
      process.chdir(startCwd);
    }
    expect((await stat(join(parent, 'relative-store', 'objects', 'k'))).isFile()).toBe(true);
    expect(await listEverythingUnder(other)).toEqual([]);
  });

  it('does not support presign', async () => {
    await expect(bucket.presign('a')).rejects.toBeInstanceOf(BlobPresignUnsupportedError);
  });
});
