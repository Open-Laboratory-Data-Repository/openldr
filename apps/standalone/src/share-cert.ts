// The certificate for sharing OpenLDR on the lab network (`start --share`). It is self-signed:
// another PC accepts it once, after a person compares its fingerprint. The private key never
// leaves the data folder.

import { createPrivateKey, X509Certificate } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';

/** The same lifetime as the server edition's own certificate (install/install.sh). */
export const SHARE_CERT_DAYS = 825;
/** A certificate with fewer days left than this is replaced at the next start. */
export const SHARE_RENEW_DAYS = 30;

const DAY_MS = 86_400_000;

/** Names a certificate must carry. Both lists are sorted and hold no duplicates. */
export interface ShareNames {
  dns: string[];
  ips: string[];
}

/** 1 to 63 letters, digits and hyphens, not starting or ending with a hyphen. */
const HOST_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * dns: the PC's name in lower case when it is a valid host name, then `localhost`.
 * ips: every IPv4 address that is not internal, then `127.0.0.1`. No IPv6.
 * A name with a space, an underscore or an accent cannot go in a certificate, so it is left out.
 */
export function shareNames(hostname: string, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): ShareNames {
  const name = hostname.trim().toLowerCase();
  const dns = new Set<string>(['localhost']);
  if (HOST_NAME.test(name)) dns.add(name);
  const ips = new Set<string>(['127.0.0.1']);
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) ips.add(i.address);
    }
  }
  return { dns: [...dns].sort(), ips: [...ips].sort() };
}

export type MakeCert = (names: ShareNames, notBefore: Date, days: number) => Promise<{ certPem: string; keyPem: string }>;

/** RSA 2048, SHA-256, subject CN `OpenLDR`, the names as subjectAltName. */
export const makeCert: MakeCert = async (names, notBefore, days) => {
  const pems = await generate([{ name: 'commonName', value: 'OpenLDR' }], {
    keyType: 'rsa',
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: notBefore,
    notAfterDate: new Date(notBefore.getTime() + days * DAY_MS),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [...names.dns.map((value) => ({ type: 2 as const, value })), ...names.ips.map((ip) => ({ type: 7 as const, ip }))],
      },
    ],
  });
  return { certPem: pems.cert, keyPem: pems.private };
};

function parse(certPem: string): X509Certificate | undefined {
  try {
    return new X509Certificate(certPem);
  } catch {
    return undefined;
  }
}

/** False when the certificate is not valid yet, expires within SHARE_RENEW_DAYS of `now`, or lacks one of the names. */
export function certCovers(certPem: string, names: ShareNames, now: Date): boolean {
  const x = parse(certPem);
  if (x === undefined) return false;
  // Not valid yet: the clock was set back since it was made. Another PC would refuse it.
  if (Date.parse(x.validFrom) > now.getTime()) return false;
  if (Date.parse(x.validTo) - now.getTime() < SHARE_RENEW_DAYS * DAY_MS) return false;
  // subject: 'never' reads the names from subjectAltName only, as a browser does.
  if (!names.dns.every((n) => x.checkHost(n, { subject: 'never' }) !== undefined)) return false;
  return names.ips.every((ip) => x.checkIP(ip) !== undefined);
}

/** True when the key is the certificate's own. A key that cannot be read does not fit. */
function keyFits(certPem: string, keyPem: string): boolean {
  try {
    return new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem));
  } catch {
    return false;
  }
}

export interface ShareCert {
  certPem: string;
  keyPem: string;
  /** SHA-256, upper case hex pairs joined by colons, as `X509Certificate.fingerprint256` gives it. */
  fingerprint: string;
  certFile: string;
  created: boolean;
}

async function readIfThere(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Writes to a temp name in the same folder, then renames it into place. */
async function replaceFile(file: string, text: string, mode: number): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, text, { mode });
  await rename(temp, file);
}

/**
 * Reads `<dir>/cert.pem` and `<dir>/key.pem`. Makes and writes new ones when certCovers is false,
 * when either file is missing or unreadable, or when the key does not fit the certificate. The
 * key is written with mode 0600, and before the certificate: a stop between the two leaves an
 * old certificate with a new key, which the next start sees does not fit and replaces.
 */
export async function loadOrCreateShareCert(dir: string, names: ShareNames, now: Date, make: MakeCert = makeCert): Promise<ShareCert> {
  const certFile = join(dir, 'cert.pem');
  const keyFile = join(dir, 'key.pem');
  const oldCert = await readIfThere(certFile);
  const oldKey = await readIfThere(keyFile);
  if (oldCert !== undefined && oldKey !== undefined && certCovers(oldCert, names, now) && keyFits(oldCert, oldKey)) {
    return { certPem: oldCert, keyPem: oldKey, fingerprint: new X509Certificate(oldCert).fingerprint256, certFile, created: false };
  }
  const { certPem, keyPem } = await make(names, now, SHARE_CERT_DAYS);
  await mkdir(dir, { recursive: true });
  await replaceFile(keyFile, keyPem, 0o600);
  await replaceFile(certFile, certPem, 0o644);
  return { certPem, keyPem, fingerprint: new X509Certificate(certPem).fingerprint256, certFile, created: true };
}
