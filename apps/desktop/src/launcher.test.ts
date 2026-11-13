import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  launcherEnv,
  lineSplitter,
  parseEventLine,
  readStatus,
  requestSetupCode,
  requestStop,
  runLauncher,
  startArgs,
  startLauncher,
  type LauncherEvent,
  type LauncherTarget,
  type Spawn,
} from './launcher';

const target: LauncherTarget = { execPath: '/opt/app/electron', entry: '/opt/standalone/dist/index.js' };
const withData: LauncherTarget = { ...target, dataDir: '/tmp/openldr d-é/data' };

/** A fake child process. Its stdio array has a stream at 1, 2 and 3; tests write to them. */
interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdio: [null, PassThrough, PassThrough, PassThrough];
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [null, child.stdout, child.stderr, new PassThrough()];
  child.kill = vi.fn();
  return child;
}

/** A spawn that answers each call with the given output and exit code, after a tick. */
function scriptedSpawn(answer: { stdout?: string; stderr?: string; code: number | null }) {
  const children: FakeChild[] = [];
  const spawn = vi.fn((..._args: unknown[]) => {
    const child = fakeChild();
    children.push(child);
    setImmediate(() => {
      if (answer.stdout) child.stdout.write(answer.stdout);
      if (answer.stderr) child.stderr.write(answer.stderr);
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', answer.code, null));
    });
    return child;
  });
  return { spawn: spawn as unknown as Spawn, calls: spawn.mock.calls, children };
}

const EVERY_SHAPE: LauncherEvent[] = [
  { event: 'starting', step: 'postgres' },
  { event: 'starting', step: 'server' },
  { event: 'recovering' },
  { event: 'ready', address: 'http://localhost:3990/studio/' },
  { event: 'stopping' },
  { event: 'stopped', result: 'clean' },
  { event: 'stopped', result: 'forced' },
  { event: 'error', message: 'Port 3990 is in use.' },
];

describe('parseEventLine', () => {
  it.each(EVERY_SHAPE)('parses %j', (e) => {
    expect(parseEventLine(JSON.stringify(e))).toEqual(e);
  });

  it('gives undefined for a line that is not JSON', () => {
    expect(parseEventLine('OpenLDR is running at http://localhost:3990/studio/')).toBeUndefined();
    expect(parseEventLine('')).toBeUndefined();
    expect(parseEventLine('{"event":')).toBeUndefined();
  });

  it('gives undefined for an unknown event, or a known one with a bad field', () => {
    expect(parseEventLine('{"event":"exploded"}')).toBeUndefined();
    expect(parseEventLine('{"step":"postgres"}')).toBeUndefined();
    expect(parseEventLine('null')).toBeUndefined();
    expect(parseEventLine('[1]')).toBeUndefined();
    expect(parseEventLine('{"event":"starting","step":"kettle"}')).toBeUndefined();
    expect(parseEventLine('{"event":"ready"}')).toBeUndefined();
    expect(parseEventLine('{"event":"stopped","result":"maybe"}')).toBeUndefined();
    expect(parseEventLine('{"event":"error","message":5}')).toBeUndefined();
  });

  it('keeps only the known fields', () => {
    expect(parseEventLine('{"event":"ready","address":"http://localhost:3990/studio/","extra":"x"}')).toEqual({
      event: 'ready',
      address: 'http://localhost:3990/studio/',
    });
  });
});

describe('lineSplitter', () => {
  it('gives whole lines, across chunk edges, without the line ends', () => {
    const lines: string[] = [];
    const feed = lineSplitter((l) => lines.push(l));
    feed('one\ntw');
    feed('o\r\nthree');
    expect(lines).toEqual(['one', 'two']);
    feed('\n\nfour\n');
    expect(lines).toEqual(['one', 'two', 'three', 'four']);
  });
});

describe('launcherEnv', () => {
  it('adds ELECTRON_RUN_AS_NODE=1 and leaves the base alone', () => {
    const base = { PATH: '/usr/bin', HOME: '/home/x' };
    expect(launcherEnv(base)).toEqual({ PATH: '/usr/bin', HOME: '/home/x', ELECTRON_RUN_AS_NODE: '1' });
    expect(base).toEqual({ PATH: '/usr/bin', HOME: '/home/x' });
  });
});

describe('startArgs', () => {
  it('starts on 127.0.0.1 with events on descriptor 3', () => {
    expect(startArgs(target, 3990)).toEqual([
      target.entry, 'start', '--host', '127.0.0.1', '--port', '3990', '--events-fd', '3',
    ]);
  });

  it('adds the data folder when it is set', () => {
    expect(startArgs(withData, 3991)).toEqual([
      target.entry, 'start', '--host', '127.0.0.1', '--port', '3991', '--events-fd', '3', '--data-dir', withData.dataDir,
    ]);
  });
});

describe('runLauncher', () => {
  it('runs execPath with the args and the launcher env, and collects the output', async () => {
    const s = scriptedSpawn({ stdout: 'out\n', stderr: 'err\n', code: 3 });
    const r = await runLauncher(target, ['a', 'b'], s.spawn);
    expect(r).toEqual({ code: 3, stdout: 'out\n', stderr: 'err\n' });
    const [file, args, options] = s.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(file).toBe(target.execPath);
    expect(args).toEqual(['a', 'b']);
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(s.children[0]!.kill).not.toHaveBeenCalled();
  });
});

describe('readStatus', () => {
  it('runs status --json, with the data folder when set', async () => {
    const s = scriptedSpawn({ stdout: '{"dataDir":"/d","running":false}\n', code: 3 });
    await readStatus(target, s.spawn);
    expect(s.calls[0]![1]).toEqual([target.entry, 'status', '--json']);
    await readStatus(withData, s.spawn);
    expect(s.calls[1]![1]).toEqual([target.entry, 'status', '--json', '--data-dir', withData.dataDir]);
  });

  it('passes address and host through unchanged', async () => {
    const line = '{"dataDir":"/d","running":true,"address":"http://localhost:3990/studio/","host":"127.0.0.1"}\n';
    const s = scriptedSpawn({ stdout: line, code: 0 });
    expect(await readStatus(target, s.spawn)).toEqual({
      running: true, address: 'http://localhost:3990/studio/', dataDir: '/d', host: '127.0.0.1',
    });
  });

  it('has no host when the lock has none', async () => {
    const line = '{"dataDir":"/d","running":true,"address":"http://localhost:3990/studio/"}\n';
    const s = scriptedSpawn({ stdout: line, code: 0 });
    const status = await readStatus(target, s.spawn);
    expect(status).toEqual({ running: true, address: 'http://localhost:3990/studio/', dataDir: '/d' });
    expect('host' in status).toBe(false);
  });

  it('reads not running, and busy', async () => {
    let s = scriptedSpawn({ stdout: '{"dataDir":"/d","running":false}\n', code: 3 });
    expect(await readStatus(target, s.spawn)).toEqual({ running: false, dataDir: '/d' });
    s = scriptedSpawn({ stdout: '{"dataDir":"/d","running":false,"busy":"A recovery command is running."}\n', code: 3 });
    expect(await readStatus(target, s.spawn)).toEqual({ running: false, dataDir: '/d', busy: 'A recovery command is running.' });
  });

  it('gives not running for output it cannot read', async () => {
    for (const stdout of ['', 'Data folder: /d\n', '{"running":true}\n', '{"running":"yes"}\n', '[]\n']) {
      const s = scriptedSpawn({ stdout, code: 1 });
      expect(await readStatus(target, s.spawn)).toEqual({ running: false });
    }
  });

  it('gives not running when the launcher cannot be run at all', async () => {
    const spawn = vi.fn(() => {
      const child = fakeChild();
      setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    }) as unknown as Spawn;
    expect(await readStatus(target, spawn)).toEqual({ running: false });
  });
});

describe('requestSetupCode', () => {
  const PLANTED = 'planted-secret-7Q2X';

  it('runs cli with the data folder before the --', async () => {
    const out = JSON.stringify({ setupCode: PLANTED, validForMinutes: 30 }, null, 2) + '\n';
    const s = scriptedSpawn({ stdout: out, code: 0 });
    await requestSetupCode(target, s.spawn);
    expect(s.calls[0]![1]).toEqual([target.entry, 'cli', '--', 'auth', 'setup-code', '--json']);
    await requestSetupCode(withData, s.spawn);
    expect(s.calls[1]![1]).toEqual([target.entry, 'cli', '--data-dir', withData.dataDir, '--', 'auth', 'setup-code', '--json']);
  });

  it('returns the setupCode field of the JSON the CLI prints over several lines', async () => {
    const out = JSON.stringify({ setupCode: PLANTED, validForMinutes: 30 }, null, 2) + '\n';
    const s = scriptedSpawn({ stdout: out, code: 0 });
    expect(await requestSetupCode(target, s.spawn)).toBe(PLANTED);
  });

  it('finds the JSON after a line of other output', async () => {
    const out = 'a line before\n' + JSON.stringify({ setupCode: PLANTED, validForMinutes: 30 }, null, 2) + '\n';
    const s = scriptedSpawn({ stdout: out, code: 0 });
    expect(await requestSetupCode(target, s.spawn)).toBe(PLANTED);
  });

  it('throws on a non-zero exit, without the child output in the message', async () => {
    const s = scriptedSpawn({ stdout: `${PLANTED}-out\n`, stderr: `${PLANTED}-err an administrator already exists\n`, code: 1 });
    const err = await requestSetupCode(target, s.spawn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(PLANTED);
    expect((err as Error).message).not.toContain('administrator');
  });

  it('throws on output it cannot read, without the output in the message', async () => {
    for (const stdout of [`${PLANTED}\n`, `{"setupCode":5,"x":"${PLANTED}"}\n`, `{"setupCode":""}\n`, '']) {
      const s = scriptedSpawn({ stdout, stderr: `${PLANTED}\n`, code: 0 });
      const err = await requestSetupCode(target, s.spawn).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toContain(PLANTED);
    }
  });

  it('throws when the launcher cannot be run, without the spawn error text', async () => {
    const spawn = vi.fn(() => {
      const child = fakeChild();
      setImmediate(() => child.emit('error', new Error(`spawn ${PLANTED}`)));
      return child;
    }) as unknown as Spawn;
    const err = await requestSetupCode(target, spawn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(PLANTED);
  });
});

describe('requestStop', () => {
  it('runs stop, with the data folder when set, and gives its exit code', async () => {
    let s = scriptedSpawn({ stdout: 'OpenLDR stopped.\n', code: 0 });
    expect(await requestStop(target, s.spawn)).toBe(0);
    expect(s.calls[0]![1]).toEqual([target.entry, 'stop']);
    s = scriptedSpawn({ code: 1 });
    expect(await requestStop(withData, s.spawn)).toBe(1);
    expect(s.calls[0]![1]).toEqual([target.entry, 'stop', '--data-dir', withData.dataDir]);
  });

  it('gives 1 when stop ends by a signal or cannot be run', async () => {
    const s = scriptedSpawn({ code: null });
    expect(await requestStop(target, s.spawn)).toBe(1);
    const spawn = vi.fn(() => {
      const child = fakeChild();
      setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    }) as unknown as Spawn;
    expect(await requestStop(target, spawn)).toBe(1);
  });
});

describe('startLauncher, with a fake child', () => {
  it('spawns execPath with startArgs, the launcher env and four stdio slots', () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    startLauncher(withData, 3990, { event: () => {}, stderrLine: () => {} }, spawn as unknown as Spawn);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [file, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv; stdio: unknown }];
    expect(file).toBe(withData.execPath);
    expect(args).toEqual(startArgs(withData, 3990));
    expect(options.env).toEqual(launcherEnv(process.env));
    expect(options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'pipe']);
  });

  it('feeds events from descriptor 3 and lines from standard error, then the exit code; never kills', async () => {
    const child = fakeChild();
    const events: LauncherEvent[] = [];
    const stderr: string[] = [];
    const running = startLauncher(
      target,
      3990,
      { event: (e) => events.push(e), stderrLine: (l) => stderr.push(l) },
      (() => child) as unknown as Spawn,
    );
    const fd3 = child.stdio[3];
    fd3.write('{"event":"starting","step":"postgres"}\n{"event":"rea');
    fd3.write('dy","address":"http://localhost:3990/studio/"}\nnot json\n{"event":"unknown"}\n');
    child.stderr.write('first line\nsecond ');
    child.stderr.write('line\n');
    fd3.end();
    child.stderr.end();
    await new Promise((r) => setImmediate(r));
    child.emit('close', 0, null);
    expect(await running.exited).toBe(0);
    expect(events).toEqual([
      { event: 'starting', step: 'postgres' },
      { event: 'ready', address: 'http://localhost:3990/studio/' },
    ]);
    expect(stderr).toEqual(['first line', 'second line']);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('resolves exited with null and says so on standard error when the spawn fails', async () => {
    const child = fakeChild();
    const stderr: string[] = [];
    const running = startLauncher(target, 3990, { event: () => {}, stderrLine: (l) => stderr.push(l) }, (() => child) as unknown as Spawn);
    child.emit('error', new Error('spawn /opt/app/electron ENOENT'));
    child.emit('close', -2, null);
    expect(await running.exited).toBeNull();
    expect(stderr).toHaveLength(1);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe('startLauncher and runLauncher, with a real child process', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads events from a real descriptor 3 and lines from real standard error', async () => {
    dir = mkdtempSync(join(tmpdir(), 'openldr-desktop-launcher-'));
    const entry = join(dir, 'fake-launcher.mjs');
    writeFileSync(
      entry,
      [
        "import { writeSync } from 'node:fs';",
        "if (process.env.ELECTRON_RUN_AS_NODE !== '1') process.exit(9);",
        "const port = process.argv[process.argv.indexOf('--port') + 1];",
        "writeSync(3, JSON.stringify({ event: 'starting', step: 'postgres' }) + '\\n');",
        "writeSync(3, JSON.stringify({ event: 'ready', address: `http://localhost:${port}/studio/` }) + '\\n');",
        "process.stderr.write('a line on standard error\\n');",
        'process.exit(7);',
      ].join('\n'),
    );
    const events: LauncherEvent[] = [];
    const stderr: string[] = [];
    const running = startLauncher(
      { execPath: process.execPath, entry },
      3990,
      { event: (e) => events.push(e), stderrLine: (l) => stderr.push(l) },
    );
    expect(await running.exited).toBe(7);
    expect(events).toEqual([
      { event: 'starting', step: 'postgres' },
      { event: 'ready', address: 'http://localhost:3990/studio/' },
    ]);
    expect(stderr).toEqual(['a line on standard error']);
  });

  it('collects real output and the exit code', async () => {
    dir = mkdtempSync(join(tmpdir(), 'openldr-desktop-launcher-'));
    const entry = join(dir, 'fake-status.mjs');
    writeFileSync(entry, "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }) + '\\n'); process.exit(3);");
    const r = await runLauncher({ execPath: process.execPath, entry }, [entry, 'status', '--json']);
    expect(r.code).toBe(3);
    expect(JSON.parse(r.stdout)).toEqual({ argv: ['status', '--json'] });
    expect(r.stderr).toBe('');
  });
});
