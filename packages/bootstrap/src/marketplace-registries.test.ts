import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePublisherKeypair, packBundle } from '@openldr/marketplace';
import { makeMigratedDb } from '@openldr/db/testing';
import { createMarketplaceRegistries } from './marketplace-registries';

// market add (CLI) and Browse (studio) read registries through this one helper. These are the
// answers a person gets when they name a bundle by id.

let root: string;
const kp = generatePublisherKeypair();

async function bundle(dir: string, ref: string, id: string, version: string, ceVersion = '*') {
  await packBundle({
    manifest: {
      schemaVersion: 1, type: 'plugin', id, version,
      publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) },
      compatibility: { ceVersion },
      capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
      payload: { kind: 'plugin', wasmSha256: '0'.repeat(64) },
    },
    payload: new Uint8Array([1, 2, 3]), outDir: join(dir, ref),
    privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer,
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mkt-regs-'));
  await bundle(join(root, 'a'), 'lab-1', 'lab', '1.0.0');
  await bundle(join(root, 'a'), 'lab-2', 'lab', '2.0.0');
  await bundle(join(root, 'a'), 'later-1', 'later', '1.0.0', '>=999.0.0');
  await bundle(join(root, 'b'), 'lab-3', 'lab', '3.0.0');
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

async function regs(names: Array<'a' | 'b'>) {
  const db = await makeMigratedDb();
  const r = createMarketplaceRegistries({ internalDb: db, localRoot: '', maxPayloadBytes: async () => 64 * 1024 * 1024 });
  for (const n of names) await r.store.create({ id: `reg-${n}`, name: `Reg ${n.toUpperCase()}`, kind: 'local', location: join(root, n) });
  return r;
}

describe('createMarketplaceRegistries.findBundle', () => {
  it('finds the newest version, or the one asked for', async () => {
    const r = await regs(['a']);
    expect((await r.findBundle({ id: 'lab' }, '0.1.13')).bundle.manifest.version).toBe('2.0.0');
    expect((await r.findBundle({ id: 'lab', version: '1.0.0' }, '0.1.13')).bundle.manifest.version).toBe('1.0.0');
  });

  it('says when no enabled registry has it', async () => {
    const r = await regs(['a']);
    await expect(r.findBundle({ id: 'nope' }, '0.1.13')).rejects.toThrow('nope was not found in any enabled registry');
    await expect(r.findBundle({ id: 'lab', version: '9.9.9' }, '0.1.13')).rejects.toThrow('lab@9.9.9 was not found');
  });

  it('asks for --registry when two registries have it, and takes the named one', async () => {
    const r = await regs(['a', 'b']);
    await expect(r.findBundle({ id: 'lab' }, '0.1.13')).rejects.toThrow(/more than one registry: "Reg A" \(2\.0\.0\), "Reg B" \(3\.0\.0\)\. Choose one with --registry/);
    expect((await r.findBundle({ id: 'lab', registryName: 'reg b' }, '0.1.13')).bundle.manifest.version).toBe('3.0.0');
  });

  it('refuses a bundle this CE cannot run before downloading it', async () => {
    const r = await regs(['a']);
    await expect(r.findBundle({ id: 'later' }, '0.1.13')).rejects.toThrow('later 1.0.0 needs CE >=999.0.0; this CE is 0.1.13');
  });

  it('lists each bundle with whether this CE can run it', async () => {
    const r = await regs(['a']);
    const { listings } = await r.listAvailable('0.1.13');
    expect(listings.find((l) => l.id === 'later')).toMatchObject({ ceVersion: '>=999.0.0', compatible: false });
    expect(listings.find((l) => l.id === 'lab')).toMatchObject({ version: '2.0.0', compatible: true });
  });
});
