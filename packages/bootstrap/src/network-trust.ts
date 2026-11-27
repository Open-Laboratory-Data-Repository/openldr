// Trusted certificates for this install's outgoing HTTPS calls: a plugin's network calls, a
// workflow's HTTP step and sync to central. They live in one PEM file that Node reads once, when
// it starts (NODE_EXTRA_CA_CERTS). This service reads and edits that file. A change is used after
// the next restart.
//
// Design: docs/superpowers/specs/2026-11-27-trusted-certificates-and-workflow-hosts-design.md

import { randomBytes, X509Certificate } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import tls from 'node:tls';
import type { AuditActor } from './record-audit';

export type TrustError = 'not-a-certificate' | 'private-key' | 'duplicate' | 'not-found' | 'read-only' | 'damaged' | 'no-answer';

const SAID: Record<TrustError, string> = {
  'not-a-certificate': 'That is not a certificate.',
  'private-key': 'That text holds a private key. Never paste a key. Nothing was saved.',
  duplicate: 'That certificate is already trusted.',
  'not-found': 'That certificate is not in the list.',
  'read-only': 'Trusted certificates cannot be changed here.',
  damaged: 'The trust file holds text that is not a certificate. Fix the file first.',
  'no-answer': 'Nothing answered at that address.',
};

/** A refusal with a code a screen or a command can act on. The message never holds the input. */
export class TrustRefused extends Error {
  constructor(readonly code: TrustError) {
    super(SAID[code]);
    this.name = 'TrustRefused';
  }
}

export const BAD_ADDRESS = 'Type a host name, or a host name and a port.';
export const TRUST_BUSY = 'The trust file is busy. Try again.';

/**
 * The file is changed, and the audit row for the change could not be written. The change stands:
 * trying again would answer `duplicate` or `not-found`. The caller must say both things, and must
 * keep a durable line of who changed what, which the audit row would have held.
 */
export class TrustAuditFailed extends Error {
  constructor(
    readonly action: 'network.trust.add' | 'network.trust.remove',
    readonly fingerprint: string,
    readonly subject: string,
    readonly actor: TrustActor,
    cause: unknown,
  ) {
    super('The change was made, but its audit record could not be written.', { cause });
    this.name = 'TrustAuditFailed';
  }
}

export interface CertPreview {
  pem: string;
  /** SHA-256, upper case hex pairs joined by colons. */
  fingerprint: string;
  /** The certificate's common name, or its first DNS or IP name. */
  subject: string;
  /** ISO date. */
  validTo: string;
  expired: boolean;
}

export interface TrustedCert extends Omit<CertPreview, 'pem'> {
  /**
   * in-use: the server loaded it and it is in the file.
   * added: in the file, the server did not load it. Used after a restart.
   * removed: the server loaded it, it is no longer in the file. Dropped after a restart.
   * outside: loaded from a file OpenLDR does not manage.
   * unknown: in the file, and nobody can say what the server loaded.
   */
  state: 'in-use' | 'added' | 'removed' | 'outside' | 'unknown';
}

/**
 * What the running server loaded when it started. `known: false` when no server has recorded it,
 * or when its Node cannot report it. Never an empty list standing in for "cannot tell".
 */
export type LoadedTrust = { known: true; pems: string[]; since: string } | { known: false };

export interface TrustStatus {
  /**
   * Checked in this order:
   * set-outside: NODE_EXTRA_CA_CERTS and TRUSTED_CA_FILE do not name the same file, and at least one is set.
   * not-configured: neither is set.
   * damaged: both name the same file, and it holds text that is not a certificate.
   * editable: both name the same file, and it is sound.
   */
  mode: 'editable' | 'not-configured' | 'set-outside' | 'damaged';
}

export type TrustActor = AuditActor;

export interface TrustService {
  status(): Promise<TrustStatus>;
  /** Sorted by subject, then fingerprint. */
  list(): Promise<TrustedCert[]>;
  /** One TLS connection to host:port, no web request. Throws TrustRefused('no-answer'). */
  preview(address: string): Promise<CertPreview>;
  /** Reads pasted or uploaded text. Throws 'not-a-certificate' or 'private-key'. */
  read(text: string): CertPreview[];
  add(pem: string, actor: TrustActor): Promise<TrustedCert>;
  remove(fingerprint: string, actor: TrustActor): Promise<void>;
}

export interface TrustDeps {
  /** cfg.TRUSTED_CA_FILE */
  file: string | undefined;
  /** process.env.NODE_EXTRA_CA_CERTS */
  nodeExtraCaFile: string | undefined;
  /** What the running server loaded at start, from any process. */
  loaded(): Promise<LoadedTrust>;
  /** The certificate a host presents, as PEM, or undefined when nothing answers. */
  readPeer(host: string, port: number): Promise<string | undefined>;
  /**
   * Runs one change while no other process changes the file: the server and a CLI command are two
   * of them. It throws Error(TRUST_BUSY) when it cannot start within 10 seconds. The app context
   * gives a database lock (`runExclusive`), so a stopped process leaves nothing to clean up.
   */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  audit(action: 'network.trust.add' | 'network.trust.remove', actor: TrustActor, fingerprint: string, subject: string): Promise<void>;
  now(): Date;
}

const BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g;

interface Parsed {
  certs: CertPreview[];
  /** A block that is not a certificate, or text outside every block. */
  stray: boolean;
  key: boolean;
}

function subjectOf(x: X509Certificate): string {
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(x.subject ?? '');
  if (cn?.[1]) return cn[1].trim();
  const first = (x.subjectAltName ?? '').split(',')[0]?.trim() ?? '';
  return first.replace(/^(DNS|IP Address):/, '') || '(no name)';
}

/** Splits text into PEM blocks. Never throws, and keeps nothing of a block it cannot read. */
function parse(text: string, now: Date): Parsed {
  const out: Parsed = { certs: [], stray: false, key: false };
  let rest = text;
  for (const m of text.matchAll(BLOCK)) {
    rest = rest.replace(m[0], '');
    const kind = m[1] ?? '';
    if (kind.includes('PRIVATE KEY')) {
      out.key = true;
      continue;
    }
    if (kind !== 'CERTIFICATE') {
      out.stray = true;
      continue;
    }
    try {
      const x = new X509Certificate(m[0]);
      out.certs.push({
        pem: `${x.toString().trim()}\n`,
        fingerprint: x.fingerprint256,
        subject: subjectOf(x),
        validTo: new Date(x.validTo).toISOString(),
        expired: Date.parse(x.validTo) < now.getTime(),
      });
    } catch {
      out.stray = true;
    }
  }
  // A key whose markers were cut off, or any other words, are not a certificate either.
  if (/PRIVATE KEY/.test(rest)) out.key = true;
  if (rest.trim() !== '') out.stray = true;
  return out;
}

/** `host` or `host:port`, with no scheme, user or path. IPv6 goes in brackets when a port follows. */
function parseAddress(address: string): { host: string; port: number } {
  const text = address.trim();
  const m = /^(\[[0-9a-fA-F:.]+\]|[^\s:/@[\]]+)(?::(\d{1,5}))?$/.exec(text);
  if (!m?.[1]) throw new Error(BAD_ADDRESS);
  const host = m[1].replace(/^\[|\]$/g, '').toLowerCase();
  const port = m[2] === undefined ? 443 : Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(BAD_ADDRESS);
  if (m[1].startsWith('[') && isIP(host) !== 6) throw new Error(BAD_ADDRESS);
  return { host, port };
}

/**
 * Opens one TLS connection without checking the certificate, reads it, and closes. 10 s limit.
 * It sends no web request and no credentials. It says nothing about trust: the person compares
 * the fingerprint. Undefined when nothing answers.
 */
export function readPeerCertificate(host: string, port: number, timeoutMs = 10_000): Promise<string | undefined> {
  return new Promise((done) => {
    let settled = false;
    const finish = (pem: string | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      done(pem);
    };
    // From the start, whatever the other side sends in the meantime.
    const deadline = setTimeout(() => finish(undefined), timeoutMs);
    const socket = tls.connect({ host, port, rejectUnauthorized: false, ...(isIP(host) === 0 ? { servername: host } : {}) }, () => {
      const x = socket.getPeerX509Certificate();
      finish(x ? `${x.toString().trim()}\n` : undefined);
    });
    socket.on('error', () => finish(undefined));
  });
}

export function createTrustService(deps: TrustDeps): TrustService {
  const managed = deps.file !== undefined && deps.nodeExtraCaFile !== undefined && resolve(deps.file) === resolve(deps.nodeExtraCaFile);
  const configured = deps.file !== undefined || deps.nodeExtraCaFile !== undefined;

  /** The managed file's text. A file that is not there yet is an empty list. */
  async function fileText(): Promise<string> {
    try {
      return await readFile(deps.file as string, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    }
  }

  async function mode(): Promise<TrustStatus['mode']> {
    if (!managed) return configured ? 'set-outside' : 'not-configured';
    const p = parse(await fileText(), deps.now());
    return p.stray || p.key ? 'damaged' : 'editable';
  }

  function refuse(code: TrustError): never {
    throw new TrustRefused(code);
  }

  function read(text: string): CertPreview[] {
    const p = parse(text, deps.now());
    if (p.key) refuse('private-key');
    if (p.stray || p.certs.length === 0) refuse('not-a-certificate');
    return p.certs;
  }

  /** One certificate, or a refusal. */
  function one(text: string): CertPreview {
    const certs = read(text);
    if (certs.length !== 1) refuse('not-a-certificate');
    return certs[0] as CertPreview;
  }

  /** Writes the file whole: a temp name in the same folder, then a rename. */
  async function write(certs: CertPreview[]): Promise<void> {
    const file = deps.file as string;
    await mkdir(dirname(file), { recursive: true });
    // A new name each time, opened so that a file already there is never reused or followed.
    const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    let made = false;
    try {
      const handle = await open(temp, 'wx', 0o644);
      made = true;
      try {
        await handle.writeFile(certs.map((c) => c.pem).join(''));
      } finally {
        await handle.close();
      }
      await rename(temp, file);
      made = false;
    } finally {
      if (made) await rm(temp, { force: true });
    }
  }

  /** Under the lock: the file as it is now, or a refusal when it may not be changed. */
  async function editable(): Promise<CertPreview[]> {
    if (!managed) refuse('read-only');
    const p = parse(await fileText(), deps.now());
    if (p.stray || p.key) refuse('damaged');
    return dedupe(p.certs);
  }

  function dedupe(certs: CertPreview[]): CertPreview[] {
    const seen = new Set<string>();
    return certs.filter((c) => !seen.has(c.fingerprint) && seen.add(c.fingerprint));
  }

  const strip = ({ pem: _pem, ...rest }: CertPreview): Omit<CertPreview, 'pem'> => rest;

  const printsOf = (loaded: LoadedTrust): Set<string> =>
    new Set(loaded.known ? loaded.pems.flatMap((pem) => parse(pem, deps.now()).certs).map((c) => c.fingerprint) : []);

  /** The state of a certificate that is in the managed file. One rule, for `list` and for `add`. */
  const stateInFile = (loaded: LoadedTrust, ran: Set<string>, fingerprint: string): TrustedCert['state'] =>
    !loaded.known ? 'unknown' : ran.has(fingerprint) ? 'in-use' : 'added';

  async function audited(action: 'network.trust.add' | 'network.trust.remove', actor: TrustActor, cert: CertPreview): Promise<void> {
    try {
      await deps.audit(action, actor, cert.fingerprint, cert.subject);
    } catch (err) {
      throw new TrustAuditFailed(action, cert.fingerprint, cert.subject, actor, err);
    }
  }

  return {
    async status() {
      return { mode: await mode() };
    },

    read,

    async list() {
      const loaded = await deps.loaded();
      const ran = loaded.known ? dedupe(loaded.pems.flatMap((pem) => parse(pem, deps.now()).certs)) : [];
      const rows: TrustedCert[] = [];
      if (!managed) {
        // Nothing here is OpenLDR's to manage. What Node loaded came from somewhere else.
        for (const c of ran) rows.push({ ...strip(c), state: 'outside' });
      } else {
        const inFile = dedupe(parse(await fileText(), deps.now()).certs);
        const ranPrints = new Set(ran.map((c) => c.fingerprint));
        const filePrints = new Set(inFile.map((c) => c.fingerprint));
        for (const c of inFile) {
          rows.push({ ...strip(c), state: stateInFile(loaded, ranPrints, c.fingerprint) });
        }
        for (const c of ran) if (!filePrints.has(c.fingerprint)) rows.push({ ...strip(c), state: 'removed' });
      }
      return rows.sort((a, b) => a.subject.localeCompare(b.subject) || a.fingerprint.localeCompare(b.fingerprint));
    },

    async preview(address) {
      const { host, port } = parseAddress(address);
      const pem = await deps.readPeer(host, port);
      if (pem === undefined) refuse('no-answer');
      return one(pem as string);
    },

    async add(pem, actor) {
      const cert = one(pem);
      // Before the lock: with no managed file there is nothing to lock, and no folder to make.
      if (!managed) refuse('read-only');
      await deps.exclusive(async () => {
        const now = await editable();
        if (now.some((c) => c.fingerprint === cert.fingerprint)) refuse('duplicate');
        await write([...now, cert]);
      });
      // Only once the file is in place. A failed write leaves no row.
      await audited('network.trust.add', actor, cert);
      const loaded = await deps.loaded();
      return { ...strip(cert), state: stateInFile(loaded, printsOf(loaded), cert.fingerprint) };
    },

    async remove(fingerprint, actor) {
      let gone: CertPreview | undefined;
      if (!managed) refuse('read-only');
      await deps.exclusive(async () => {
        const now = await editable();
        gone = now.find((c) => c.fingerprint === fingerprint);
        if (gone === undefined) refuse('not-found');
        await write(now.filter((c) => c.fingerprint !== fingerprint));
      });
      const cert = gone as CertPreview;
      await audited('network.trust.remove', actor, cert);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// What the server loaded
//
// Only the server process knows which extra certificates its Node loaded: Node reads the file
// once, when the process starts. A CLI command is another process, started later, and would read
// the file as it is now. So the server records what it loaded when it starts, and every process
// reads that record.

/** The app setting that holds the record. Local to this install: it never syncs. */
export const KEY_TRUST_LOADED = 'network.trust_loaded';

interface SettingsLike {
  get(key: string): Promise<{ value: string } | null>;
  set(key: string, value: string, updatedBy: string | null): Promise<void>;
}

/**
 * Called once, when the server starts. `extra` asks this process's Node for the extra
 * certificates it loaded (`tls.getCACertificates('extra')`), and is undefined when this Node has
 * no such function. Then, and when asking fails, the record says the list is not known.
 */
export async function recordLoadedTrust(settings: SettingsLike, extra: (() => string[]) | undefined, now: Date): Promise<void> {
  let pems: string[] | undefined;
  try {
    pems = extra?.();
  } catch {
    pems = undefined;
  }
  const record = pems === undefined ? { since: now.toISOString(), unknown: true } : { since: now.toISOString(), pems };
  await settings.set(KEY_TRUST_LOADED, JSON.stringify(record), null);
}

/** What the last server start recorded. Not known when there is no record, or it cannot be read. */
export async function readLoadedTrust(settings: SettingsLike): Promise<LoadedTrust> {
  const row = await settings.get(KEY_TRUST_LOADED);
  if (!row) return { known: false };
  try {
    const v = JSON.parse(row.value) as { since?: unknown; pems?: unknown };
    if (typeof v !== 'object' || v === null || typeof v.since !== 'string') return { known: false };
    if (!Array.isArray(v.pems) || !v.pems.every((p) => typeof p === 'string')) return { known: false };
    return { known: true, pems: v.pems as string[], since: v.since };
  } catch {
    return { known: false };
  }
}

/** Asks this process's Node for the extra certificates it loaded, or undefined when it cannot say. */
export function nodeExtraCertificates(): (() => string[]) | undefined {
  const get = (tls as unknown as { getCACertificates?: (type: string) => string[] }).getCACertificates;
  return typeof get === 'function' ? () => get('extra') : undefined;
}
