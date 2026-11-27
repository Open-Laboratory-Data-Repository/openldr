import { EventEmitter } from 'node:events';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureTrustFile, MAX_EVENTS_FD, startAgain, trustStart, TRUST_RESTARTED } from './trust-start.js';

const dir = (): string => mkdtempSync(join(tmpdir(), 'trust-start-'));

describe('trustStart', () => {
  const trustFile = '/data/trust/ca.pem';

  it('goes ahead when the variable already names the trust file', () => {
    expect(trustStart({ trustFile, envValue: trustFile, alreadyRestarted: false })).toBe('go');
    expect(trustStart({ trustFile, envValue: '/data/trust/../trust/ca.pem', alreadyRestarted: false })).toBe('go');
    expect(trustStart({ trustFile, envValue: trustFile, alreadyRestarted: true })).toBe('go');
    // A relative spelling of the same path.
    const real = join(dir(), 'trust', 'ca.pem');
    expect(trustStart({ trustFile: real, envValue: relative(process.cwd(), real), alreadyRestarted: false })).toBe('go');
  });

  it('treats another file as outside', () => {
    expect(trustStart({ trustFile, envValue: '/etc/ssl/our-ca.pem', alreadyRestarted: false })).toBe('outside');
    expect(trustStart({ trustFile, envValue: '/etc/ssl/our-ca.pem', alreadyRestarted: true })).toBe('outside');
  });

  it('asks to start again when the variable is not set', () => {
    expect(trustStart({ trustFile, envValue: undefined, alreadyRestarted: false })).toBe('again');
    // Set to nothing is not set: Node reads no file for it.
    expect(trustStart({ trustFile, envValue: '', alreadyRestarted: false })).toBe('again');
  });

  it('never asks twice', () => {
    expect(trustStart({ trustFile, envValue: undefined, alreadyRestarted: true })).toBe('outside');
    expect(trustStart({ trustFile, envValue: '', alreadyRestarted: true })).toBe('outside');
  });
});

describe('ensureTrustFile', () => {
  it('makes an empty file and its folder when missing', () => {
    const file = join(dir(), 'trust', 'ca.pem');
    ensureTrustFile(file);
    expect(readFileSync(file, 'utf8')).toBe('');
    // Certificates are public. The file must be readable by the server whoever started it.
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o644);
  });

  it('leaves an existing file as it is', () => {
    const file = join(dir(), 'ca.pem');
    writeFileSync(file, 'kept');
    ensureTrustFile(file);
    ensureTrustFile(file);
    expect(readFileSync(file, 'utf8')).toBe('kept');
  });
});

describe('ensureTrustFile, when something else is in the way', () => {
  it('refuses a folder where the file should be', () => {
    const file = join(dir(), 'trust', 'ca.pem');
    mkdirSync(file, { recursive: true });
    expect(() => ensureTrustFile(file)).toThrow('is not a file that can be read');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('refuses a file that cannot be read', () => {
    const file = join(dir(), 'ca.pem');
    writeFileSync(file, 'x');
    chmodSync(file, 0o000);
    try {
      expect(() => ensureTrustFile(file)).toThrow('is not a file that can be read');
    } finally {
      chmodSync(file, 0o644);
    }
  });
});

describe('startAgain', () => {
  /** A tiny program for the child to run. */
  function script(body: string): string {
    const file = join(dir(), 'child.cjs');
    writeFileSync(file, body);
    return file;
  }

  it('starts again with the same arguments and the variable set, and returns the exit code', async () => {
    const d = dir();
    const seen = join(d, 'seen.json');
    const child = script(
      `require('node:fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ ca: process.env.NODE_EXTRA_CA_CERTS, again: process.env.${TRUST_RESTARTED}, args: process.argv.slice(2), keep: process.env.KEEP_ME }));
       process.exit(7);`,
    );
    const trustFile = join(d, 'ca.pem');
    writeFileSync(trustFile, '');
    const code = await startAgain({ trustFile, argv: [child, 'start', '--port', '3999'], eventsFd: undefined, env: { ...process.env, KEEP_ME: 'yes' } });
    expect(code).toBe(7);
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toEqual({ ca: trustFile, again: '1', args: ['start', '--port', '3999'], keep: 'yes' });
  });

  it('really loads the trust file in the program it starts', async () => {
    // The whole point: Node reads this file only when the process starts.
    const d = dir();
    const seen = join(d, 'count.txt');
    const child = script(`require('node:fs').writeFileSync(${JSON.stringify(seen)}, String(require('node:tls').getCACertificates?.('extra').length ?? 'no such function'));`);
    const trustFile = join(d, 'ca.pem');
    writeFileSync(trustFile, readFileSync(new URL('../../../packages/bootstrap/src/network-trust.fixtures.ts', import.meta.url), 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----\n/)![0]);
    expect(await startAgain({ trustFile, argv: [child], eventsFd: undefined })).toBe(0);
    expect(['1', 'no such function']).toContain(readFileSync(seen, 'utf8'));
  });

  it('passes the events descriptor through, at the same number', async () => {
    const child = script(`require('node:fs').writeSync(Number(process.argv[2]), 'hello from the child\\n');`);
    for (let round = 0; round < 2; round++) {
      const d = dir();
      const out = join(d, 'events.txt');
      // Hold a few descriptors open so the two rounds get different numbers.
      const held = Array.from({ length: round * 2 }, () => openSync(out, 'a'));
      const fd = openSync(out, 'a');
      try {
        expect(fd).toBeGreaterThanOrEqual(3);
        expect(await startAgain({ trustFile: join(d, 'ca.pem'), argv: [child, String(fd)], eventsFd: fd })).toBe(0);
      } finally {
        closeSync(fd);
        for (const h of held) closeSync(h);
      }
      expect(readFileSync(out, 'utf8')).toBe('hello from the child\n');
    }
  });

  it('refuses an events descriptor it cannot pass on, at once and without starting anything', async () => {
    const d = dir();
    const ran = join(d, 'ran');
    const child = script(`require('node:fs').writeFileSync(${JSON.stringify(ran)}, '');`);
    for (const fd of [MAX_EVENTS_FD + 1, Number.MAX_SAFE_INTEGER, 2, 3.5]) {
      const started = Date.now();
      await expect(startAgain({ trustFile: join(d, 'ca.pem'), argv: [child], eventsFd: fd })).rejects.toThrow('--events-fd');
      expect(Date.now() - started).toBeLessThan(500);
    }
    expect(existsSync(ran)).toBe(false);
  });

  it('gives the child no events descriptor when there is none', async () => {
    const child = script(`try { require('node:fs').writeSync(3, 'x'); process.exit(4); } catch { process.exit(0); }`);
    expect(await startAgain({ trustFile: join(dir(), 'ca.pem'), argv: [child], eventsFd: undefined })).toBe(0);
  });

  it('returns the exit code of a child that fails to start', async () => {
    expect(await startAgain({ trustFile: join(dir(), 'ca.pem'), argv: [script('process.exit(2);')], eventsFd: undefined })).toBe(2);
    // A program that is not there: Node itself exits 1.
    expect(await startAgain({ trustFile: join(dir(), 'ca.pem'), argv: [join(dir(), 'missing.cjs')], eventsFd: undefined, quiet: true })).toBe(1);
  });

  it('gives 1 when the program cannot be run at all', async () => {
    expect(await startAgain({ trustFile: join(dir(), 'ca.pem'), argv: [script('')], eventsFd: undefined, execPath: join(dir(), 'no-such-node') })).toBe(1);
  });

  it.skipIf(process.platform === 'win32')('passes SIGTERM, SIGINT and SIGHUP to the child, which owns the stop', async () => {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
      const d = dir();
      const ready = join(d, 'ready');
      const child = script(
        `process.on('${signal}', () => process.exit(9));
         require('node:fs').writeFileSync(${JSON.stringify(ready)}, '');
         setInterval(() => {}, 1000);`,
      );
      const signals = new EventEmitter();
      const done = startAgain({ trustFile: join(d, 'ca.pem'), argv: [child], eventsFd: undefined, signals });
      while (!existsSync(ready)) await new Promise((r) => setTimeout(r, 20));
      signals.emit(signal);
      expect(await done).toBe(9);
      // Its listeners are gone once the child has ended.
      expect(signals.listenerCount('SIGTERM') + signals.listenerCount('SIGINT') + signals.listenerCount('SIGHUP')).toBe(0);
    }
  });

  it.skipIf(process.platform === 'win32')('gives 128 plus the signal number when a signal ends the child', async () => {
    const child = script(`process.kill(process.pid, 'SIGKILL');`);
    expect(await startAgain({ trustFile: join(dir(), 'ca.pem'), argv: [child], eventsFd: undefined })).toBe(137);
  });
});
