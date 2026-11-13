import { chmod, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDataVersion, compareVersions, newerDataMessage, recordDataVersion } from './data-version.js';

const WINDOWS = process.platform === 'win32';
/** A file mode 000 is still readable by root, so that case is skipped there. */
const ROOT_USER = typeof process.getuid === 'function' && process.getuid() === 0;

let dir: string;
let paths: { versionFile: string };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sa-data-version-'));
  paths = { versionFile: join(dir, 'last-version.json') };
});

afterEach(async () => {
  await chmod(paths.versionFile, 0o600).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

async function recorded(): Promise<unknown> {
  return JSON.parse(await readFile(paths.versionFile, 'utf8'));
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

describe('compareVersions', () => {
  it.each([
    ['0.1.9', '0.1.11', -1],
    ['0.1.11', '0.1.9', 1],
    ['0.1.11', '0.1.11', 0],
    ['0.1.11-beta.1', '0.1.11', 0],
    ['0.1.11', '0.1.11-beta.1', 0],
    ['0.2.0', '0.1.11', 1],
    ['1.0.0', '0.99.99', 1],
    ['0.99.99', '1.0.0', -1],
  ] as const)('%s against %s is %d', (a, b, want) => {
    expect(compareVersions(a, b)).toBe(want);
  });

  it.each([
    ['', '0.1.11'],
    ['0.1.11', ''],
    ['1.2', '0.1.11'],
    ['v0.1.11', '0.1.11'],
    ['0.1.11', 'latest'],
  ])('is null for %j against %j', (a, b) => {
    expect(compareVersions(a, b)).toBeNull();
  });
});

describe('newerDataMessage', () => {
  it('names both versions', () => {
    expect(newerDataMessage('0.2.0', '0.1.11')).toBe(
      'This data folder was last used by OpenLDR 0.2.0. This is OpenLDR 0.1.11, which is older and cannot open it. Install OpenLDR 0.2.0 or newer.',
    );
  });
});

describe('checkDataVersion', () => {
  it('refuses a folder last started by a newer version, and writes nothing', async () => {
    await writeFile(paths.versionFile, '{"version":"0.2.0"}\n');
    await expect(checkDataVersion(paths, '0.1.11')).rejects.toThrowError(newerDataMessage('0.2.0', '0.1.11'));
    expect(await recorded()).toEqual({ version: '0.2.0' });
    expect(await readdir(dir)).toEqual(['last-version.json']);
  });

  it('compares the numbers, not the text', async () => {
    await writeFile(paths.versionFile, '{"version":"0.1.11"}\n');
    await expect(checkDataVersion(paths, '0.1.9')).rejects.toThrowError(newerDataMessage('0.1.11', '0.1.9'));
  });

  it.each([
    ['older', '0.1.9'],
    ['equal', '0.1.11'],
    ['equal apart from a pre-release tag', '0.1.11-beta.1'],
  ])('does not refuse a recorded version that is %s', async (_what, version) => {
    await writeFile(paths.versionFile, JSON.stringify({ version }));
    await expect(checkDataVersion(paths, '0.1.11')).resolves.toBeUndefined();
  });

  it('does not refuse when there is no file, and writes nothing', async () => {
    await expect(checkDataVersion(paths, '0.1.11')).resolves.toBeUndefined();
    expect(await readdir(dir)).toEqual([]);
  });

  it.each([
    ['not JSON', 'not json'],
    ['an empty file', ''],
    ['JSON with no version', '{}'],
    ['a version that is not text', '{"version":2}'],
    ['a version with no leading x.y.z', '{"version":"latest"}'],
  ])('does not refuse %s', async (_what, text) => {
    await writeFile(paths.versionFile, text);
    await expect(checkDataVersion(paths, '0.1.11')).resolves.toBeUndefined();
  });

  it.skipIf(WINDOWS || ROOT_USER)('does not refuse a file it cannot read', async () => {
    await writeFile(paths.versionFile, '{"version":"9.9.9"}');
    await chmod(paths.versionFile, 0o000);
    await expect(checkDataVersion(paths, '0.1.11')).resolves.toBeUndefined();
  });

  it.each([['0.0.0'], [''], ['unknown']])('does not refuse when the current version is %j', async (current) => {
    await writeFile(paths.versionFile, '{"version":"9.9.9"}');
    await expect(checkDataVersion(paths, current)).resolves.toBeUndefined();
  });
});

describe('recordDataVersion', () => {
  it.skipIf(WINDOWS)('writes the current version when there is no file, owner-only', async () => {
    await recordDataVersion(paths, '0.1.11');
    expect(await readFile(paths.versionFile, 'utf8')).toBe('{"version":"0.1.11"}\n');
    expect((await stat(paths.versionFile)).mode & 0o777).toBe(0o600);
    // The temp file is gone.
    expect(await readdir(dir)).toEqual(['last-version.json']);
  });

  it('replaces an older version', async () => {
    await writeFile(paths.versionFile, '{"version":"0.1.9"}\n', { mode: 0o644 });
    await recordDataVersion(paths, '0.1.11');
    expect(await recorded()).toEqual({ version: '0.1.11' });
    if (!WINDOWS) expect((await stat(paths.versionFile)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(['last-version.json']);
  });

  it('rewrites an equal version whose text differs', async () => {
    await writeFile(paths.versionFile, '{"version":"0.1.11-beta.1"}\n');
    await recordDataVersion(paths, '0.1.11');
    expect(await recorded()).toEqual({ version: '0.1.11' });
  });

  it('leaves the file alone when it already holds this version', async () => {
    await recordDataVersion(paths, '0.1.11');
    const past = new Date('2020-01-01T00:00:00.000Z');
    await utimes(paths.versionFile, past, past);
    await recordDataVersion(paths, '0.1.11');
    expect((await stat(paths.versionFile)).mtimeMs).toBe(past.getTime());
    expect(await recorded()).toEqual({ version: '0.1.11' });
  });

  it.each([
    ['not JSON', 'not json'],
    ['an empty file', ''],
    ['a version with no leading x.y.z', '{"version":"latest"}'],
  ])('replaces %s with the current version', async (_what, text) => {
    await writeFile(paths.versionFile, text);
    await recordDataVersion(paths, '0.1.11');
    expect(await recorded()).toEqual({ version: '0.1.11' });
  });

  it.skipIf(WINDOWS || ROOT_USER)('replaces a file it cannot read', async () => {
    await writeFile(paths.versionFile, '{"version":"0.1.9"}');
    await chmod(paths.versionFile, 0o000);
    await recordDataVersion(paths, '0.1.11');
    expect(await recorded()).toEqual({ version: '0.1.11' });
  });

  it.each([['0.0.0'], [''], ['unknown']])('writes nothing when the current version is %j', async (current) => {
    await recordDataVersion(paths, current);
    expect(await exists(paths.versionFile)).toBe(false);
    await writeFile(paths.versionFile, '{"version":"0.1.9"}\n');
    await recordDataVersion(paths, current);
    expect(await recorded()).toEqual({ version: '0.1.9' });
  });

  it('never lowers a newer recorded version', async () => {
    await writeFile(paths.versionFile, '{"version":"0.2.0"}\n');
    await recordDataVersion(paths, '0.1.11');
    expect(await recorded()).toEqual({ version: '0.2.0' });
  });
});
