// Trust in the certificate of the OpenLDR this app shows in connect mode.
//
// Electron's own check decides whether a certificate is trusted. This app never asks Node's TLS
// for that: the two use different lists of trusted issuers and can disagree. Node's TLS is used for
// one thing only, reading a certificate's fingerprint to show the person.

import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import tls from 'node:tls';

/**
 * SHA-256 of the certificate, as 32 upper case hex pairs joined by colons. The same text the
 * server prints when it is shared on the lab network. Undefined when the PEM cannot be read.
 */
export function fingerprintOf(certPem: string): string | undefined {
  try {
    return new X509Certificate(certPem).fingerprint256;
  } catch {
    return undefined;
  }
}

export interface PinnedServer {
  host: string;
  fingerprint: string;
}

/**
 * The answer for Electron's setCertificateVerifyProc callback. Checked in this order:
 *   1. Chromium trusts the certificate ('net::OK'): 0, whatever is pinned.
 *   2. The host is the pinned host (any letter case) and the certificate's fingerprint equals the
 *      pinned one: 0. This overrides every error for that one certificate.
 *   3. Anything else: -2.
 * Never -3, which would hand the choice back to Chromium. The app decides every case itself.
 *
 * Electron gives a host name and no port, so a pin covers the host on every port. That is safe:
 * only the holder of the pinned key can present that certificate. The fingerprint is worked out
 * from `certificate.data`, the PEM text, and not from Electron's own fingerprint field.
 */
export function verifyDecision(
  request: { hostname: string; verificationResult: string; certificate: { data: string } },
  pinned: PinnedServer | undefined,
): 0 | -2 {
  if (request.verificationResult === 'net::OK') return 0;
  if (pinned === undefined) return -2;
  if (request.hostname.toLowerCase() !== pinned.host.toLowerCase()) return -2;
  const shown = fingerprintOf(request.certificate.data);
  return shown !== undefined && shown === pinned.fingerprint ? 0 : -2;
}

export type ServerCertificate = { ok: true; fingerprint: string } | { ok: false };

/**
 * Opens a TLS connection without checking the certificate, reads its fingerprint, and closes. It
 * sends no web request. 10 second limit, counted from the start. `{ ok: false }` when nothing
 * answers. It says nothing about trust: the person compares the fingerprint.
 */
export function readServerCertificate(host: string, port: number, timeoutMs = 10_000): Promise<ServerCertificate> {
  return new Promise((done) => {
    let settled = false;
    let socket: tls.TLSSocket | undefined;
    let deadline: NodeJS.Timeout | undefined;
    const finish = (answer: ServerCertificate): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket?.destroy();
      done(answer);
    };
    try {
      // The name goes to the server so it can pick its certificate. An IP address is not a name.
      const made = tls.connect({ host, port, rejectUnauthorized: false, ...(isIP(host) === 0 ? { servername: host } : {}) }, () => {
        const fingerprint = made.getPeerX509Certificate()?.fingerprint256;
        finish(fingerprint ? { ok: true, fingerprint } : { ok: false });
      });
      socket = made;
    } catch {
      // Node refused the address before making a socket.
      finish({ ok: false });
      return;
    }
    socket.on('error', () => finish({ ok: false }));
    deadline = setTimeout(() => finish({ ok: false }), timeoutMs);
  });
}
