import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { certCovers, loadOrCreateShareCert, makeCert, shareNames, SHARE_CERT_DAYS } from './share-cert';

const NOW = new Date('2026-12-01T00:00:00Z');
const iface = (address: string, internal = false, family: 'IPv4' | 'IPv6' = 'IPv4') =>
  ({ address, internal, family, netmask: '', mac: '', cidr: null }) as never;
const newDir = (): string => mkdtempSync(join(tmpdir(), 'share-'));

describe('shareNames', () => {
  it('lists the name and every outside IPv4 address', () => {
    const n = shareNames('LabPC', {
      lo: [iface('127.0.0.1', true)],
      eth0: [iface('192.168.1.20'), iface('fe80::1', false, 'IPv6')],
      wlan0: [iface('10.0.0.7')],
    });
    expect(n).toEqual({ dns: ['labpc', 'localhost'], ips: ['10.0.0.7', '127.0.0.1', '192.168.1.20'] });
  });

  it.each(['lab pc', 'lab_pc', 'laboratório', '-lab', 'lab-', ''])('leaves out a name that is not a host name: %j', (name) => {
    expect(shareNames(name, {}).dns).toEqual(['localhost']);
  });

  it('lists an address once when two interfaces hold it', () => {
    expect(shareNames('a', { e0: [iface('10.0.0.7')], e1: [iface('10.0.0.7')] }).ips).toEqual(['10.0.0.7', '127.0.0.1']);
  });
});

describe('loadOrCreateShareCert', () => {
  const names = { dns: ['labpc', 'localhost'], ips: ['127.0.0.1', '192.168.1.20'] };

  it('makes a certificate with the names, valid for 825 days, and a 0600 key', async () => {
    const dir = newDir();
    const c = await loadOrCreateShareCert(dir, names, NOW);
    const x = new X509Certificate(c.certPem);
    expect(c.created).toBe(true);
    expect(x.subjectAltName).toContain('DNS:labpc');
    expect(x.subjectAltName).toContain('IP Address:192.168.1.20');
    expect(Math.round((Date.parse(x.validTo) - Date.parse(x.validFrom)) / 86_400_000)).toBe(SHARE_CERT_DAYS);
    expect(c.fingerprint).toBe(x.fingerprint256);
    expect(c.certFile).toBe(join(dir, 'cert.pem'));
    expect(readFileSync(join(dir, 'cert.pem'), 'utf8')).toBe(c.certPem);
    if (process.platform !== 'win32') expect(statSync(join(dir, 'key.pem')).mode & 0o777).toBe(0o600);
  });

  it('makes an RSA 2048 key and a certificate that is not an authority', async () => {
    const c = await loadOrCreateShareCert(newDir(), names, NOW);
    const x = new X509Certificate(c.certPem);
    expect(x.publicKey.asymmetricKeyType).toBe('rsa');
    expect(x.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(x.ca).toBe(false);
    expect(x.subject).toContain('CN=OpenLDR');
  });

  it('makes the folder when it is missing', async () => {
    const dir = join(newDir(), 'share');
    expect((await loadOrCreateShareCert(dir, names, NOW)).created).toBe(true);
  });

  it('reuses the certificate on the next start', async () => {
    const dir = newDir();
    const first = await loadOrCreateShareCert(dir, names, NOW);
    const second = await loadOrCreateShareCert(dir, names, NOW);
    expect(second.created).toBe(false);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.keyPem).toBe(first.keyPem);
  });

  it('makes a new one when the PC has a new address', async () => {
    const dir = newDir();
    const first = await loadOrCreateShareCert(dir, names, NOW);
    const moved = await loadOrCreateShareCert(dir, { ...names, ips: ['127.0.0.1', '192.168.1.99'] }, NOW);
    expect(moved.created).toBe(true);
    expect(moved.fingerprint).not.toBe(first.fingerprint);
  });

  it('makes a new one within 30 days of the end', async () => {
    const dir = newDir();
    await loadOrCreateShareCert(dir, names, NOW);
    const late = new Date(NOW.getTime() + (SHARE_CERT_DAYS - 29) * 86_400_000);
    expect((await loadOrCreateShareCert(dir, names, late)).created).toBe(true);
  });

  it('keeps one that has 31 days left', async () => {
    const dir = newDir();
    await loadOrCreateShareCert(dir, names, NOW);
    const before = new Date(NOW.getTime() + (SHARE_CERT_DAYS - 31) * 86_400_000);
    expect((await loadOrCreateShareCert(dir, names, before)).created).toBe(false);
  });

  it('makes a new one after the clock was set back before its start', async () => {
    const dir = newDir();
    const first = await loadOrCreateShareCert(dir, names, NOW);
    const earlier = new Date(NOW.getTime() - 48 * 3_600_000);
    const second = await loadOrCreateShareCert(dir, names, earlier);
    expect(second.created).toBe(true);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(Date.parse(new X509Certificate(second.certPem).validFrom)).toBeLessThanOrEqual(earlier.getTime());
  });

  it('makes a new one when a file is damaged', async () => {
    const dir = newDir();
    await loadOrCreateShareCert(dir, names, NOW);
    writeFileSync(join(dir, 'cert.pem'), 'not a certificate');
    expect((await loadOrCreateShareCert(dir, names, NOW)).created).toBe(true);
    expect(() => new X509Certificate(readFileSync(join(dir, 'cert.pem')))).not.toThrow();
  });

  it('makes a new one when the key is damaged', async () => {
    const dir = newDir();
    await loadOrCreateShareCert(dir, names, NOW);
    writeFileSync(join(dir, 'key.pem'), 'not a key');
    expect((await loadOrCreateShareCert(dir, names, NOW)).created).toBe(true);
  });

  it('makes a new one when the key belongs to another certificate', async () => {
    // A stop between the two file writes can leave this pair behind.
    const dir = newDir();
    await loadOrCreateShareCert(dir, names, NOW);
    const other = await makeCert(names, NOW, SHARE_CERT_DAYS);
    writeFileSync(join(dir, 'key.pem'), other.keyPem);
    expect((await loadOrCreateShareCert(dir, names, NOW)).created).toBe(true);
  });

  it('leaves no temp file behind', async () => {
    const dir = newDir();
    await loadOrCreateShareCert(dir, names, NOW);
    expect(readdirSync(dir).sort()).toEqual(['cert.pem', 'key.pem']);
  });
});

describe('certCovers', () => {
  it('is false for text that is not a certificate', () => {
    expect(certCovers('nope', { dns: [], ips: [] }, NOW)).toBe(false);
  });

  it('is true for a fresh certificate and its own names', async () => {
    const n = { dns: ['localhost'], ips: ['127.0.0.1'] };
    const { certPem } = await makeCert(n, NOW, SHARE_CERT_DAYS);
    expect(certCovers(certPem, n, NOW)).toBe(true);
  });

  it('is false before the certificate starts to be valid', async () => {
    // A PC whose clock was set back. Another PC would refuse this certificate.
    const n = { dns: ['localhost'], ips: ['127.0.0.1'] };
    const { certPem } = await makeCert(n, NOW, SHARE_CERT_DAYS);
    expect(certCovers(certPem, n, new Date(NOW.getTime() - 48 * 3_600_000))).toBe(false);
  });

  it('is false when a name or an address is missing', async () => {
    const { certPem } = await makeCert({ dns: ['localhost'], ips: ['127.0.0.1'] }, NOW, SHARE_CERT_DAYS);
    expect(certCovers(certPem, { dns: ['labpc', 'localhost'], ips: ['127.0.0.1'] }, NOW)).toBe(false);
    expect(certCovers(certPem, { dns: ['localhost'], ips: ['10.0.0.7', '127.0.0.1'] }, NOW)).toBe(false);
  });
});
