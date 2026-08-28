import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, createReadStream } from 'node:fs';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import AdmZip from 'adm-zip';
import { downloadAndExtract } from './terminology-dist-extract';

// Build a real 2-file zip in memory with adm-zip (the brief's hardcoded base64 fixture was
// fabricated and not a valid zip file, so we generate one instead).
function buildFixtureZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile('a.txt', Buffer.from('A'));
  zip.addFile('b/c.txt', Buffer.from('C'));
  return zip.toBuffer();
}

describe('downloadAndExtract', () => {
  it('streams a zip from the blob and extracts its entries to a dir', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kc-ext-'));
    const zipBytes = buildFixtureZip();
    const blob = { getStream: async () => Readable.from([zipBytes]) };
    const { distDir, cleanup } = await downloadAndExtract(blob, 'k.zip', workDir);
    expect(readFileSync(join(distDir, 'a.txt'), 'utf8')).toBe('A');
    expect(readFileSync(join(distDir, 'b', 'c.txt'), 'utf8')).toBe('C');
    await cleanup();
    expect(existsSync(distDir)).toBe(false);
  });
});

// Build a zip on disk with forward-slash entries, then expose it through a fake blob
// (getStream = plain file read) so downloadAndExtract's random-access path (unzipper.Open.file)
// can be exercised against a real on-disk zip, including zip-slip entries that a streaming
// Extract() would silently write outside distDir.
function makeZip(files: Record<string, string>, root: string): string {
  const zip = new AdmZip();
  for (const [rel, content] of Object.entries(files)) zip.addFile(rel, Buffer.from(content));
  const zipPath = join(root, 'dist.zip');
  zip.writeZip(zipPath);
  return zipPath;
}

function fakeBlob(zipPath: string) {
  return { async getStream() { return createReadStream(zipPath); } };
}

describe('downloadAndExtract (random-access)', () => {
  const dirs: string[] = [];
  afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

  it('extracts a nested-directory zip to the right paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ex-')); dirs.push(root);
    const zipPath = makeZip({
      'LoincTable/Loinc.csv': 'LOINC_NUM\n1-0\n',
      'AccessoryFiles/PartFile/x.csv': 'a,b\n1,2\n',
    }, root);
    const workDir = await mkdtemp(join(tmpdir(), 'wd-')); dirs.push(workDir);
    const { distDir, cleanup } = await downloadAndExtract(fakeBlob(zipPath), 'k', workDir);
    expect((await readFile(join(distDir, 'LoincTable', 'Loinc.csv'), 'utf8'))).toContain('LOINC_NUM');
    expect((await stat(join(distDir, 'AccessoryFiles', 'PartFile', 'x.csv'))).isFile()).toBe(true);
    await cleanup();
  });

  it('rejects a zip-slip entry escaping the dist dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ex-')); dirs.push(root);
    // Craft a real slip entry. addFile() sanitises a leading '../' out of the name, so add it
    // under a safe name and rewrite entryName afterwards: that setter stores the string verbatim,
    // which is what puts '../evil.txt' in both the local header and the central directory.
    const zip = new AdmZip();
    zip.addFile('evil.txt', Buffer.from('x'));
    zip.getEntries()[0].entryName = '../evil.txt';
    zip.addFile('ok.txt', Buffer.from('ok'));
    const zipPath = join(root, 'slip.zip');
    zip.writeZip(zipPath);
    const workDir = await mkdtemp(join(tmpdir(), 'wd-')); dirs.push(workDir);
    await expect(downloadAndExtract(fakeBlob(zipPath), 'k', workDir)).rejects.toThrow(/zip.?slip|outside|invalid entry/i);
  });
});
