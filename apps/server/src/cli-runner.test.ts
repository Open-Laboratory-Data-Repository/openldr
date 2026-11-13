// Layer under test: cli-runner.ts starting a real child process (the fake CLI in __fixtures__, never
// the real one) and handing it a command on descriptor 3. Linux only: Windows and macOS are unproven.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { setTimeout as realSleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConfigSchema } from '@openldr/config';
import {
  childEnv, ClosingError, createCliRunner, KILL_AFTER_MS, NOT_PATH_SETTINGS, PATH_SETTINGS, resolveCliEntry, SLOT_WAIT_MS,
} from './cli-runner';

/** Polls on real time, which the fake timers do not touch. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !check(); i += 1) await realSleep(10);
  if (!check()) throw new Error('timed out waiting');
}

const FAKE = fileURLToPath(new URL('./__fixtures__/fake-cli.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function runDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'cli-runner-'));
  dirs.push(d);
  return d;
}

function handoff(argv: string[], dir: string) {
  return {
    path: 'roles list',
    argv,
    caller: { id: 'u1', username: 'alice', displayName: null, keyName: null },
    runDir: dir,
    keptDirs: [],
  };
}

async function text(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads a stream as it arrives. `until` resolves once the text so far holds the given string. */
function collect(stream: Readable) {
  let seen = '';
  const waits: Array<{ s: string; resolve: () => void }> = [];
  stream.on('data', (c: Buffer) => {
    seen += c.toString('utf8');
    for (const w of waits.splice(0)) {
      if (seen.includes(w.s)) w.resolve();
      else waits.push(w);
    }
  });
  const done = new Promise<string>((resolve) => stream.on('end', () => resolve(seen)));
  return {
    done,
    until: (s: string) => (seen.includes(s) ? Promise.resolve() : new Promise<void>((resolve) => waits.push({ s, resolve }))),
  };
}

describe('createCliRunner', () => {
  it('hands a started process its arguments on descriptor 3, and SIGINT reaches it', async () => {
    const runner = createCliRunner({ maxRunning: 2 });
    const dir = runDir();

    const slot = await runner.acquire();
    const run = runner.start(slot, { id: 'r1', entry: FAKE, ownerId: 'u1', handoff: handoff(['echo', 'a b', '--x=1'], dir) });
    const [out, err, code] = await Promise.all([text(run.stdout), text(run.stderr), run.exited]);
    slot.release();
    expect(out).toBe('["echo","a b","--x=1"]\n');
    expect(err).toBe('alice\n');
    expect(code).toBe(0);

    const slot2 = await runner.acquire();
    const sleeper = runner.start(slot2, { id: 'r2', entry: FAKE, ownerId: 'u1', handoff: handoff(['sleep', '60000'], dir) });
    const outText = collect(sleeper.stdout);
    // Wait until it is running, then interrupt it.
    await outText.until('sleeping\n');
    sleeper.interrupt();
    expect(await sleeper.exited).toBe(0);
    expect(await outText.done).toBe('sleeping\ninterrupted\n');
    expect(sleeper.interrupted).toBe(true);
    slot2.release();
    await runner.close();
  });

  it('gives a relative path setting to the child as an absolute path under the server folder', async () => {
    const serverCwd = runDir();
    const dir = runDir();
    const runner = createCliRunner({
      maxRunning: 1,
      env: { ...process.env, LOG_FILE: '/tmp/server.log', BLOB_DIR: './data' },
      settings: { BLOB_DIR: './data', PLUGIN_CRASH_LOG_DIR: '.openldr/crash', WORKFLOW_FILE_ACCESS_ROOT: '' },
      cwd: serverCwd,
    });
    const slot = await runner.acquire();
    const run = runner.start(slot, { id: 'r1', entry: FAKE, ownerId: 'u1', handoff: handoff(['self'], dir) });
    const [out] = await Promise.all([text(run.stdout), run.exited]);
    slot.release();
    const env = (JSON.parse(out) as { env: Record<string, string> }).env;
    expect(env.BLOB_DIR).toBe(join(serverCwd, 'data'));
    expect(env.BLOB_DIR!.startsWith(dir)).toBe(false);
    expect(env.PLUGIN_CRASH_LOG_DIR).toBe(join(serverCwd, '.openldr', 'crash'));
    expect(env.WORKFLOW_FILE_ACCESS_ROOT).toBeUndefined();
    expect(env.LOG_FILE).toBeUndefined();
    expect(env.OPENLDR_SKIP_ENV_FILE).toBe('true');
    // The child deletes the served flag itself in the real CLI; the fake leaves it.
    expect(env.OPENLDR_SERVED_FD).toBe('3');
  });

  it('runs two at once, makes the third wait, and answers busy after 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const runner = createCliRunner({ maxRunning: 2 });
      const a = await runner.acquire();
      const b = await runner.acquire();
      let third: string = 'waiting';
      const waiting = runner.acquire().then((s) => { third = 'got'; return s; }, (e: Error) => { third = e.name; return null; });
      await vi.advanceTimersByTimeAsync(SLOT_WAIT_MS - 1);
      expect(third).toBe('waiting');
      await vi.advanceTimersByTimeAsync(1);
      expect(third).toBe('BusyError');
      expect(await waiting).toBeNull();

      // A waiter gets the slot the moment one is released.
      const fourth = runner.acquire();
      a.release();
      a.release(); // a second release frees nothing more
      const got = await fourth;
      await expect(Promise.race([runner.acquire().then(() => 'got'), Promise.resolve('waiting')])).resolves.toBe('waiting');
      b.release();
      got.release();
    } finally {
      vi.useRealTimers();
    }
  });

  /** 'got', an error name, or 'waiting' when the promise has not settled by the next turn of the
   *  event loop. setImmediate is not faked here, so this works under the fake timers too. */
  const settledState = (p: Promise<unknown>): Promise<string> =>
    Promise.race([p.then(() => 'got', (e: Error) => e.name), new Promise<string>((r) => setImmediate(() => r('waiting')))]);

  it('with 2 slots, one account runs one command at a time while another account starts at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const runner = createCliRunner({ maxRunning: 2 });
      const state = (p: Promise<unknown>) => settledState(p);
      const a1 = await runner.acquire(undefined, 'account-a');
      // A's second waits, though a slot is free.
      const a2 = runner.acquire(undefined, 'account-a');
      expect(await state(a2)).toBe('waiting');
      // B arrives behind A's waiter and starts at once: A's waiter does not block it.
      const b1 = await runner.acquire(undefined, 'account-b');
      expect(await state(a2)).toBe('waiting');
      // When A's first ends, A's second starts.
      a1.release();
      expect(await state(a2)).toBe('got');
      (await a2).release();
      b1.release();

      // Over its share, A's request gets the same busy answer after the same wait.
      const a3 = await runner.acquire(undefined, 'account-a');
      let a4: string = 'waiting';
      const waiting = runner.acquire(undefined, 'account-a').then(() => { a4 = 'got'; }, (e: Error) => { a4 = e.name; });
      await vi.advanceTimersByTimeAsync(SLOT_WAIT_MS - 1);
      expect(a4).toBe('waiting');
      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(a4).toBe('BusyError');
      a3.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('with 2 slots, a waiter held back by its share does not block a later waiter from another account', async () => {
    const runner = createCliRunner({ maxRunning: 2 });
    const state = (p: Promise<unknown>) => settledState(p);
    const a1 = await runner.acquire(undefined, 'account-a');
    const c1 = await runner.acquire(undefined, 'account-c');
    // Both slots are held. A queues first, then B.
    const a2 = runner.acquire(undefined, 'account-a');
    const b1 = runner.acquire(undefined, 'account-b');
    // C's slot frees. A is still at its share, so B, behind it, takes the slot.
    c1.release();
    expect(await state(b1)).toBe('got');
    expect(await state(a2)).toBe('waiting');
    a1.release();
    expect(await state(a2)).toBe('got');
    (await a2).release();
    (await b1).release();
  });

  it('with 1 slot, the same account and other accounts wait in arrival order as before', async () => {
    const runner = createCliRunner({ maxRunning: 1 });
    const state = (p: Promise<unknown>) => settledState(p);
    const a1 = await runner.acquire(undefined, 'account-a');
    const b1 = runner.acquire(undefined, 'account-b');
    const a2 = runner.acquire(undefined, 'account-a');
    expect(await state(b1)).toBe('waiting');
    a1.release();
    expect(await state(b1)).toBe('got');
    expect(await state(a2)).toBe('waiting');
    (await b1).release();
    expect(await state(a2)).toBe('got');
    (await a2).release();
  });

  it('frees nothing it did not hold when a waiting caller leaves', async () => {
    const runner = createCliRunner({ maxRunning: 1 });
    const a = await runner.acquire();
    const left = new AbortController();
    const leaving = runner.acquire(left.signal).catch((e: Error) => e.name);
    const next = runner.acquire();
    left.abort();
    expect(await leaving).toBe('LeftError');
    // The slot is still held by a; the next caller still waits.
    expect(await Promise.race([next.then(() => 'got'), new Promise((r) => setImmediate(() => r('waiting')))])).toBe('waiting');
    a.release();
    (await next).release();
  });

  it('kills a command that ignores SIGINT after 10 seconds, and a second interrupt does not restart the wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const dir = runDir();
      const marker = join(dir, 'got-sigint');
      const runner = createCliRunner({ maxRunning: 1 });
      const slot = await runner.acquire();
      const run = runner.start(slot, { id: 'r1', entry: FAKE, ownerId: 'u1', handoff: handoff(['stubborn', marker], dir) });
      const out = collect(run.stdout);
      await out.until('stubborn\n');
      let code: number | null = null;
      void run.exited.then((c) => { code = c; });

      run.interrupt();
      await until(() => existsSync(marker));
      await vi.advanceTimersByTimeAsync(KILL_AFTER_MS - 1);
      run.interrupt();
      await realSleep(100);
      expect(code).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(await run.exited).toBe(137);
      slot.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('on close refuses waiting callers, interrupts running commands, and waits for every slot', async () => {
    const dir = runDir();
    const runner = createCliRunner({ maxRunning: 1 });
    const slot = await runner.acquire();
    const run = runner.start(slot, { id: 'r1', entry: FAKE, ownerId: 'u1', handoff: handoff(['sleep', '60000'], dir) });
    const out = collect(run.stdout);
    await out.until('sleeping\n');
    const waiting = runner.acquire().catch((e: Error) => e.name);

    let closed = false;
    const closing = runner.close().then(() => { closed = true; });
    expect(runner.closing).toBe(true);
    expect(await waiting).toBe('ClosingError');
    expect(await run.exited).toBe(0);
    expect(await out.done).toBe('sleeping\ninterrupted\n');
    // The caller still holds its slot for its clean-up, so close has not finished.
    await realSleep(20);
    expect(closed).toBe(false);
    slot.release();
    await closing;
    await expect(runner.acquire()).rejects.toThrow(ClosingError);
    expect(() => runner.start(slot, { id: 'r2', entry: FAKE, ownerId: 'u1', handoff: handoff(['echo'], dir) })).toThrow(ClosingError);
    expect(runner.close()).toBe(runner.close());
  });

  it('finds a run only for the account that started it, and forgets it once it has gone', async () => {
    const dir = runDir();
    const runner = createCliRunner({ maxRunning: 1 });
    const slot = await runner.acquire();
    const run = runner.start(slot, { id: 'r1', entry: FAKE, ownerId: 'u1', handoff: handoff(['sleep', '60000'], dir) });
    await collect(run.stdout).until('sleeping\n');
    expect(runner.find('r1', 'u1')).toBe(run);
    expect(runner.find('r1', 'u2')).toBeUndefined();
    expect(runner.find('r2', 'u1')).toBeUndefined();
    run.interrupt();
    await run.exited;
    expect(runner.find('r1', 'u1')).toBeUndefined();
    slot.release();
  });

  it('answers 1 for a process that cannot start', async () => {
    const runner = createCliRunner({ maxRunning: 1 });
    const slot = await runner.acquire();
    const run = runner.start(slot, { id: 'r1', entry: FAKE, ownerId: 'u1', handoff: handoff(['echo'], '/no/such/folder/here') });
    expect(await run.exited).toBe(1);
    slot.release();
  });
});

describe('resolveCliEntry', () => {
  it('uses CLI_ENTRY when set, resolved against the working folder, and null when it is missing', () => {
    expect(resolveCliEntry('bin/cli.js', { cwd: '/srv', exists: () => true })).toBe('/srv/bin/cli.js');
    expect(resolveCliEntry('/opt/cli.js', { exists: (p) => p === '/opt/cli.js' })).toBe('/opt/cli.js');
    expect(resolveCliEntry('/opt/cli.js', { exists: () => false })).toBeNull();
  });

  it('tries the image layout, then the checkout layout, beside the module', () => {
    const seen: string[] = [];
    const none = resolveCliEntry(undefined, { here: '/app/dist', exists: (p) => { seen.push(p); return false; } });
    expect(none).toBeNull();
    expect(seen).toEqual(['/app/cli/dist/index.js', '/packages/cli/dev.mjs']);
    expect(resolveCliEntry(undefined, { here: '/app/dist', exists: (p) => p === '/app/cli/dist/index.js' })).toBe('/app/cli/dist/index.js');
    expect(resolveCliEntry('', { here: '/repo/apps/server/src', exists: (p) => p === '/repo/packages/cli/dev.mjs' })).toBe('/repo/packages/cli/dev.mjs');
  });

  it('finds the checkout entry from this source folder', () => {
    expect(resolveCliEntry(undefined)).toBe(fileURLToPath(new URL('../../../packages/cli/dev.mjs', import.meta.url)));
  });

  it('finds the CLI from the example in .env.example, read from apps/server where `pnpm -C apps/server dev` runs', () => {
    const example = readFileSync(fileURLToPath(new URL('../../../.env.example', import.meta.url)), 'utf8');
    const value = /^# CLI_ENTRY=(.+)$/m.exec(example)?.[1];
    expect(value).toBeDefined();
    const serverFolder = fileURLToPath(new URL('..', import.meta.url));
    expect(resolveCliEntry(value, { cwd: serverFolder })).toBe(fileURLToPath(new URL('../../../packages/cli/dev.mjs', import.meta.url)));
  });
});

describe('childEnv', () => {
  it('adds the served flag and the skip flag, removes LOG_FILE, and changes nothing else', () => {
    const base = { A: '1', LOG_FILE: '/var/log/x', PATH: '/bin' };
    expect(childEnv(base, {}, '/srv')).toEqual({ A: '1', PATH: '/bin', OPENLDR_SERVED_FD: '3', OPENLDR_SKIP_ENV_FILE: 'true' });
    expect(base.LOG_FILE).toBe('/var/log/x');
  });

  it('lists every setting the schema names like a path', () => {
    let schema: z.ZodTypeAny = ConfigSchema;
    while (schema instanceof z.ZodEffects) schema = schema.innerType();
    const keys = Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape);
    expect(keys).toContain('BLOB_DIR');
    const known = new Set<string>([...PATH_SETTINGS, ...Object.keys(NOT_PATH_SETTINGS)]);
    const unlisted = keys.filter((k) => /_(DIR|PATH|ROOT|FILE)$/.test(k) && !known.has(k));
    expect(unlisted).toEqual([]);
  });
});
