import { X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { beforeAll, describe, expect, it } from 'vitest';
// The launcher's own certificate maker, so these tests use the kind of certificate a shared
// install presents. Made at test time: no key is kept in the repository.
import { makeCert } from '../../standalone/src/share-cert';
import { fingerprintOf, readServerCertificate, verifyDecision } from './cert-trust';

interface Pair { cert: string; key: string }
let A: Pair;
let B: Pair;

beforeAll(async () => {
  const make = async (name: string): Promise<Pair> => {
    const made = await makeCert({ dns: [name, 'localhost'], ips: ['127.0.0.1'] }, new Date(Date.now() - 60_000), 30);
    return { cert: made.certPem, key: made.keyPem };
  };
  [A, B] = await Promise.all([make('labpc'), make('other')]);
}, 60_000);

describe('fingerprintOf', () => {
  it('gives the same fingerprint as Node for a PEM, and undefined for other text', () => {
    expect(fingerprintOf(A.cert)).toBe(new X509Certificate(A.cert).fingerprint256);
    expect(fingerprintOf(A.cert)).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(fingerprintOf(A.cert)).not.toBe(fingerprintOf(B.cert));
    expect(fingerprintOf('nope')).toBeUndefined();
    expect(fingerprintOf('')).toBeUndefined();
  });

  it('never reads a private key as a certificate', () => {
    expect(fingerprintOf(A.key)).toBeUndefined();
  });
});

describe('verifyDecision', () => {
  const bad = 'net::ERR_CERT_AUTHORITY_INVALID';
  const pin = () => ({ host: 'labpc', fingerprint: fingerprintOf(A.cert)! });
  const ask = (hostname: string, verificationResult: string, cert: string) => ({ hostname, verificationResult, certificate: { data: cert } });

  it('accepts what Chromium trusts, with no pin', () => {
    expect(verifyDecision(ask('hub.example.org', 'net::OK', B.cert), undefined)).toBe(0);
  });

  it('accepts what Chromium trusts even when another certificate is pinned', () => {
    expect(verifyDecision(ask('labpc', 'net::OK', B.cert), pin())).toBe(0);
  });

  it('accepts the pinned host with the pinned certificate', () => {
    expect(verifyDecision(ask('labpc', bad, A.cert), pin())).toBe(0);
  });

  it('accepts it whatever the error is', () => {
    for (const error of ['net::ERR_CERT_DATE_INVALID', 'net::ERR_CERT_COMMON_NAME_INVALID', 'net::ERR_CERT_WEAK_KEY', 'something new']) {
      expect(verifyDecision(ask('labpc', error, A.cert), pin())).toBe(0);
    }
  });

  it('refuses the pinned host with another certificate', () => {
    expect(verifyDecision(ask('labpc', bad, B.cert), pin())).toBe(-2);
  });

  it('refuses the pinned certificate on another host', () => {
    expect(verifyDecision(ask('other', bad, A.cert), pin())).toBe(-2);
    // A name that only starts or ends like the pinned one is another host.
    expect(verifyDecision(ask('labpc.evil.example', bad, A.cert), pin())).toBe(-2);
    expect(verifyDecision(ask('xlabpc', bad, A.cert), pin())).toBe(-2);
  });

  it('refuses an untrusted certificate when nothing is pinned', () => {
    expect(verifyDecision(ask('labpc', bad, A.cert), undefined)).toBe(-2);
  });

  it('compares the host without regard to case', () => {
    expect(verifyDecision(ask('LabPC', bad, A.cert), pin())).toBe(0);
    expect(verifyDecision(ask('labpc', bad, A.cert), { host: 'LABPC', fingerprint: fingerprintOf(A.cert)! })).toBe(0);
  });

  it('refuses a certificate it cannot read', () => {
    expect(verifyDecision(ask('labpc', bad, 'nope'), pin())).toBe(-2);
    expect(verifyDecision(ask('labpc', bad, ''), pin())).toBe(-2);
  });

  it('refuses when the result is anything but the exact word for trusted', () => {
    for (const result of ['', 'OK', 'net::ok', 'net::OK ']) expect(verifyDecision(ask('labpc', result, B.cert), undefined)).toBe(-2);
  });

  it('never answers -3, which would hand the choice back to Chromium', () => {
    const answers = [verifyDecision(ask('a', 'net::OK', A.cert), undefined), verifyDecision(ask('a', bad, A.cert), undefined), verifyDecision(ask('labpc', bad, A.cert), pin())];
    for (const a of answers) expect([0, -2]).toContain(a);
  });
});

describe('readServerCertificate', () => {
  it('reads the fingerprint of a self-signed server', async () => {
    const server = https.createServer({ key: A.key, cert: A.cert }, (_req, res) => res.end('ok'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const port = (server.address() as AddressInfo).port;
      expect(await readServerCertificate('127.0.0.1', port)).toEqual({ ok: true, fingerprint: fingerprintOf(A.cert) });
      // By name too, where the name is sent to the server.
      expect(await readServerCertificate('localhost', port)).toEqual({ ok: true, fingerprint: fingerprintOf(A.cert) });
    } finally {
      server.close();
    }
  });

  it('gives ok false when nothing listens', async () => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = (probe.address() as AddressInfo).port;
    probe.close();
    await once(probe, 'close');
    expect(await readServerCertificate('127.0.0.1', port)).toEqual({ ok: false });
  });

  it('gives ok false for a server that is not TLS, within its limit', async () => {
    const sockets = new Set<net.Socket>();
    const plain = net.createServer((s) => { sockets.add(s); s.on('error', () => {}); });
    plain.listen(0, '127.0.0.1');
    await once(plain, 'listening');
    try {
      const started = Date.now();
      expect(await readServerCertificate('127.0.0.1', (plain.address() as AddressInfo).port, 300)).toEqual({ ok: false });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      for (const s of sockets) s.destroy();
      plain.close();
    }
  });

  it('gives ok false, and nothing fails later, for a port Node refuses at once', async () => {
    const failures: unknown[] = [];
    const onFail = (e: unknown): void => void failures.push(e);
    process.on('uncaughtException', onFail);
    try {
      expect(await readServerCertificate('127.0.0.1', 70000, 30)).toEqual({ ok: false });
      await new Promise((r) => setTimeout(r, 120));
      expect(failures).toEqual([]);
    } finally {
      process.off('uncaughtException', onFail);
    }
  });
});
