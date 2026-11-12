import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { probe } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';

export interface FsBucketConfig {
  dir: string;
}

/** A storage key that cannot be used as a path under the storage folder. */
export class BlobKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlobKeyError';
  }
}

/** File storage has no URL to hand out, so it cannot presign. */
export class BlobPresignUnsupportedError extends Error {
  constructor(message = 'file storage does not support presigned URLs') {
    super(message);
    this.name = 'BlobPresignUnsupportedError';
  }
}

const MAX_PART_BYTES = 255;

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/**
 * Stores objects as files under `<dir>/objects/`. A write goes to a new file in `<dir>/tmp/`,
 * is flushed, and is renamed over the target, so a reader sees the old object or the new one.
 * Both folders sit under `dir`, so they share one file system and the rename is atomic.
 *
 * Proven on Linux only. On Windows (unproven) a rename over a file that is open for reading
 * may fail, and the path rules there differ.
 */
export function createFsBucket(cfg: FsBucketConfig): BlobStoragePort {
  // An empty folder would resolve to the working folder and store objects there.
  if (cfg.dir.trim() === '') throw new Error('file storage needs a folder, and dir is empty');
  // Resolved once, so a later change of working folder cannot move the store.
  const root = resolve(cfg.dir);
  const objectsDir = join(root, 'objects');
  const tmpDir = join(root, 'tmp');

  /** The file path for a key. Throws BlobKeyError; every caller is async, so it rejects. */
  function pathFor(key: string): string {
    const refuse = (why: string): BlobKeyError =>
      new BlobKeyError(`storage key ${JSON.stringify(key.slice(0, 80))} is not usable: ${why}`);
    if (key === '') throw refuse('it is empty');
    if (key.startsWith('/')) throw refuse('it starts with a slash');
    if (key.includes('\\')) throw refuse('it contains a backslash');
    if (key.includes('\0')) throw refuse('it contains a NUL');
    const parts = key.split('/');
    for (const part of parts) {
      if (part === '') throw refuse('it has an empty part');
      if (part === '.' || part === '..') throw refuse(`it has a "${part}" part`);
      if (Buffer.byteLength(part, 'utf8') > MAX_PART_BYTES) throw refuse('a part is longer than 255 bytes');
    }
    const full = resolve(objectsDir, ...parts);
    if (!full.startsWith(objectsDir + sep)) throw refuse('it resolves outside the storage folder');
    return full;
  }

  /** Write a new temporary file, flush it, then rename it over `target`. Removes it on failure. */
  async function writeAtomic(target: string, write: (fh: FileHandle) => Promise<void>): Promise<void> {
    await mkdir(tmpDir, { recursive: true });
    // A random UUID is unique across processes; 'wx' refuses to open a file that already exists.
    const tmp = join(tmpDir, `${randomUUID()}.tmp`);
    let fh: FileHandle | undefined;
    let created = false;
    try {
      fh = await open(tmp, 'wx');
      created = true;
      await write(fh);
      await fh.sync();
      await fh.close();
      fh = undefined;
      await mkdir(dirname(target), { recursive: true });
      await rename(tmp, target);
    } catch (err) {
      await fh?.close().catch(() => {});
      if (created) await unlink(tmp).catch(() => {});
      throw err;
    }
  }

  return {
    async healthCheck() {
      return probe(async () => {
        await mkdir(tmpDir, { recursive: true });
        const file = join(tmpDir, `health-${randomUUID()}.tmp`);
        await writeFile(file, 'ok', { flag: 'wx' });
        await unlink(file);
        return 'file storage ready';
      });
    },
    // The content type is not stored: the port never returns it.
    async put(key, body) {
      const target = pathFor(key);
      await writeAtomic(target, (fh) => fh.writeFile(body));
    },
    async putStream(key, body) {
      const target = pathFor(key);
      await writeAtomic(target, async (fh) => {
        // One chunk at a time, so the whole body is never held in memory. A source error
        // or a write error ends the loop, which destroys the source stream.
        for await (const chunk of body) {
          await fh.writeFile(chunk as Uint8Array | string);
        }
      });
    },
    async get(key) {
      return readFile(pathFor(key));
    },
    async getStream(key) {
      const path = pathFor(key);
      // Open before returning, so a missing key rejects here and not on the stream.
      const fh = await open(path, 'r');
      try {
        if (!(await fh.stat()).isFile()) {
          throw Object.assign(new Error(`no stored object for key ${JSON.stringify(key)}`), { code: 'ENOENT' });
        }
      } catch (err) {
        await fh.close().catch(() => {});
        throw err;
      }
      return fh.createReadStream();
    },
    async exists(key) {
      const path = pathFor(key);
      try {
        return (await stat(path)).isFile();
      } catch (err) {
        const code = errCode(err);
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw err; // permission and I/O errors are not "missing"
      }
    },
    async delete(key) {
      const path = pathFor(key);
      try {
        await unlink(path);
      } catch (err) {
        const code = errCode(err);
        if (code === 'ENOENT' || code === 'ENOTDIR') return;
        // A key that names a folder holds no object, so there is nothing to delete.
        if ((code === 'EISDIR' || code === 'EPERM') && (await lstat(path).then((s) => s.isDirectory(), () => false))) {
          return;
        }
        throw err;
      }
    },
    async presign() {
      throw new BlobPresignUnsupportedError();
    },
  };
}
