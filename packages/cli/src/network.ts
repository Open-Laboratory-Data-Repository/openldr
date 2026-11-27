import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import {
  createAppContext, BAD_ADDRESS, BAD_HOST, SERVER_HOST, TrustAuditFailed, TrustRefused, WorkflowHostAuditFailed,
  type AppContext, type AuditActor, type CertPreview, type TrustedCert, type TrustService, type TrustStatus, type WorkflowHosts,
} from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';

// `openldr trust ...` and `openldr workflows hosts ...` (design
// 2026-11-27-trusted-certificates-and-workflow-hosts). Settings > Network in the studio calls the
// same two services through /api/network.

/** Where a command writes, how it asks, and who it acts as. Tests give their own. */
export interface NetworkIo {
  out(line: string): void;
  err(line: string): void;
  /** Asks one question on the terminal. Undefined when there is no terminal to ask on. */
  ask?: (question: string) => Promise<string>;
  actor(): AuditActor;
}

function realIo(): NetworkIo {
  return {
    out: (line) => void process.stdout.write(`${line}\n`),
    err: (line) => void process.stderr.write(`${line}\n`),
    // The served CLI has no terminal. Neither has a script.
    ask: process.stdin.isTTY && process.stdout.isTTY
      ? async (question) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return await rl.question(question);
          } finally {
            rl.close();
          }
        }
      : undefined,
    actor: cliActor,
  };
}

/** The plain line for an error the two services raise, or undefined for one they do not. */
function said(err: unknown): string | undefined {
  if (err instanceof TrustRefused || err instanceof TrustAuditFailed || err instanceof WorkflowHostAuditFailed) return err.message;
  if (err instanceof Error && [BAD_ADDRESS, BAD_HOST, SERVER_HOST].includes(err.message)) return err.message;
  return undefined;
}

/** Runs a command body. A refusal prints its line and gives 1. Anything else is thrown on. */
async function guarded(io: NetworkIo, body: () => Promise<number>): Promise<number> {
  try {
    return await body();
  } catch (err) {
    const line = said(err);
    if (line === undefined) throw err;
    io.err(line);
    return 1;
  }
}

/** A fingerprint as people copy it: any case, with or without colons or spaces. */
const bareFingerprint = (text: string): string => text.replace(/[\s:]/g, '').toUpperCase();
const sameFingerprint = (a: string, b: string): boolean => bareFingerprint(a) === bareFingerprint(b) && bareFingerprint(a).length > 0;

const STATE: Record<TrustedCert['state'], string> = {
  'in-use': 'in use',
  added: 'added, restart to use',
  removed: 'removed, restart to drop',
  outside: 'set outside',
  unknown: 'unknown',
};

const MODE: Record<Exclude<TrustStatus['mode'], 'editable'>, string> = {
  'not-configured': 'Trusted certificates are not set up on this install: TRUSTED_CA_FILE is not set.',
  'set-outside': 'Trusted certificates are set outside OpenLDR, with NODE_EXTRA_CA_CERTS. They cannot be changed here.',
  damaged: 'The trust file holds text that is not a certificate. Fix the file first.',
};

const SAVED: Partial<Record<TrustedCert['state'], string>> = {
  added: 'Saved. Restart OpenLDR to use it.',
  'in-use': 'Saved. The running server already uses it.',
  unknown: 'Saved. No running server has reported what it loaded. A server uses it from its next start.',
};

/** Thirty seconds is when a lock may be removed. It is not proof that the change stopped. */
const LOCK_AGE_NOTE = 'A lock may be removed once it is 30 seconds old. That age does not prove the change stopped: first make sure nobody else is changing the list.';

export function formatTrustList(status: TrustStatus, certs: TrustedCert[]): string[] {
  const lines: string[] = [];
  if (status.mode !== 'editable') lines.push(MODE[status.mode]);
  if (status.lock) {
    if (status.lock.stuck) lines.push(`A change to the list left a lock at ${status.lock.since}. No change goes through until it is removed: openldr trust unlock --force`, LOCK_AGE_NOTE);
    else lines.push('A change to the list is in progress.');
  }
  if (certs.length === 0) {
    lines.push('(no trusted certificates)');
    return lines;
  }
  const width = Math.max(...certs.map((c) => STATE[c.state].length));
  for (const c of certs) lines.push(`${STATE[c.state].padEnd(width)}  ${c.fingerprint}  ${c.validTo.slice(0, 10)}${c.expired ? ' (expired)' : ''}  ${c.subject}`);
  // The state is the running server's, read from what it recorded when it started. This command
  // never reports what its own process loaded.
  if (certs.some((c) => c.state === 'unknown')) lines.push('No running server has reported what it loaded.');
  return lines;
}

export async function trustList(trust: TrustService, opts: { json: boolean }, io: NetworkIo): Promise<number> {
  const [status, certificates] = await Promise.all([trust.status(), trust.list()]);
  if (opts.json) io.out(JSON.stringify({ ...status, certificates }, null, 2));
  else for (const line of formatTrustList(status, certificates)) io.out(line);
  return 0;
}

export interface TrustAddOptions {
  file?: string;
  from?: string;
  fingerprint?: string;
}

export async function trustAdd(trust: TrustService, opts: TrustAddOptions, io: NetworkIo): Promise<number> {
  return guarded(io, async () => {
    if ((opts.file === undefined) === (opts.from === undefined)) {
      io.err('Give a certificate file, or --address <host:port>.');
      return 1;
    }
    let cert: CertPreview;
    if (opts.from !== undefined) {
      // The connection itself proves nothing: whoever answers chooses what to show. The person
      // must bring the fingerprint from the server itself.
      if (opts.fingerprint === undefined) {
        io.err('Give --fingerprint with --address. Read it from the server itself, not from this connection.');
        return 1;
      }
      cert = await trust.preview(opts.from);
    } else {
      let text: string;
      try {
        text = await readFile(opts.file as string, 'utf8');
      } catch {
        io.err('That file cannot be read.');
        return 1;
      }
      const certs = trust.read(text);
      if (certs.length !== 1) {
        io.err(`That file holds ${certs.length} certificates. Add them one file at a time.`);
        return 1;
      }
      cert = certs[0] as CertPreview;
    }
    if (opts.fingerprint !== undefined) {
      if (!sameFingerprint(opts.fingerprint, cert.fingerprint)) {
        io.err('The fingerprint does not match.');
        return 1;
      }
    } else {
      io.out(`Fingerprint (SHA-256): ${cert.fingerprint}`);
      io.out(`Subject: ${cert.subject}`);
      io.out(`Valid to: ${cert.validTo.slice(0, 10)}${cert.expired ? ' (expired)' : ''}`);
      if (!io.ask) {
        io.err('Give --fingerprint to add a certificate without a prompt.');
        return 1;
      }
      if ((await io.ask('Trust this certificate? (y/N) ')).trim().toLowerCase() !== 'y') {
        io.err('Nothing was saved.');
        return 1;
      }
    }
    // What the running server does with it. A certificate it already loaded needs no restart.
    const saved = await trust.add(cert.pem, io.actor());
    io.out(SAVED[saved.state] ?? 'Saved.');
    return 0;
  });
}

export async function trustRemove(trust: TrustService, fingerprint: string, opts: { force: boolean }, io: NetworkIo): Promise<number> {
  if (!opts.force) {
    io.err(`Refusing to remove ${fingerprint} without --force. After a restart, OpenLDR no longer trusts a server that shows it.`);
    return 1;
  }
  return guarded(io, async () => {
    // The list holds fingerprints in one form. Take the one the person meant, in any form.
    const match = (await trust.list()).find((c) => sameFingerprint(c.fingerprint, fingerprint));
    await trust.remove(match?.fingerprint ?? fingerprint, io.actor());
    io.out('Removed. Restart OpenLDR to stop trusting it.');
    return 0;
  });
}

export async function trustUnlock(trust: TrustService, opts: { force: boolean }, io: NetworkIo): Promise<number> {
  if (!opts.force) {
    io.err('Refusing to unlock without --force.');
    io.err(LOCK_AGE_NOTE);
    return 1;
  }
  return guarded(io, async () => {
    io.out((await trust.unlock(io.actor())) ? 'Unlocked.' : 'There is no lock.');
    return 0;
  });
}

export async function hostsList(hosts: WorkflowHosts, opts: { json: boolean }, io: NetworkIo): Promise<number> {
  const [self, rows] = await Promise.all([hosts.self(), hosts.list()]);
  if (opts.json) {
    io.out(JSON.stringify({ self, hosts: rows }, null, 2));
    return 0;
  }
  io.out(`This OpenLDR (${self.origin}): ${self.on ? 'on' : 'off'}`);
  for (const r of rows) io.out(`${r.host}  ${r.source === 'server' ? 'server setting' : 'added here'}`);
  return 0;
}

export async function hostsAdd(hosts: WorkflowHosts, host: string, io: NetworkIo): Promise<number> {
  return guarded(io, async () => {
    // The host as it is stored: lower case, and an IPv6 address in its short form.
    const done = await hosts.add(host, io.actor());
    io.out(`${done.host} is ${done.changed ? 'now' : 'already'} on the list of hosts a workflow may call.`);
    return 0;
  });
}

export async function hostsRemove(hosts: WorkflowHosts, host: string, opts: { force: boolean }, io: NetworkIo): Promise<number> {
  if (!opts.force) {
    io.err(`Refusing to remove ${host} without --force. A workflow that calls it stops working at once.`);
    return 1;
  }
  return guarded(io, async () => {
    // Only the list changed. Another grant may still allow the same address, so this says no more.
    const done = await hosts.remove(host, io.actor());
    io.out(done.changed ? `${done.host} is no longer on the list of hosts a workflow may call.` : `${done.host} was not on the list.`);
    return 0;
  });
}

export async function hostsSelf(hosts: WorkflowHosts, value: string, io: NetworkIo): Promise<number> {
  if (value !== 'on' && value !== 'off') {
    io.err('Say on or off.');
    return 1;
  }
  return guarded(io, async () => {
    const now = await hosts.setSelf(value === 'on', io.actor());
    io.out(now.on ? `The switch is on: a workflow may call this OpenLDR at ${now.origin}.` : 'The switch is off. A host on the list is still allowed.');
    return 0;
  });
}

/** Builds the app context, runs one command on it, and closes it. */
async function withContext(body: (ctx: AppContext, io: NetworkIo) => Promise<number>): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    return await body(ctx, realIo());
  } finally {
    await ctx.close();
  }
}

export const runTrustList = (opts: { json: boolean }): Promise<number> => withContext((ctx, io) => trustList(ctx.trust, opts, io));
export const runTrustAdd = (opts: TrustAddOptions): Promise<number> => withContext((ctx, io) => trustAdd(ctx.trust, opts, io));
export const runTrustRemove = (fingerprint: string, opts: { force: boolean }): Promise<number> => withContext((ctx, io) => trustRemove(ctx.trust, fingerprint, opts, io));
export const runTrustUnlock = (opts: { force: boolean }): Promise<number> => withContext((ctx, io) => trustUnlock(ctx.trust, opts, io));
export const runHostsList = (opts: { json: boolean }): Promise<number> => withContext((ctx, io) => hostsList(ctx.workflowHosts, opts, io));
export const runHostsAdd = (host: string): Promise<number> => withContext((ctx, io) => hostsAdd(ctx.workflowHosts, host, io));
export const runHostsRemove = (host: string, opts: { force: boolean }): Promise<number> => withContext((ctx, io) => hostsRemove(ctx.workflowHosts, host, opts, io));
export const runHostsSelf = (value: string): Promise<number> => withContext((ctx, io) => hostsSelf(ctx.workflowHosts, value, io));
