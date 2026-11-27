import { X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTrustService, createWorkflowHosts, type AuditActor, type LoadedTrust } from '@openldr/bootstrap';
import { CERT_A, CERT_B, FAKE_KEY } from '../../bootstrap/src/network-trust.fixtures';
import {
  hostsAdd, hostsList, hostsRemove, hostsSelf, trustAdd, trustList, trustRemove, trustUnlock, type NetworkIo,
} from './network';

// The commands are run on the real two services, on a temp file and an in-memory settings table.
const FP_A = new X509Certificate(CERT_A).fingerprint256;
const FP_B = new X509Certificate(CERT_B).fingerprint256;
const CLI: AuditActor = { actorType: 'cli', actorId: null, actorName: 'grace' };

function setup(o: { content?: string; managed?: boolean; outside?: boolean; peer?: string; loaded?: LoadedTrust; serverList?: string; answer?: string | null; auditFails?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'net-cli-'));
  const file = join(dir, 'ca.pem');
  writeFileSync(file, o.content ?? '');
  const audits: Array<{ action: string; actor: AuditActor; detail: string }> = [];
  const note = async (action: string, actor: AuditActor, detail: string): Promise<void> => {
    if (o.auditFails) throw new Error('audit down');
    audits.push({ action, actor, detail });
  };
  let tail: Promise<unknown> = Promise.resolve();
  const trust = createTrustService({
    file: o.managed === false ? undefined : file,
    nodeExtraCaFile: o.outside ? '/somewhere/else.pem' : o.managed === false ? undefined : file,
    loaded: async () => o.loaded ?? { known: true, pems: [], since: '2026-11-30T00:00:00.000Z' },
    readPeer: async () => o.peer,
    transition: (work) => {
      const run = tail.then(work, work);
      tail = run.catch(() => {});
      return run;
    },
    lockWaitMs: 150,
    audit: (action, actor, fingerprint) => note(action, actor, fingerprint),
    now: () => new Date('2026-12-01T00:00:00Z'),
  });
  const rows = new Map<string, string>();
  const workflowHosts = createWorkflowHosts({
    appSettings: {
      get: async (key) => (rows.has(key) ? { key, value: rows.get(key)!, updatedAt: new Date(0), updatedBy: null } : null),
      getAll: async () => [],
      set: async (key, value) => void rows.set(key, value),
      update: async (key, change) => void rows.set(key, change(rows.get(key) ?? null)),
    },
    serverList: o.serverList ?? '',
    listenHost: '0.0.0.0',
    port: 3000,
    audit: note,
  });
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const io: NetworkIo = {
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    // null stands for "no terminal to ask on".
    ask: o.answer === null || o.answer === undefined
      ? undefined
      : async (question) => {
          asked.push(question);
          return o.answer as string;
        },
    actor: () => CLI,
  };
  const pem = join(dir, 'new.pem');
  return { trust, workflowHosts, io, out, err, asked, audits, file, dir, pem, lock: `${file}.lock` };
}

describe('openldr trust list', () => {
  it('formats the list with state, fingerprint, end date and subject', async () => {
    const s = setup({ content: CERT_A, loaded: { known: true, pems: [CERT_A], since: 'x' } });
    expect(await trustList(s.trust, { json: false }, s.io)).toBe(0);
    expect(s.out).toHaveLength(1);
    expect(s.out[0]).toMatch(new RegExp(`^in use\\s+${FP_A}\\s+\\d{4}-\\d{2}-\\d{2}\\s+test-a\\.example$`));
    expect(s.err).toEqual([]);
  });

  it('says so when no certificate is trusted', async () => {
    const s = setup();
    await trustList(s.trust, { json: false }, s.io);
    expect(s.out).toEqual(['(no trusted certificates)']);
  });

  it('names the mode on the first line when the file is not managed', async () => {
    const none = setup({ managed: false });
    await trustList(none.trust, { json: false }, none.io);
    expect(none.out[0]).toBe('Trusted certificates are not set up on this install: TRUSTED_CA_FILE is not set.');
    const outside = setup({ outside: true, loaded: { known: true, pems: [CERT_A], since: 'x' } });
    await trustList(outside.trust, { json: false }, outside.io);
    expect(outside.out[0]).toBe('Trusted certificates are set outside OpenLDR, with NODE_EXTRA_CA_CERTS. They cannot be changed here.');
    expect(outside.out[1]).toMatch(/^set outside\s/);
    const damaged = setup({ content: `${CERT_A}garbage` });
    await trustList(damaged.trust, { json: false }, damaged.io);
    expect(damaged.out[0]).toBe('The trust file holds text that is not a certificate. Fix the file first.');
  });

  it("reports the server's state, not its own", async () => {
    // The server's record holds A only. The file holds A and B.
    const s = setup({ content: CERT_A + CERT_B, loaded: { known: true, pems: [CERT_A], since: 'x' } });
    await trustList(s.trust, { json: false }, s.io);
    expect(s.out.map((l) => l.split(/\s{2,}/)[0])).toEqual(['in use', 'added, restart to use']);
  });

  it('shows a certificate that left the file and is still loaded', async () => {
    const s = setup({ content: '', loaded: { known: true, pems: [CERT_A], since: 'x' } });
    await trustList(s.trust, { json: false }, s.io);
    expect(s.out[0]).toMatch(/^removed, restart to drop\s/);
  });

  it('prints unknown when no server has reported', async () => {
    const s = setup({ content: CERT_A, loaded: { known: false } });
    await trustList(s.trust, { json: false }, s.io);
    expect(s.out[0]).toMatch(/^unknown\s/);
    expect(s.out[1]).toBe('No running server has reported what it loaded.');
  });

  it('prints the mode, the lock and the certificates as JSON', async () => {
    const s = setup({ content: CERT_A });
    expect(await trustList(s.trust, { json: true }, s.io)).toBe(0);
    expect(JSON.parse(s.out.join('\n'))).toEqual({ mode: 'editable', certificates: [expect.objectContaining({ fingerprint: FP_A, state: 'added' })] });
  });

  it('tells how to remove a lock left behind, and that its age proves nothing', async () => {
    const s = setup();
    writeFileSync(s.lock, 'held');
    await trustList(s.trust, { json: false }, s.io);
    expect(s.out.join('\n')).toContain('A change to the list is in progress.');
    const past = new Date(Date.now() - 60_000);
    utimesSync(s.lock, past, past);
    s.out.length = 0;
    await trustList(s.trust, { json: false }, s.io);
    const text = s.out.join('\n');
    expect(text).toContain('openldr trust unlock --force');
    expect(text).toContain('does not prove');
  });
});

describe('openldr trust add', () => {
  it('adds a certificate when the fingerprint matches, without asking', async () => {
    const s = setup({ answer: 'n' });
    writeFileSync(s.pem, CERT_A);
    // Written as people copy it: lower case, or with no colons.
    expect(await trustAdd(s.trust, { file: s.pem, fingerprint: FP_A.toLowerCase() }, s.io)).toBe(0);
    expect(await trustAdd(s.trust, { file: s.pem, fingerprint: FP_A.replaceAll(':', '') }, s.io)).toBe(1);
    expect(s.asked).toEqual([]);
    expect(readFileSync(s.file, 'utf8')).toBe(CERT_A);
    expect(s.out).toContain('Saved. Restart OpenLDR to use it.');
    expect(s.out).not.toContain('Saved. The running server already uses it.');
    expect(s.err).toEqual(['That certificate is already trusted.']);
    expect(s.audits).toEqual([{ action: 'network.trust.add', actor: CLI, detail: FP_A }]);
  });

  it('says what the running server does with the saved certificate', async () => {
    // Removed earlier and added again: the server still has it loaded, so no restart is needed.
    const used = setup({ loaded: { known: true, pems: [CERT_A], since: 'x' } });
    writeFileSync(used.pem, CERT_A);
    await trustAdd(used.trust, { file: used.pem, fingerprint: FP_A }, used.io);
    expect(used.out).toEqual(['Saved. The running server already uses it.']);
    const unknown = setup({ loaded: { known: false } });
    writeFileSync(unknown.pem, CERT_A);
    await trustAdd(unknown.trust, { file: unknown.pem, fingerprint: FP_A }, unknown.io);
    expect(unknown.out).toEqual(['Saved. No running server has reported what it loaded. A server uses it from its next start.']);
  });

  it('refuses when the fingerprint does not match and saves nothing', async () => {
    const s = setup();
    writeFileSync(s.pem, CERT_A);
    expect(await trustAdd(s.trust, { file: s.pem, fingerprint: FP_B }, s.io)).toBe(1);
    expect(s.err).toEqual(['The fingerprint does not match.']);
    expect(readFileSync(s.file, 'utf8')).toBe('');
    expect(s.audits).toEqual([]);
  });

  it('shows the fingerprint and the subject, asks, and saves on yes', async () => {
    const s = setup({ answer: 'y' });
    writeFileSync(s.pem, CERT_A);
    expect(await trustAdd(s.trust, { file: s.pem }, s.io)).toBe(0);
    expect(s.asked).toEqual(['Trust this certificate? (y/N) ']);
    expect(s.out.join('\n')).toContain(FP_A);
    expect(s.out.join('\n')).toContain('test-a.example');
    expect(readFileSync(s.file, 'utf8')).toBe(CERT_A);
  });

  it.each(['n', '', 'yes please', 'N'])('saves nothing when the answer is %j', async (answer) => {
    const s = setup({ answer });
    writeFileSync(s.pem, CERT_A);
    expect(await trustAdd(s.trust, { file: s.pem }, s.io)).toBe(1);
    expect(readFileSync(s.file, 'utf8')).toBe('');
    expect(s.err).toEqual(['Nothing was saved.']);
  });

  it('refuses to add without a prompt when it cannot ask', async () => {
    const s = setup({ answer: null });
    writeFileSync(s.pem, CERT_A);
    expect(await trustAdd(s.trust, { file: s.pem }, s.io)).toBe(1);
    expect(s.err).toEqual(['Give --fingerprint to add a certificate without a prompt.']);
    expect(readFileSync(s.file, 'utf8')).toBe('');
  });

  it('adds from an address only with a matching fingerprint', async () => {
    const s = setup({ peer: CERT_A, answer: 'y' });
    expect(await trustAdd(s.trust, { from: 'hub.district:8443' }, s.io)).toBe(1);
    expect(s.err).toEqual(['Give --fingerprint with --address. Read it from the server itself, not from this connection.']);
    expect(await trustAdd(s.trust, { from: 'hub.district:8443', fingerprint: FP_B }, s.io)).toBe(1);
    expect(s.err.at(-1)).toBe('The fingerprint does not match.');
    expect(readFileSync(s.file, 'utf8')).toBe('');
    expect(await trustAdd(s.trust, { from: 'hub.district:8443', fingerprint: FP_A }, s.io)).toBe(0);
    expect(readFileSync(s.file, 'utf8')).toBe(CERT_A);
    expect(s.asked).toEqual([]);
  });

  it('needs a file or an address, and not both', async () => {
    const s = setup();
    expect(await trustAdd(s.trust, {}, s.io)).toBe(1);
    expect(await trustAdd(s.trust, { file: s.pem, from: 'x' }, s.io)).toBe(1);
    expect(s.err).toEqual(['Give a certificate file, or --address <host:port>.', 'Give a certificate file, or --address <host:port>.']);
  });

  it('says so when the file cannot be read, or holds more than one certificate', async () => {
    const s = setup();
    expect(await trustAdd(s.trust, { file: join(s.dir, 'missing.pem'), fingerprint: FP_A }, s.io)).toBe(1);
    expect(s.err[0]).toBe('That file cannot be read.');
    writeFileSync(s.pem, CERT_A + CERT_B);
    expect(await trustAdd(s.trust, { file: s.pem, fingerprint: FP_A }, s.io)).toBe(1);
    expect(s.err[1]).toBe('That file holds 2 certificates. Add them one file at a time.');
  });

  it("prints the service's line for a private key and exits 1", async () => {
    const s = setup();
    writeFileSync(s.pem, CERT_A + FAKE_KEY);
    expect(await trustAdd(s.trust, { file: s.pem, fingerprint: FP_A }, s.io)).toBe(1);
    expect(s.err).toEqual(['That text holds a private key. Never paste a key. Nothing was saved.']);
    expect([...s.out, ...s.err].join('\n')).not.toContain('VGhpcyBpcyBub3Q');
    expect(readFileSync(s.file, 'utf8')).toBe('');
  });

  it('says the certificate is saved when only the audit row failed', async () => {
    const s = setup({ auditFails: true });
    writeFileSync(s.pem, CERT_A);
    expect(await trustAdd(s.trust, { file: s.pem, fingerprint: FP_A }, s.io)).toBe(1);
    expect(s.err).toEqual(['The change was made, but its audit record could not be written.']);
    expect(readFileSync(s.file, 'utf8')).toBe(CERT_A);
  });

  it('says how to see why the list cannot be changed', async () => {
    const s = setup({ managed: false });
    writeFileSync(s.pem, CERT_A);
    expect(await trustAdd(s.trust, { file: s.pem, fingerprint: FP_A }, s.io)).toBe(1);
    expect(s.err).toEqual(['Trusted certificates cannot be changed here.']);
  });
});

describe('openldr trust remove and unlock', () => {
  it('refuses to remove without --force', async () => {
    const s = setup({ content: CERT_A });
    expect(await trustRemove(s.trust, FP_A, { force: false }, s.io)).toBe(1);
    expect(s.err[0]).toMatch(/^Refusing to remove .* without --force\./);
    expect(readFileSync(s.file, 'utf8')).toBe(CERT_A);
  });

  it('removes with --force, by a fingerprint written in any case', async () => {
    const s = setup({ content: CERT_A + CERT_B });
    expect(await trustRemove(s.trust, FP_A.toLowerCase(), { force: true }, s.io)).toBe(0);
    expect(readFileSync(s.file, 'utf8')).toBe(CERT_B);
    expect(s.out).toEqual(['Removed. Restart OpenLDR to stop trusting it.']);
    expect(await trustRemove(s.trust, FP_A, { force: true }, s.io)).toBe(1);
    expect(s.err).toEqual(['That certificate is not in the list.']);
  });

  it('refuses to unlock without --force, and says what the age of a lock does not prove', async () => {
    const s = setup();
    writeFileSync(s.lock, 'held');
    const past = new Date(Date.now() - 60_000);
    utimesSync(s.lock, past, past);
    expect(await trustUnlock(s.trust, { force: false }, s.io)).toBe(1);
    expect(s.err.join(' ')).toContain('without --force');
    expect(s.err.join(' ')).toContain('does not prove');
    expect(existsSync(s.lock)).toBe(true);
  });

  it('unlocks with --force, refuses a lock younger than 30 seconds, and says when there is none', async () => {
    const s = setup();
    writeFileSync(s.lock, 'held');
    expect(await trustUnlock(s.trust, { force: true }, s.io)).toBe(1);
    expect(s.err).toEqual(['The trust file is busy. Try again.']);
    const past = new Date(Date.now() - 60_000);
    utimesSync(s.lock, past, past);
    expect(await trustUnlock(s.trust, { force: true }, s.io)).toBe(0);
    expect(s.out).toEqual(['Unlocked.']);
    expect(existsSync(s.lock)).toBe(false);
    expect(await trustUnlock(s.trust, { force: true }, s.io)).toBe(0);
    expect(s.out.at(-1)).toBe('There is no lock.');
    expect(s.audits).toEqual([{ action: 'network.trust.unlock', actor: CLI, detail: 'lock' }]);
  });
});

describe('openldr workflows hosts', () => {
  it('lists the hosts with their source and the switch', async () => {
    const s = setup({ serverList: 'z.example' });
    await hostsAdd(s.workflowHosts, 'A.example', s.io);
    s.out.length = 0;
    expect(await hostsList(s.workflowHosts, { json: false }, s.io)).toBe(0);
    expect(s.out).toEqual([
      'This OpenLDR (http://127.0.0.1:3000): off',
      'z.example  server setting',
      'a.example  added here',
    ]);
    s.out.length = 0;
    await hostsList(s.workflowHosts, { json: true }, s.io);
    expect(JSON.parse(s.out.join('\n'))).toEqual({
      self: { on: false, origin: 'http://127.0.0.1:3000' },
      hosts: [{ host: 'z.example', source: 'server' }, { host: 'a.example', source: 'setting' }],
    });
  });

  it('adds a host and says what it stored', async () => {
    const s = setup();
    expect(await hostsAdd(s.workflowHosts, 'FD00:0:0:0:0:0:0:20', s.io)).toBe(0);
    expect(s.out).toEqual(['fd00::20 is now on the list of hosts a workflow may call.']);
    expect(await hostsAdd(s.workflowHosts, '[fd00::20]', s.io)).toBe(0);
    expect(s.out.at(-1)).toBe('fd00::20 is already on the list of hosts a workflow may call.');
    expect(await hostsAdd(s.workflowHosts, 'http://x', s.io)).toBe(1);
    expect(s.err).toEqual(['Type a host name or an IP address, with no port and no path.']);
  });

  it('refuses to remove a host without --force', async () => {
    const s = setup();
    await hostsAdd(s.workflowHosts, 'a.example', s.io);
    expect(await hostsRemove(s.workflowHosts, 'a.example', { force: false }, s.io)).toBe(1);
    expect(s.err[0]).toMatch(/^Refusing to remove a\.example without --force\./);
    expect((await s.workflowHosts.list()).map((h) => h.host)).toEqual(['a.example']);
    expect(await hostsRemove(s.workflowHosts, ' A.example', { force: true }, s.io)).toBe(0);
    expect(await s.workflowHosts.list()).toEqual([]);
    // Only the list changed. Another grant, such as the switch for this OpenLDR, may still allow it.
    expect(s.out.at(-1)).toBe('a.example is no longer on the list of hosts a workflow may call.');
    expect(await hostsRemove(s.workflowHosts, 'a.example', { force: true }, s.io)).toBe(0);
    expect(s.out.at(-1)).toBe('a.example was not on the list.');
  });

  it('says why a host from the server setting cannot be removed', async () => {
    const s = setup({ serverList: 'z.example' });
    expect(await hostsRemove(s.workflowHosts, 'z.example', { force: true }, s.io)).toBe(1);
    expect(s.err).toEqual(['This host comes from the server setting WORKFLOW_HTTP_ALLOWLIST.']);
  });

  it('turns the switch on and off', async () => {
    const s = setup();
    expect(await hostsSelf(s.workflowHosts, 'on', s.io)).toBe(0);
    expect(s.out).toEqual(['The switch is on: a workflow may call this OpenLDR at http://127.0.0.1:3000.']);
    expect((await s.workflowHosts.rule()).origins).toEqual(['http://127.0.0.1:3000']);
    expect(await hostsSelf(s.workflowHosts, 'off', s.io)).toBe(0);
    expect(s.out.at(-1)).toBe('The switch is off. A host on the list is still allowed.');
    expect(await hostsSelf(s.workflowHosts, 'maybe', s.io)).toBe(1);
    expect(s.err).toEqual(['Say on or off.']);
    expect(s.audits.map((a) => [a.action, a.detail, a.actor])).toEqual([
      ['network.workflow_self.set', 'on', CLI],
      ['network.workflow_self.set', 'off', CLI],
    ]);
  });
});
