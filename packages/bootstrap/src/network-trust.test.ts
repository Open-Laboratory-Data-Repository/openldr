import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CERT_A, CERT_B, CERT_OLD, FAKE_KEY } from './network-trust.fixtures';
import {
  createTrustService,
  KEY_TRUST_LOADED,
  nodeExtraCertificates,
  readLoadedTrust,
  readPeerCertificate,
  recordLoadedTrust,
  TRUST_BUSY,
  TrustAuditFailed,
  TrustRefused,
  type LoadedTrust,
  type TrustActor,
} from './network-trust';

const NOW = new Date('2026-12-01T00:00:00Z');
const FP_A = new X509Certificate(CERT_A).fingerprint256;
const FP_B = new X509Certificate(CERT_B).fingerprint256;
const ACTOR: TrustActor = { actorType: 'user', actorId: 'u1', actorName: 'ada' };

interface Made {
  svc: ReturnType<typeof createTrustService>;
  file: string;
  dir: string;
  audits: Array<{ action: string; actor: TrustActor; fingerprint: string; subject: string }>;
}

type Transition = <T>(work: () => Promise<T>) => Promise<T>;

/** One thing at a time, in this process. It stands for the database lock that guards each short lock step; the db package proves that one on real PostgreSQL. */
function mutex(): Transition {
  let tail: Promise<unknown> = Promise.resolve();
  return (work) => {
    const run = tail.then(work, work);
    tail = run.catch(() => {});
    return run;
  };
}

function make(o: { content?: string | null; file?: string | null; extra?: string | null; loaded?: LoadedTrust | (() => Promise<LoadedTrust>); peer?: string | undefined; auditFails?: boolean; lockWaitMs?: number; now?: () => Date; transition?: Transition } = {}): Made {
  const dir = mkdtempSync(join(tmpdir(), 'trust-'));
  const file = join(dir, 'ca.pem');
  if (o.content !== null) writeFileSync(file, o.content ?? '');
  const audits: Made['audits'] = [];
  const svc = createTrustService({
    file: o.file === null ? undefined : (o.file ?? file),
    nodeExtraCaFile: o.extra === null ? undefined : (o.extra ?? file),
    loaded: typeof o.loaded === 'function' ? o.loaded : async () => (o.loaded as LoadedTrust | undefined) ?? { known: true, pems: [], since: '2026-11-30T00:00:00.000Z' },
    readPeer: async () => o.peer,
    lockWaitMs: o.lockWaitMs,
    transition: o.transition ?? mutex(),
    audit: async (action, actor, fingerprint, subject) => {
      if (o.auditFails) throw new Error('audit down');
      audits.push({ action, actor, fingerprint, subject });
    },
    now: o.now ?? (() => NOW),
  });
  return { svc, file, dir, audits };
}

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return e instanceof TrustRefused ? e.code : `other: ${String(e)}`;
  }
};

describe('read', () => {
  it('reads one certificate and gives its fingerprint, subject and end date', () => {
    const [c, ...rest] = make().svc.read(CERT_A);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ fingerprint: FP_A, subject: 'test-a.example', expired: false });
    expect(new Date(c!.validTo).getUTCFullYear()).toBeGreaterThan(2100);
    expect(new X509Certificate(c!.pem).fingerprint256).toBe(FP_A);
  });

  it('reads two certificates from one text', () => {
    expect(make().svc.read(`${CERT_A}\n${CERT_B}`).map((c) => c.fingerprint)).toEqual([FP_A, FP_B]);
  });

  it.each(['hello', '', '   \n'])('refuses text that is not a certificate: %j', (text) => {
    expect(() => make().svc.read(text)).toThrow(TrustRefused);
    try {
      make().svc.read(text);
    } catch (e) {
      expect((e as TrustRefused).code).toBe('not-a-certificate');
    }
  });

  it('refuses a certificate with a bad block or stray text beside it', () => {
    const bad = '-----BEGIN CERTIFICATE-----\nnot base64 of a certificate\n-----END CERTIFICATE-----\n';
    for (const text of [`${CERT_A}${bad}`, `${CERT_A}stray words`, `-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n${CERT_A}`]) {
      let got = '';
      try {
        make().svc.read(text);
      } catch (e) {
        got = (e as TrustRefused).code;
      }
      expect(got).toBe('not-a-certificate');
    }
  });

  it('refuses a private key, alone or beside a certificate, whatever its kind', () => {
    const kinds = ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY'];
    for (const kind of kinds) {
      const key = FAKE_KEY.replaceAll('PRIVATE KEY', kind);
      for (const text of [key, `${CERT_A}${key}`, `${key}${CERT_A}`]) {
        let got = '';
        try {
          make().svc.read(text);
        } catch (e) {
          got = (e as TrustRefused).code;
        }
        expect(got).toBe('private-key');
      }
    }
  });

  it('puts none of the refused text in the error', () => {
    try {
      make().svc.read(`${CERT_A}${FAKE_KEY}`);
    } catch (e) {
      const said = `${String(e)} ${(e as Error).stack ?? ''} ${JSON.stringify(e)}`;
      expect(said).not.toContain('VGhpcyBpcyBub3Q');
      expect(said).not.toContain('BEGIN');
    }
  });

  it('marks an expired certificate', () => {
    expect(make().svc.read(CERT_OLD)[0]).toMatchObject({ expired: true, subject: 'test-old.example' });
  });
});

describe('status', () => {
  it('is editable when both settings name the same file', async () => {
    expect(await make().svc.status()).toEqual({ mode: 'editable' });
  });

  it('is editable when one of the two paths is written relative', async () => {
    const m = make();
    const svc = createTrustService({
      file: m.file,
      nodeExtraCaFile: relative(process.cwd(), m.file),
      loaded: async () => ({ known: false }),
      readPeer: async () => undefined,
      transition: mutex(),
      audit: async () => {},
      now: () => NOW,
    });
    expect(await svc.status()).toEqual({ mode: 'editable' });
  });

  it('is editable when the file does not exist yet', async () => {
    expect(await make({ content: null }).svc.status()).toEqual({ mode: 'editable' });
  });

  it('is not-configured when neither setting is there', async () => {
    expect(await make({ file: null, extra: null }).svc.status()).toEqual({ mode: 'not-configured' });
  });

  it('is set-outside when only NODE_EXTRA_CA_CERTS is set', async () => {
    expect(await make({ file: null }).svc.status()).toEqual({ mode: 'set-outside' });
  });

  it('is set-outside when NODE_EXTRA_CA_CERTS names another file', async () => {
    expect(await make({ extra: '/somewhere/else.pem' }).svc.status()).toEqual({ mode: 'set-outside' });
  });

  it('is set-outside when TRUSTED_CA_FILE is set and Node was started without it', async () => {
    // Node would not load the file, so managing it here would change nothing.
    expect(await make({ extra: null }).svc.status()).toEqual({ mode: 'set-outside' });
  });

  it('is damaged when the file holds text that is not a certificate', async () => {
    expect(await make({ content: `${CERT_A}garbage` }).svc.status()).toEqual({ mode: 'damaged' });
    expect(await make({ content: `${CERT_A}${FAKE_KEY}` }).svc.status()).toEqual({ mode: 'damaged' });
  });
});

describe('list', () => {
  const since = '2026-11-30T00:00:00.000Z';

  it('shows a certificate the server loaded and the file holds as in-use', async () => {
    const m = make({ content: CERT_A, loaded: { known: true, pems: [CERT_A], since } });
    expect(await m.svc.list()).toMatchObject([{ fingerprint: FP_A, state: 'in-use' }]);
  });

  it('shows one in the file that the server did not load as added', async () => {
    const m = make({ content: `${CERT_A}${CERT_B}`, loaded: { known: true, pems: [CERT_A], since } });
    expect((await m.svc.list()).map((c) => [c.subject, c.state])).toEqual([
      ['test-a.example', 'in-use'],
      ['test-b.example', 'added'],
    ]);
  });

  it('shows one the server loaded that left the file as removed', async () => {
    const m = make({ content: CERT_B, loaded: { known: true, pems: [CERT_A, CERT_B], since } });
    expect((await m.svc.list()).map((c) => [c.subject, c.state])).toEqual([
      ['test-a.example', 'removed'],
      ['test-b.example', 'in-use'],
    ]);
  });

  it('shows what the server loaded as outside when the file is not managed', async () => {
    const m = make({ file: null, loaded: { known: true, pems: [CERT_A], since } });
    expect(await m.svc.list()).toMatchObject([{ fingerprint: FP_A, state: 'outside' }]);
  });

  it('shows unknown when nobody can say what the server loaded', async () => {
    const m = make({ content: CERT_A, loaded: { known: false } });
    expect(await m.svc.list()).toMatchObject([{ fingerprint: FP_A, state: 'unknown' }]);
  });

  it('lists nothing, not a guess, when the file is not managed and the loaded list is not known', async () => {
    expect(await make({ file: null, loaded: { known: false } }).svc.list()).toEqual([]);
  });

  it('still lists the good certificates of a damaged file', async () => {
    const m = make({ content: `${CERT_A}garbage\n${CERT_B}`, loaded: { known: true, pems: [CERT_A], since } });
    expect((await m.svc.list()).map((c) => c.subject)).toEqual(['test-a.example', 'test-b.example']);
  });

  it('sorts by subject, then fingerprint, and marks an expired one', async () => {
    const m = make({ content: `${CERT_OLD}${CERT_B}${CERT_A}` });
    const rows = await m.svc.list();
    expect(rows.map((c) => c.subject)).toEqual(['test-a.example', 'test-b.example', 'test-old.example']);
    expect(rows[2]).toMatchObject({ expired: true });
  });

  it('lists a certificate once when the file holds it twice', async () => {
    expect(await make({ content: `${CERT_A}${CERT_A}` }).svc.list()).toHaveLength(1);
  });
});

describe('add and remove', () => {
  it('adds a certificate, writes the file, and audits the fingerprint', async () => {
    const m = make();
    const added = await m.svc.add(CERT_A, ACTOR);
    expect(added).toMatchObject({ fingerprint: FP_A, subject: 'test-a.example', state: 'added' });
    expect(m.svc.read(readFileSync(m.file, 'utf8')).map((c) => c.fingerprint)).toEqual([FP_A]);
    expect(m.audits).toEqual([{ action: 'network.trust.add', actor: ACTOR, fingerprint: FP_A, subject: 'test-a.example' }]);
  });

  it('makes the folder and the file when they are missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-'));
    const file = join(dir, 'trust', 'ca.pem');
    const m = make({ file, extra: file, content: null });
    await m.svc.add(CERT_A, ACTOR);
    expect(readFileSync(file, 'utf8')).toContain('BEGIN CERTIFICATE');
  });

  it('keeps what was there and adds the new one after it', async () => {
    const m = make({ content: CERT_A });
    await m.svc.add(CERT_B, ACTOR);
    expect(m.svc.read(readFileSync(m.file, 'utf8')).map((c) => c.fingerprint)).toEqual([FP_A, FP_B]);
  });

  it('refuses a duplicate', async () => {
    const m = make({ content: CERT_A });
    expect(await code(m.svc.add(CERT_A, ACTOR))).toBe('duplicate');
    expect(m.audits).toEqual([]);
  });

  it('refuses text with two certificates, a key, or no certificate', async () => {
    const m = make();
    expect(await code(m.svc.add(`${CERT_A}${CERT_B}`, ACTOR))).toBe('not-a-certificate');
    expect(await code(m.svc.add(`${CERT_A}${FAKE_KEY}`, ACTOR))).toBe('private-key');
    expect(await code(m.svc.add('hello', ACTOR))).toBe('not-a-certificate');
    expect(readFileSync(m.file, 'utf8')).toBe('');
  });

  it('accepts an expired certificate', async () => {
    const m = make();
    expect(await m.svc.add(CERT_OLD, ACTOR)).toMatchObject({ expired: true });
  });

  it('removes by fingerprint and audits it', async () => {
    const m = make({ content: `${CERT_A}${CERT_B}` });
    await m.svc.remove(FP_A, ACTOR);
    expect(m.svc.read(readFileSync(m.file, 'utf8')).map((c) => c.fingerprint)).toEqual([FP_B]);
    expect(m.audits).toEqual([{ action: 'network.trust.remove', actor: ACTOR, fingerprint: FP_A, subject: 'test-a.example' }]);
  });

  it('leaves an empty file when the last certificate is removed', async () => {
    const m = make({ content: CERT_A });
    await m.svc.remove(FP_A, ACTOR);
    expect(readFileSync(m.file, 'utf8')).toBe('');
    expect(await m.svc.status()).toEqual({ mode: 'editable' });
  });

  it('refuses to remove one that is not there', async () => {
    expect(await code(make({ content: CERT_A }).svc.remove(FP_B, ACTOR))).toBe('not-found');
  });

  it('refuses both when the file is not managed, and leaves it untouched', async () => {
    for (const o of [{ file: null }, { extra: '/somewhere/else.pem' }, { file: null, extra: null }] as const) {
      const m = make({ ...o, content: CERT_A });
      expect(await code(m.svc.add(CERT_B, ACTOR))).toBe('read-only');
      expect(await code(m.svc.remove(FP_A, ACTOR))).toBe('read-only');
      expect(readFileSync(m.file, 'utf8')).toBe(CERT_A);
    }
  });

  it('refuses both when the file is damaged, and leaves it untouched', async () => {
    const content = `${CERT_A}garbage`;
    const m = make({ content });
    expect(await code(m.svc.add(CERT_B, ACTOR))).toBe('damaged');
    expect(await code(m.svc.remove(FP_A, ACTOR))).toBe('damaged');
    expect(readFileSync(m.file, 'utf8')).toBe(content);
  });

  it('keeps both certificates when two adds run at once', async () => {
    const m = make();
    await Promise.all([m.svc.add(CERT_A, ACTOR), m.svc.add(CERT_B, ACTOR)]);
    expect(m.svc.read(readFileSync(m.file, 'utf8')).map((c) => c.fingerprint).sort()).toEqual([FP_A, FP_B].sort());
  });

  it('keeps both certificates when two services add at once', async () => {
    // The CLI and the server are two processes on one file.
    const m = make();
    const other = createTrustService({
      file: m.file,
      nodeExtraCaFile: m.file,
      loaded: async () => ({ known: false }),
      readPeer: async () => undefined,
      transition: mutex(),
      audit: async () => {},
      now: () => NOW,
    });
    await Promise.all([m.svc.add(CERT_A, ACTOR), other.add(CERT_B, ACTOR)]);
    expect(m.svc.read(readFileSync(m.file, 'utf8')).map((c) => c.fingerprint).sort()).toEqual([FP_A, FP_B].sort());
  });

  it('waits for a lock another process holds, then reads the file as that process left it', async () => {
    const m = make();
    const lock = `${m.file}.lock`;
    writeFileSync(lock, JSON.stringify({ token: 'other' }));
    const adding = m.svc.add(CERT_A, ACTOR);
    await new Promise((r) => setTimeout(r, 150));
    expect(readFileSync(m.file, 'utf8')).toBe('');
    // The other process finishes its change and lets go.
    writeFileSync(m.file, CERT_B);
    rmSync(lock);
    await adding;
    expect(m.svc.read(readFileSync(m.file, 'utf8')).map((c) => c.fingerprint).sort()).toEqual([FP_A, FP_B].sort());
    expect(readdirSync(m.dir)).toEqual(['ca.pem']);
  });

  it('refuses as busy when the lock is not let go in time, and touches nothing', async () => {
    const m = make({ content: CERT_A, lockWaitMs: 150 });
    const lock = `${m.file}.lock`;
    writeFileSync(lock, 'held');
    expect(await code(m.svc.add(CERT_B, ACTOR))).toBe('busy');
    expect(await code(m.svc.remove(FP_A, ACTOR))).toBe('busy');
    await expect(m.svc.add(CERT_B, ACTOR)).rejects.toThrow(TRUST_BUSY);
    expect(readFileSync(m.file, 'utf8')).toBe(CERT_A);
    expect(readFileSync(lock, 'utf8')).toBe('held');
    expect(m.audits).toEqual([]);
  });

  it('never takes a lock because it is old', async () => {
    // Age is no proof that the holder stopped. Only a person may say so, with unlock.
    const m = make({ lockWaitMs: 150 });
    const lock = `${m.file}.lock`;
    writeFileSync(lock, 'held');
    const past = new Date(Date.now() - 3_600_000);
    utimesSync(lock, past, past);
    expect(await code(m.svc.add(CERT_A, ACTOR))).toBe('busy');
    expect(readFileSync(lock, 'utf8')).toBe('held');
    expect(readFileSync(m.file, 'utf8')).toBe('');
  });

  it('writes nothing, and leaves the lock alone, when its lock was taken away during the change', async () => {
    // A person unlocked while this change was paused, and another change now holds the lock.
    let lock = '';
    let asked = 0;
    const m = make({
      // The service asks the time twice in an add: when it reads the pasted certificate, and when
      // it reads the file under the lock. The second is after the read and before the write.
      now: () => {
        if (lock !== '' && ++asked === 2) writeFileSync(lock, JSON.stringify({ token: 'someone else' }));
        return NOW;
      },
    });
    lock = `${m.file}.lock`;
    expect(await code(m.svc.add(CERT_A, ACTOR))).toBe('busy');
    expect(readFileSync(m.file, 'utf8')).toBe('');
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual({ token: 'someone else' });
    expect(m.audits).toEqual([]);
    expect(readdirSync(m.dir).sort()).toEqual(['ca.pem', 'ca.pem.lock']);
  });

  it('does not remove a new lock when its own was unlocked and replaced just as it finished', async () => {
    // The change is done and about to let go. In that moment its lock is unlocked by a person and
    // a new change makes its own. Letting go must not take the new one.
    let lock = '';
    let asked = 0;
    const m = make({
      now: () => {
        // The second time the service asks the time it is under the lock. Swap the lock for
        // another holder's there.
        if (lock !== '' && ++asked === 2) writeFileSync(lock, JSON.stringify({ token: 'new holder' }));
        return NOW;
      },
    });
    lock = `${m.file}.lock`;
    // A duplicate is refused inside the lock, so the change ends without a write and lets go.
    writeFileSync(m.file, CERT_A);
    expect(await code(m.svc.add(CERT_A, ACTOR))).toBe('duplicate');
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual({ token: 'new holder' });
    expect(readdirSync(m.dir).sort()).toEqual(['ca.pem', 'ca.pem.lock']);
  });

  it('writes nothing when the file changed between its read and its write', async () => {
    let file = '';
    let asked = 0;
    const m = make({
      now: () => {
        if (file !== '' && ++asked === 2) writeFileSync(file, CERT_B);
        return NOW;
      },
    });
    file = m.file;
    expect(await code(m.svc.add(CERT_A, ACTOR))).toBe('busy');
    expect(readFileSync(m.file, 'utf8')).toBe(CERT_B);
    expect(m.audits).toEqual([]);
    expect(readdirSync(m.dir)).toEqual(['ca.pem']);
  });

  it('does not write over a file another process left under a temp name', async () => {
    // The temp name is made new each time and opened so that an existing file is never reused.
    const m = make();
    writeFileSync(`${m.file}.${process.pid}.tmp`, 'someone else');
    await m.svc.add(CERT_A, ACTOR);
    expect(readFileSync(`${m.file}.${process.pid}.tmp`, 'utf8')).toBe('someone else');
    expect(readdirSync(m.dir).sort()).toEqual(['ca.pem', `ca.pem.${process.pid}.tmp`]);
  });

  it('says in-use for a certificate the server loaded, that was removed and is added again', async () => {
    const m = make({ loaded: { known: true, pems: [CERT_A], since: '2026-11-30T00:00:00.000Z' } });
    expect(await m.svc.add(CERT_A, ACTOR)).toMatchObject({ fingerprint: FP_A, state: 'in-use' });
    expect(await m.svc.add(CERT_B, ACTOR)).toMatchObject({ fingerprint: FP_B, state: 'added' });
  });

  it('says unknown for an added certificate when nobody can say what the server loaded', async () => {
    const m = make({ loaded: { known: false } });
    const added = await m.svc.add(CERT_A, ACTOR);
    expect(added.state).toBe('unknown');
    expect(await m.svc.list()).toEqual([added]);
  });

  it('leaves no temp file behind', async () => {
    const m = make();
    await m.svc.add(CERT_A, ACTOR);
    await m.svc.remove(FP_A, ACTOR);
    expect(readdirSync(m.dir)).toEqual(['ca.pem']);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('writes no audit row when the write fails', async () => {
    const m = make();
    chmodSync(m.dir, 0o500);
    try {
      expect(await code(m.svc.add(CERT_A, ACTOR))).toMatch(/^other: /);
      expect(m.audits).toEqual([]);
    } finally {
      chmodSync(m.dir, 0o700);
    }
    expect(readdirSync(m.dir)).toEqual(['ca.pem']);
  });

  it('adds a valid certificate after a refused one', async () => {
    const m = make();
    expect(await code(m.svc.add('hello', ACTOR))).toBe('not-a-certificate');
    await m.svc.add(CERT_A, ACTOR);
    expect(await m.svc.list()).toHaveLength(1);
  });

  it('says the change is made and the audit row is not, when the audit row cannot be written', async () => {
    const m = make({ auditFails: true });
    const err = await m.svc.add(CERT_A, ACTOR).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrustAuditFailed);
    expect(err).toMatchObject({ action: 'network.trust.add', fingerprint: FP_A, subject: 'test-a.example', actor: ACTOR });
    expect((err as TrustAuditFailed).cause).toMatchObject({ message: 'audit down' });
    expect(readFileSync(m.file, 'utf8')).toBe(CERT_A);

    const gone = await m.svc.remove(FP_A, ACTOR).catch((e: unknown) => e);
    expect(gone).toBeInstanceOf(TrustAuditFailed);
    expect(gone).toMatchObject({ action: 'network.trust.remove', fingerprint: FP_A, subject: 'test-a.example', actor: ACTOR });
    expect(readFileSync(m.file, 'utf8')).toBe('');
  });

  it('changes nothing when it cannot read what the server loaded', async () => {
    // Read before the change. After it, a failure here would hide a change that was made.
    const m = make({ loaded: async () => { throw new Error('settings down'); } });
    await expect(m.svc.add(CERT_A, ACTOR)).rejects.toThrow('settings down');
    expect(readFileSync(m.file, 'utf8')).toBe('');
    expect(m.audits).toEqual([]);
  });

  it('a refusal is never reported as an audit failure', async () => {
    const m = make({ content: CERT_A, auditFails: true });
    expect(await code(m.svc.add(CERT_A, ACTOR))).toBe('duplicate');
    expect(await code(m.svc.remove(FP_B, ACTOR))).toBe('not-found');
  });
});

describe('preview', () => {
  it('gives the certificate the address presents', async () => {
    const m = make({ peer: CERT_A });
    expect(await m.svc.preview('hub.district:8443')).toMatchObject({ fingerprint: FP_A, subject: 'test-a.example' });
  });

  it('asks the given host and port, and port 443 when none is given', async () => {
    const asked: Array<[string, number]> = [];
    const svc = createTrustService({
      file: undefined,
      nodeExtraCaFile: undefined,
      loaded: async () => ({ known: false }),
      readPeer: async (host, port) => {
        asked.push([host, port]);
        return CERT_A;
      },
      transition: mutex(),
      audit: async () => {},
      now: () => NOW,
    });
    await svc.preview(' Hub.District:8443 ');
    await svc.preview('hub.district');
    await svc.preview('192.168.1.20:3443');
    await svc.preview('[::1]:3443');
    expect(asked).toEqual([['hub.district', 8443], ['hub.district', 443], ['192.168.1.20', 3443], ['::1', 3443]]);
  });

  it('throws no-answer when nothing answers', async () => {
    expect(await code(make({ peer: undefined }).svc.preview('hub.district'))).toBe('no-answer');
  });

  it.each(['https://x', 'x/y', 'x:0', 'x:70000', 'x:abc', '', 'a b', 'user@x'])('refuses the address %j as a caller mistake', async (address) => {
    await expect(make({ peer: CERT_A }).svc.preview(address)).rejects.toThrow('Type a host name, or a host name and a port.');
  });
});

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('readPeerCertificate', () => {
  it.skipIf(!hasOpenssl)('reads the certificate of a self-signed server without trusting it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'peer-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2', '-subj', '/CN=peer.example', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
    const cert = readFileSync(join(dir, 'c.pem'), 'utf8');
    let requests = 0;
    const server = https.createServer({ cert, key: readFileSync(join(dir, 'k.pem')) }, (_req, res) => {
      requests += 1;
      res.end('ok');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const pem = await readPeerCertificate('127.0.0.1', (server.address() as AddressInfo).port);
      expect(new X509Certificate(pem!).fingerprint256).toBe(new X509Certificate(cert).fingerprint256);
      // A TLS handshake only. No web request was sent.
      expect(requests).toBe(0);
    } finally {
      server.close();
    }
  });

  it('gives undefined when nothing listens', async () => {
    const s = https.createServer();
    s.listen(0, '127.0.0.1');
    await once(s, 'listening');
    const port = (s.address() as AddressInfo).port;
    s.close();
    await once(s, 'close');
    expect(await readPeerCertificate('127.0.0.1', port)).toBeUndefined();
  });
});

describe('what the server loaded', () => {
  function settings(): { get(key: string): Promise<{ value: string } | null>; set(key: string, value: string, by: string | null): Promise<void>; rows: Map<string, string> } {
    const rows = new Map<string, string>();
    return {
      rows,
      get: async (key) => (rows.has(key) ? { value: rows.get(key)! } : null),
      set: async (key, value) => void rows.set(key, value),
    };
  }

  it('records what Node reports at the server start, and any process reads it back', async () => {
    const s = settings();
    await recordLoadedTrust(s, () => [CERT_A, CERT_B], NOW);
    expect(await readLoadedTrust(s)).toEqual({ known: true, pems: [CERT_A, CERT_B], since: NOW.toISOString() });
    expect([...s.rows.keys()]).toEqual([KEY_TRUST_LOADED]);
  });

  it('records an empty list as known: Node loaded nothing extra', async () => {
    const s = settings();
    await recordLoadedTrust(s, () => [], NOW);
    expect(await readLoadedTrust(s)).toEqual({ known: true, pems: [], since: NOW.toISOString() });
  });

  it('records not known when this Node cannot report it', async () => {
    const s = settings();
    await recordLoadedTrust(s, undefined, NOW);
    expect(await readLoadedTrust(s)).toEqual({ known: false });
  });

  it('records not known when asking Node throws', async () => {
    const s = settings();
    await recordLoadedTrust(s, () => { throw new Error('no'); }, NOW);
    expect(await readLoadedTrust(s)).toEqual({ known: false });
  });

  it('reads not known when no server has recorded anything, or the record is damaged', async () => {
    const s = settings();
    expect(await readLoadedTrust(s)).toEqual({ known: false });
    for (const bad of ['{ not json', '[]', '{"since":1,"pems":[]}', '{"since":"x","pems":"y"}', '{"since":"x","pems":[1]}']) {
      s.rows.set(KEY_TRUST_LOADED, bad);
      expect(await readLoadedTrust(s)).toEqual({ known: false });
    }
  });

  it('a new start replaces the old record', async () => {
    const s = settings();
    await recordLoadedTrust(s, () => [CERT_A], NOW);
    await recordLoadedTrust(s, undefined, NOW);
    expect(await readLoadedTrust(s)).toEqual({ known: false });
  });

  it('asks this Node, which loaded no extra certificates in a test run', () => {
    const extra = nodeExtraCertificates();
    // Node 22.15 and later have the function. An older Node gives undefined, and the record says "not known".
    if (extra === undefined) return;
    expect(Array.isArray(extra())).toBe(true);
  });

  it('a real Node started with NODE_EXTRA_CA_CERTS reports that file, and the record reads back as the same certificates', async () => {
    if (nodeExtraCertificates() === undefined) return;
    const dir = mkdtempSync(join(tmpdir(), 'trust-node-'));
    const file = join(dir, 'trust.pem');
    writeFileSync(file, CERT_A + CERT_B);
    const out = execFileSync(process.execPath, ['-e', "process.stdout.write(JSON.stringify(require('node:tls').getCACertificates('extra')))"], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: file },
      encoding: 'utf8',
    });
    const reported = JSON.parse(out) as string[];
    const s = settings();
    await recordLoadedTrust(s, () => reported, NOW);
    const loaded = await readLoadedTrust(s);
    expect(loaded.known).toBe(true);
    const m = make({ content: CERT_A, loaded });
    expect((await m.svc.list()).map((c) => [c.fingerprint, c.state])).toEqual([[FP_A, 'in-use'], [FP_B, 'removed']]);
  });
});

describe('the 10 second limit of readPeerCertificate', () => {
  it('counts from the start, also when the other side keeps sending a little', async () => {
    // Not a TLS server: it opens one long handshake record, then sends a byte of it every 20 ms and
    // never finishes. A limit that only counts silence would never end.
    const sockets = new Set<net.Socket>();
    const timers = new Set<NodeJS.Timeout>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.write(Buffer.from([0x16, 0x03, 0x03, 0x40, 0x00]));
      const t = setInterval(() => socket.write(Buffer.from([0x00])), 20);
      timers.add(t);
      socket.on('close', () => clearInterval(t));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const started = Date.now();
      expect(await readPeerCertificate('127.0.0.1', (server.address() as AddressInfo).port, 200)).toBeUndefined();
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      for (const t of timers) clearInterval(t);
      for (const sk of sockets) sk.destroy();
      server.close();
    }
  });

  it('gives undefined, and nothing fails later, when the connection cannot even be made', async () => {
    // Node refuses port 70000 at once, before there is a socket for the timer to close.
    const failures: unknown[] = [];
    const onFail = (e: unknown): void => void failures.push(e);
    process.on('uncaughtException', onFail);
    try {
      expect(await readPeerCertificate('127.0.0.1', 70000, 30)).toBeUndefined();
      await new Promise((r) => setTimeout(r, 120));
      expect(failures).toEqual([]);
    } finally {
      process.off('uncaughtException', onFail);
    }
  });
});

describe('a lock left behind', () => {
  const old = (lock: string, ms: number): void => {
    const past = new Date(Date.now() - ms);
    utimesSync(lock, past, past);
  };

  it('status shows no lock when there is none', async () => {
    expect(await make().svc.status()).toEqual({ mode: 'editable' });
  });

  it('status shows a lock, and calls it stuck once it is older than 30 seconds', async () => {
    const m = make();
    const lock = `${m.file}.lock`;
    writeFileSync(lock, 'held');
    const fresh = await m.svc.status();
    expect(fresh).toMatchObject({ mode: 'editable', lock: { stuck: false } });
    old(lock, 31_000);
    const stuck = await m.svc.status();
    expect(stuck.lock).toMatchObject({ stuck: true });
    expect(Date.now() - new Date(stuck.lock!.since).getTime()).toBeGreaterThanOrEqual(31_000);
  });

  it('unlock removes a stuck lock, audits it, and the next change goes through', async () => {
    const m = make({ lockWaitMs: 150 });
    const lock = `${m.file}.lock`;
    writeFileSync(lock, 'held');
    old(lock, 60_000);
    expect(await m.svc.unlock(ACTOR)).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(m.audits).toMatchObject([{ action: 'network.trust.unlock', actor: ACTOR, fingerprint: 'lock' }]);
    await m.svc.add(CERT_A, ACTOR);
    expect(await m.svc.status()).toEqual({ mode: 'editable' });
  });

  it('unlock refuses a lock that is not stuck, and leaves it', async () => {
    const m = make();
    const lock = `${m.file}.lock`;
    writeFileSync(lock, 'held');
    expect(await code(m.svc.unlock(ACTOR))).toBe('busy');
    expect(existsSync(lock)).toBe(true);
    expect(m.audits).toEqual([]);
  });

  it('unlock does nothing and audits nothing when there is no lock', async () => {
    const m = make();
    expect(await m.svc.unlock(ACTOR)).toBe(false);
    expect(m.audits).toEqual([]);
  });

  it('unlock is refused when the file is not managed', async () => {
    expect(await code(make({ file: null }).svc.unlock(ACTOR))).toBe('read-only');
  });

  it('shows a stuck lock on a damaged file too', async () => {
    const m = make({ content: 'garbage' });
    writeFileSync(`${m.file}.lock`, 'held');
    old(`${m.file}.lock`, 60_000);
    expect(await m.svc.status()).toMatchObject({ mode: 'damaged', lock: { stuck: true } });
  });

  it('makes, lets go of and unlocks the lock only inside the short step guard', async () => {
    // Each of those is a look at the lock file followed by a change to it. The guard keeps two
    // processes from doing them at the same moment.
    const steps: string[] = [];
    let lock = '';
    const inner = mutex();
    const m = make({
      lockWaitMs: 150,
      transition: (work) =>
        inner(async () => {
          steps.push(existsSync(lock) ? 'lock there' : 'no lock');
          return work();
        }),
    });
    lock = `${m.file}.lock`;
    await m.svc.add(CERT_A, ACTOR);
    expect(steps).toEqual(['no lock', 'lock there']);
    writeFileSync(lock, 'held');
    old(lock, 60_000);
    await m.svc.unlock(ACTOR);
    expect(steps).toEqual(['no lock', 'lock there', 'lock there']);
  });

  it('refuses as busy, with nothing changed and no lock made, when the guard cannot be had', async () => {
    const m = make({ content: CERT_A, transition: async () => { throw new TrustRefused('busy'); } });
    expect(await code(m.svc.add(CERT_B, ACTOR))).toBe('busy');
    expect(await code(m.svc.remove(FP_A, ACTOR))).toBe('busy');
    expect(readFileSync(m.file, 'utf8')).toBe(CERT_A);
    expect(readdirSync(m.dir)).toEqual(['ca.pem']);
    expect(m.audits).toEqual([]);
  });

  it('keeps the change and audits it when the guard fails as the change lets go', async () => {
    // The file is in place. Only letting go failed, so the lock stays and shows as stuck later.
    let calls = 0;
    const inner = mutex();
    const m = make({
      transition: (work) => {
        if (++calls === 2) return Promise.reject(new Error('database gone'));
        return inner(work);
      },
    });
    expect(await m.svc.add(CERT_A, ACTOR)).toMatchObject({ fingerprint: FP_A });
    expect(readFileSync(m.file, 'utf8')).toBe(CERT_A);
    expect(m.audits.map((a) => a.action)).toEqual(['network.trust.add']);
    expect(readdirSync(m.dir).sort()).toEqual(['ca.pem', 'ca.pem.lock']);
    expect(await m.svc.status()).toMatchObject({ lock: { stuck: false } });
  });

  it('a stale unlock leaves a fresh lock where it is', async () => {
    // The lock was judged stuck, then removed by someone else, and a new change made its own.
    const m = make();
    const lock = `${m.file}.lock`;
    writeFileSync(lock, JSON.stringify({ token: 'new holder' }));
    expect(await code(m.svc.unlock(ACTOR))).toBe('busy');
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual({ token: 'new holder' });
    expect(readdirSync(m.dir).sort()).toEqual(['ca.pem', 'ca.pem.lock']);
  });

  it('two unlocks at once remove one lock and audit once', async () => {
    const m = make();
    const lock = `${m.file}.lock`;
    writeFileSync(lock, 'held');
    old(lock, 60_000);
    const done = await Promise.all([m.svc.unlock(ACTOR), m.svc.unlock(ACTOR), m.svc.unlock(ACTOR)]);
    expect(done.filter(Boolean)).toHaveLength(1);
    expect(m.audits).toHaveLength(1);
    expect(readdirSync(m.dir)).toEqual(['ca.pem']);
  });
});
