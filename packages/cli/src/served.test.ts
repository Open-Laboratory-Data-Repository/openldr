import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Layers under test: reading the hand-off from a real file descriptor 3 in a real child process,
// and the preAction guard against the real command tree from buildProgram(). Not covered here: the
// server that starts the process (Task 9), and a real command's output through a real child
// (Task 15). Every command function the guard tests reach is mocked, so no test touches a database.

const mocks = vi.hoisted(() => ({
  runAuditList: vi.fn().mockResolvedValue(0),
  runRolesList: vi.fn().mockResolvedValue(0),
  runUserKeyCreate: vi.fn().mockResolvedValue(0),
  runDbMigrate: vi.fn().mockResolvedValue(0),
  runFhirValidate: vi.fn().mockResolvedValue(0),
  runArtifactPublish: vi.fn().mockResolvedValue(0),
  runSyncExport: vi.fn().mockResolvedValue(0),
  runSyncImport: vi.fn().mockResolvedValue(0),
  runMarketInstall: vi.fn().mockResolvedValue(0),
  runSettingsLabSet: vi.fn().mockResolvedValue(0),
  runQueryExport: vi.fn().mockResolvedValue(0),
  runReportRun: vi.fn().mockResolvedValue(0),
  runTerminologyImport: vi.fn().mockResolvedValue(0),
  runOntologyBuild: vi.fn().mockResolvedValue(0),
}));

vi.mock('./audit', async (orig) => ({ ...(await orig<typeof import('./audit')>()), runAuditList: mocks.runAuditList }));
vi.mock('./roles', async (orig) => ({ ...(await orig<typeof import('./roles')>()), runRolesList: mocks.runRolesList }));
vi.mock('./user', async (orig) => ({ ...(await orig<typeof import('./user')>()), runUserKeyCreate: mocks.runUserKeyCreate }));
vi.mock('./db', async (orig) => ({ ...(await orig<typeof import('./db')>()), runDbMigrate: mocks.runDbMigrate }));
vi.mock('./fhir', async (orig) => ({ ...(await orig<typeof import('./fhir')>()), runFhirValidate: mocks.runFhirValidate }));
vi.mock('./artifact', async (orig) => ({ ...(await orig<typeof import('./artifact')>()), runArtifactPublish: mocks.runArtifactPublish }));
vi.mock('./sync', async (orig) => ({
  ...(await orig<typeof import('./sync')>()), runSyncExport: mocks.runSyncExport, runSyncImport: mocks.runSyncImport,
}));
vi.mock('./market', async (orig) => ({ ...(await orig<typeof import('./market')>()), runMarketInstall: mocks.runMarketInstall }));
vi.mock('./settings', async (orig) => ({ ...(await orig<typeof import('./settings')>()), runSettingsLabSet: mocks.runSettingsLabSet }));
vi.mock('./query', async (orig) => ({ ...(await orig<typeof import('./query')>()), runQueryExport: mocks.runQueryExport }));
vi.mock('./report', async (orig) => ({ ...(await orig<typeof import('./report')>()), runReportRun: mocks.runReportRun }));
vi.mock('./terminology', async (orig) => ({
  ...(await orig<typeof import('./terminology')>()), runTerminologyImport: mocks.runTerminologyImport, runOntologyBuild: mocks.runOntologyBuild,
}));

import { buildProgram } from './program';
import {
  enterRunDir, HandoffError, MAX_HANDOFF_BYTES, parseHandoff, refuseHelp, resetServedHandoffForTests, ServedRefusal,
  setServedHandoff, type ServedHandoff,
} from './served';

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const CALLER: ServedHandoff['caller'] = { id: 'u-1', username: 'alice', displayName: 'Alice', keyName: 'ci' };

let base: string;
let runDir: string;
let keptDir: string;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'openldr-served-')));
  runDir = join(base, 'run1');
  keptDir = join(base, 'kept');
  mkdirSync(runDir);
  mkdirSync(keptDir);
  mkdirSync(join(base, 'run10'));
  mkdirSync(join(runDir, 'loinc'));
  mkdirSync(join(keptDir, 'dist'));
  writeFileSync(join(runDir, 'bundle.json'), '{}');
  writeFileSync(join(keptDir, 'bundle.json'), '{}');
  writeFileSync(join(base, 'run10', 'x'), 'x');
  symlinkSync('/etc', join(runDir, 'link'));
  // A link whose target does not exist: a write through it would create a file outside runDir.
  symlinkSync(join(base, 'outside', 'made.json'), join(runDir, 'dangling'));
  // A link that stays inside runDir, and a run folder that is itself a link.
  symlinkSync(join(runDir, 'loinc'), join(runDir, 'inner'));
  symlinkSync(runDir, join(base, 'runlink'));
  symlinkSync('/', join(base, 'rootlink'));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

// ---------------------------------------------------------------------------------------------
// Descriptor 3, in a real child process.
// ---------------------------------------------------------------------------------------------

interface ChildResult { code: number | null; stdout: string; stderr: string }

/** Starts `node --import tsx <script> ...args` in a temporary folder, with an environment built
 *  from an allow-list: no database URL, no secrets key, and the dev .env never read. `fd3`
 *  undefined gives the child no fourth descriptor; a string is written on a fourth pipe. */
function runChild(script: string, args: string[], opts: { servedFd?: string; fd3?: string; env?: Record<string, string> }): Promise<ChildResult> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: base, OPENLDR_SKIP_ENV_FILE: 'true', ...opts.env };
  if (opts.servedFd !== undefined) env.OPENLDR_SERVED_FD = opts.servedFd;
  const stdio: ('ignore' | 'pipe')[] = opts.fd3 === undefined ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', 'pipe'];
  // The command tree loads WASI, which prints a warning on standard error at start.
  const node = ['--disable-warning=ExperimentalWarning', '--import', TSX];
  const child = spawn(process.execPath, [...node, script, ...args], { cwd: base, env, stdio });
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (b: Buffer) => { stdout += b.toString(); });
  child.stderr!.on('data', (b: Buffer) => { stderr += b.toString(); });
  if (opts.fd3 !== undefined) {
    const pipe = child.stdio[3] as NodeJS.WritableStream;
    pipe.on('error', () => {});
    pipe.end(opts.fd3);
  }
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, stdout, stderr })));
}

/** A small script that imports served.ts and prints what readHandoff() gave. */
function probeScript(): string {
  const file = join(base, 'probe.mjs');
  writeFileSync(file, [
    `const { readHandoff } = await import(${JSON.stringify(pathToFileURL(join(HERE, 'served.ts')).href)});`,
    'let out;',
    'try { out = { handoff: readHandoff() }; } catch (e) { out = { error: e.name, message: e.message }; }',
    'out.envLeft = process.env.OPENLDR_SERVED_FD ?? null;',
    'process.stdout.write(JSON.stringify(out));',
  ].join('\n'));
  return file;
}

const GOOD: ServedHandoff = { path: 'roles list', argv: ['roles', 'list'], caller: CALLER, runDir: '/srv/run1', keptDirs: [] };

describe('reading the hand-off from descriptor 3', () => {
  it('reads the hand-off from descriptor 3 and returns null when there is none', async () => {
    const probe = probeScript();
    const read = await runChild(probe, [], { servedFd: '3', fd3: JSON.stringify(GOOD) });
    expect(read.code).toBe(0);
    expect(JSON.parse(read.stdout)).toEqual({ handoff: GOOD, envLeft: null });

    // Without the variable, descriptor 3 is never read, even when one is open.
    const none = await runChild(probe, [], { fd3: JSON.stringify(GOOD) });
    expect(none.code).toBe(0);
    expect(JSON.parse(none.stdout)).toEqual({ handoff: null, envLeft: null });
  });

  it('fails closed when the variable is set and the hand-off is missing or not JSON', async () => {
    const probe = probeScript();
    const noPipe = await runChild(probe, [], { servedFd: '3' });
    expect(JSON.parse(noPipe.stdout)).toMatchObject({ error: 'HandoffError', envLeft: null });
    const notJson = await runChild(probe, [], { servedFd: '3', fd3: 'roles list' });
    expect(JSON.parse(notJson.stdout)).toMatchObject({ error: 'HandoffError', envLeft: null });
    const otherFd = await runChild(probe, [], { servedFd: '4', fd3: JSON.stringify(GOOD) });
    expect(JSON.parse(otherFd.stdout)).toMatchObject({ error: 'HandoffError', envLeft: null });
  });

  it('refuses a hand-off larger than 1 MiB', async () => {
    const big = JSON.stringify({ ...GOOD, argv: ['roles', 'list', 'x'.repeat(MAX_HANDOFF_BYTES)] });
    const r = await runChild(probeScript(), [], { servedFd: '3', fd3: big });
    expect(JSON.parse(r.stdout)).toEqual({ error: 'HandoffError', message: 'The hand-off is larger than 1 MiB.', envLeft: null });
  });

  it('the entry prints one line and exits 1 on a bad hand-off, never running its own argv', async () => {
    // `commands` needs no database. If the entry fell back to its argv, it would print the list.
    const r = await runChild(join(HERE, 'index.ts'), ['commands'], { servedFd: '3', fd3: '{"path":' });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('The hand-off is not JSON.\n');
  });

  it('the entry runs the guard on the handed-over command in a real process', async () => {
    // A local command handed over is refused. This proves the entry parsed the hand-off's argv,
    // not its own, and that a refusal exits 1 with the message.
    const handoff = { ...GOOD, path: 'commands', argv: ['commands'], runDir: base };
    const r = await runChild(join(HERE, 'index.ts'), ['roles', 'list'], { servedFd: '3', fd3: JSON.stringify(handoff) });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('commands does not run through the app.\n');
  });

  it('the entry refuses help and version in served mode, and exits 1', async () => {
    for (const argv of [['roles', 'list', '--help'], ['help', 'roles'], ['--version']]) {
      const handoff = { ...GOOD, argv, runDir };
      const r = await runChild(join(HERE, 'index.ts'), [], { servedFd: '3', fd3: JSON.stringify(handoff) });
      expect(r.code, argv.join(' ')).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('Help is not run through the app. Run the command on its own for help.\n');
    }
  });

  it('the entry refuses a run folder it cannot enter, or one that is the root of the disk', async () => {
    const missing = { ...GOOD, runDir: join(base, 'no-such-run') };
    const a = await runChild(join(HERE, 'index.ts'), [], { servedFd: '3', fd3: JSON.stringify(missing) });
    expect([a.code, a.stderr]).toEqual([1, "This request's folder cannot be used.\n"]);
    const root = { ...GOOD, runDir: join(base, 'rootlink') };
    const b = await runChild(join(HERE, 'index.ts'), [], { servedFd: '3', fd3: JSON.stringify(root) });
    expect([b.code, b.stderr]).toEqual([1, "This request's folder is the root of the disk.\n"]);
  });

  it('the entry prints one redacted line and no stack for an error that is not a refusal', async () => {
    // query export passes the guard, then fails: its database setting is not a URL, so it cannot
    // connect to anything whatever defaults the config gains later.
    const handoff = { ...GOOD, path: 'query export', argv: ['query', 'export', '--out', join(runDir, 'q.json')], runDir };
    const r = await runChild(join(HERE, 'index.ts'), [], { servedFd: '3', fd3: JSON.stringify(handoff), env: { INTERNAL_DATABASE_URL: 'not-a-url' } });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.endsWith('\n')).toBe(true);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
});

describe('checking the shape of the hand-off', () => {
  const text = (v: unknown) => JSON.stringify(v);

  it('accepts a good hand-off and keeps only its known fields', () => {
    expect(parseHandoff(text({ ...GOOD, extra: 1, caller: { ...CALLER, roles: ['x'] } }))).toEqual(GOOD);
    expect(parseHandoff(text({ ...GOOD, caller: { ...CALLER, displayName: null, keyName: null } })).caller.keyName).toBeNull();
  });

  it('refuses every wrong shape', () => {
    const bad: unknown[] = [
      null, [], 'x', 1,
      { ...GOOD, path: 1 },
      { ...GOOD, argv: 'roles list' },
      { ...GOOD, argv: ['roles', 1] },
      { ...GOOD, caller: null },
      { ...GOOD, caller: { ...CALLER, id: '' } },
      { ...GOOD, caller: { ...CALLER, username: '' } },
      { ...GOOD, caller: { ...CALLER, username: 7 } },
      { ...GOOD, caller: { ...CALLER, displayName: 3 } },
      { ...GOOD, caller: { ...CALLER, keyName: undefined } },
      { ...GOOD, caller: { ...CALLER, keyName: '' } },
      { ...GOOD, runDir: 'run1' },
      { ...GOOD, runDir: '/' },
      { ...GOOD, runDir: '' },
      { ...GOOD, keptDirs: 'kept' },
      { ...GOOD, keptDirs: ['kept'] },
      { ...GOOD, keptDirs: ['/'] },
      { path: 'roles list', argv: [], caller: CALLER, runDir: '/srv/run1' },
    ];
    for (const b of bad) expect(() => parseHandoff(text(b)), JSON.stringify(b)).toThrow(HandoffError);
    expect(() => parseHandoff('not json')).toThrow(HandoffError);
  });
});

// ---------------------------------------------------------------------------------------------
// The guard, in-process, against the real command tree.
// ---------------------------------------------------------------------------------------------

function parseServed(path: string, argv: string[], kept: string[] = [keptDir], run: string = runDir): Promise<unknown> {
  resetServedHandoffForTests();
  setServedHandoff({ path, argv, caller: CALLER, runDir: run, keptDirs: kept });
  return buildProgram().exitOverride().parseAsync(['node', 'openldr', ...argv]);
}

async function refusal(path: string, argv: string[]): Promise<string> {
  const err = await parseServed(path, argv).then(() => null, (e: unknown) => e);
  expect(err, `${argv.join(' ')} was not refused`).toBeInstanceOf(ServedRefusal);
  return (err as ServedRefusal).message;
}

describe('the served guard', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockClear();
  });
  afterEach(() => resetServedHandoffForTests());

  it('runs the command in the hand-off with its output unchanged', async () => {
    const argv = ['audit', 'list', '--where', 'action:eq:form.create', '--sort', '-occurredAt'];
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', ...argv]);
    expect(mocks.runAuditList).toHaveBeenCalledTimes(1);
    const direct = mocks.runAuditList.mock.calls[0];

    mocks.runAuditList.mockClear();
    await parseServed('audit list', argv);
    expect(mocks.runAuditList).toHaveBeenCalledTimes(1);
    expect(mocks.runAuditList.mock.calls[0]).toEqual(direct);
  });

  it('refuses when the arguments name a different command than the hand-off path', async () => {
    const msg = await refusal('roles list', ['user', 'key', 'create', 'bob', '--name', 'ci']);
    expect(msg).toBe('The command does not match the one the server checked.');
    expect(mocks.runUserKeyCreate).not.toHaveBeenCalled();
    expect(mocks.runRolesList).not.toHaveBeenCalled();
  });

  it('refuses a recovery command and a local command in served mode', async () => {
    expect(await refusal('db migrate', ['db', 'migrate'])).toBe('db migrate does not run through the app.');
    expect(mocks.runDbMigrate).not.toHaveBeenCalled();
    const file = join(runDir, 'bundle.json');
    expect(await refusal('fhir validate', ['fhir', 'validate', file])).toBe('fhir validate does not run through the app.');
    expect(mocks.runFhirValidate).not.toHaveBeenCalled();
  });

  it('refuses a call the table marks as local or as not through the app', async () => {
    const bundle = join(runDir, 'loinc');
    expect(await refusal('artifact publish', ['artifact', 'publish', bundle, '--to', join(runDir, 'out')]))
      .toBe('This form of the command runs on your own machine.');
    expect(mocks.runArtifactPublish).not.toHaveBeenCalled();
    expect(await refusal('sync export', ['sync', 'export'])).toBe('Through the app, sync export needs --out <file>.');
    expect(mocks.runSyncExport).not.toHaveBeenCalled();
    expect(await refusal('report run', ['report', 'run', 'r1', '--format', 'pdf']))
      .toBe('Through the app, report run --format pdf needs --out <file>.');
    expect(mocks.runReportRun).not.toHaveBeenCalled();
  });

  it('refuses --actor and --approved-by in served mode with the message', async () => {
    const actorMsg = '--actor cannot be used through the app. The signed-in account is recorded.';
    expect(await refusal('roles list', ['--actor', 'bob', 'roles', 'list'])).toBe(actorMsg);
    expect(await refusal('roles list', ['roles', 'list', '--actor', 'bob'])).toBe(actorMsg);
    expect(await refusal('roles list', ['roles', 'list', '--actor=bob'])).toBe(actorMsg);
    expect(mocks.runRolesList).not.toHaveBeenCalled();

    const dir = join(runDir, 'loinc');
    expect(await refusal('market install', ['market', 'install', dir, '--approve', '--approved-by', 'bob']))
      .toBe('--approved-by cannot be used through the app. The signed-in account is recorded.');
    expect(mocks.runMarketInstall).not.toHaveBeenCalled();
  });

  it('refuses audit list --actor, because the root --actor takes that value today', async () => {
    // commander parses root options anywhere on the line, so `audit list --actor u1` sets the root
    // --actor (the audit name), not the audit filter. Refusing it is the safe answer.
    expect(await refusal('audit list', ['audit', 'list', '--actor', 'u1']))
      .toBe('--actor cannot be used through the app. The signed-in account is recorded.');
    expect(mocks.runAuditList).not.toHaveBeenCalled();
  });

  it('refuses a marked path outside the request folder', async () => {
    const bad = [
      '/etc/hostname', '../x', 'relative.json', `${runDir}/../y`, `${runDir}/./bundle.json`,
      join(base, 'run10', 'x'), `${runDir}0/x`, join(runDir, 'link', 'hostname'), `${runDir}/bundle.json\0`,
    ];
    for (const p of bad) {
      expect(await refusal('sync import', ['sync', 'import', p])).toBe("file is outside this request's folder.");
    }
    expect(mocks.runSyncImport).not.toHaveBeenCalled();
    // An option mark, and the second mark on a command.
    expect(await refusal('query export', ['query', 'export', '--out', '/etc/x.json'])).toBe("--out is outside this request's folder.");
    expect(mocks.runQueryExport).not.toHaveBeenCalled();
  });

  it('refuses an empty value for an output mark', async () => {
    expect(await refusal('query export', ['query', 'export', '--out', ''])).toBe('--out needs a file or folder name.');
    expect(mocks.runQueryExport).not.toHaveBeenCalled();
  });

  it('refuses an empty value for an input mark the table does not flag', async () => {
    // market install '' would read manifest.json from the working folder.
    expect(await refusal('market install', ['market', 'install', ''])).toBe('dir needs a file or folder name.');
    expect(mocks.runMarketInstall).not.toHaveBeenCalled();
    // An empty input folder that would be built from and recorded.
    expect(await refusal('terminology ontology build', ['terminology', 'ontology', 'build', 'snomed', '']))
      .toBe('dir needs a file or folder name.');
    expect(mocks.runOntologyBuild).not.toHaveBeenCalled();
    expect(await refusal('sync import', ['sync', 'import', ''])).toBe('file needs a file or folder name.');
    expect(mocks.runSyncImport).not.toHaveBeenCalled();
  });

  it('refuses a link whose target does not exist', async () => {
    const dangling = join(runDir, 'dangling');
    expect(await refusal('query export', ['query', 'export', '--out', dangling])).toBe("--out is outside this request's folder.");
    expect(await refusal('query export', ['query', 'export', '--out', join(dangling, 'x.json')])).toBe("--out is outside this request's folder.");
    expect(mocks.runQueryExport).not.toHaveBeenCalled();
  });

  it('refuses a value with a trailing slash', async () => {
    expect(await refusal('sync import', ['sync', 'import', `${runDir}/bundle.json/`])).toBe("file is outside this request's folder.");
    expect(await refusal('terminology import', ['terminology', 'import', 'loinc', `${runDir}/loinc/`]))
      .toBe("path is outside this request's folder.");
    expect(mocks.runSyncImport).not.toHaveBeenCalled();
    expect(mocks.runTerminologyImport).not.toHaveBeenCalled();
  });

  it('checks a marked positional after --', async () => {
    expect(await refusal('sync import', ['sync', 'import', '--', '/etc/hostname'])).toBe("file is outside this request's folder.");
    expect(mocks.runSyncImport).not.toHaveBeenCalled();
    await parseServed('sync import', ['sync', 'import', '--', join(runDir, 'bundle.json')]);
    expect(mocks.runSyncImport).toHaveBeenCalledTimes(1);
    expect(mocks.runSyncImport.mock.calls[0]![0]).toBe(join(runDir, 'bundle.json'));
  });

  it('accepts a link that points inside, and a run folder that is itself a link', async () => {
    await parseServed('terminology import', ['terminology', 'import', 'loinc', join(runDir, 'inner')]);
    await parseServed('query export', ['query', 'export', '--out', join(runDir, 'inner', 'new.json')]);
    expect(mocks.runTerminologyImport).toHaveBeenCalledTimes(1);
    expect(mocks.runQueryExport).toHaveBeenCalledTimes(1);

    const runlink = join(base, 'runlink');
    await parseServed('sync import', ['sync', 'import', join(runlink, 'bundle.json')], [], runlink);
    await parseServed('sync import', ['sync', 'import', join(runDir, 'bundle.json')], [], runlink);
    await parseServed('sync import', ['sync', 'import', join(runDir, 'bundle.json')], [], `${runDir}/`);
    expect(mocks.runSyncImport).toHaveBeenCalledTimes(3);
  });

  it('accepts a marked path inside the request folder and inside a kept folder', async () => {
    await parseServed('sync import', ['sync', 'import', join(runDir, 'bundle.json')]);
    await parseServed('sync import', ['sync', 'import', join(keptDir, 'bundle.json')]);
    expect(mocks.runSyncImport).toHaveBeenCalledTimes(2);

    // A file that does not exist yet, for an output.
    await parseServed('query export', ['query', 'export', '--out', join(runDir, 'new', 'q.json')]);
    expect(mocks.runQueryExport).toHaveBeenCalledTimes(1);

    // The kept folder of `terminology ontology build`, and a mark whose kind is a function.
    await parseServed('terminology ontology build', ['terminology', 'ontology', 'build', 'snomed', join(keptDir, 'dist')]);
    expect(mocks.runOntologyBuild).toHaveBeenCalledTimes(1);
    await parseServed('terminology import', ['terminology', 'import', 'loinc', join(runDir, 'loinc')]);
    expect(mocks.runTerminologyImport).toHaveBeenCalledTimes(1);

    // An empty input value means "no path" and is not checked.
    await parseServed('settings lab set', ['settings', 'lab', 'set', '--logo-file', '']);
    expect(mocks.runSettingsLabSet).toHaveBeenCalledTimes(1);
  });

  it('refuses help before parsing, and turns help off on every command', async () => {
    const msg = 'Help is not run through the app. Run the command on its own for help.';
    for (const argv of [['roles', 'list', '--help'], ['roles', 'list', '-h'], ['help', 'roles'], ['--version'], ['-V']]) {
      expect(() => refuseHelp(buildProgram(), argv), argv.join(' ')).toThrow(msg);
    }
    // Spellings the token check does not see reach no help either.
    for (const argv of [['user', 'help', 'key'], ['roles', 'list', '-hx']]) {
      const program = buildProgram().exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} });
      refuseHelp(program, argv);
      const err = await program.parseAsync(['node', 'openldr', ...argv]).then(() => null, (e: { code?: string }) => e);
      expect(err?.code, argv.join(' ')).not.toBe('commander.helpDisplayed');
      expect(err).not.toBeNull();
    }
  });

  it('sets the hand-off once', () => {
    setServedHandoff({ path: 'roles list', argv: [], caller: CALLER, runDir, keptDirs: [] });
    expect(() => setServedHandoff({ path: 'db migrate', argv: [], caller: CALLER, runDir, keptDirs: [] }))
      .toThrow('The served hand-off is already set.');
  });

  it('moves into the real run folder, and refuses one it cannot use', () => {
    const before = process.cwd();
    try {
      enterRunDir({ ...GOOD, runDir: join(base, 'runlink') });
      expect(process.cwd()).toBe(runDir);
    } finally {
      process.chdir(before);
    }
    expect(() => enterRunDir({ ...GOOD, runDir: join(base, 'no-such-run') })).toThrow("This request's folder cannot be used.");
    expect(() => enterRunDir({ ...GOOD, runDir: join(base, 'rootlink') })).toThrow("This request's folder is the root of the disk.");
    expect(process.cwd()).toBe(before);
  });

  it('sets OPENLDR_SKIP_ENV_FILE itself, so no .env near the uploads is read', () => {
    const before = process.cwd();
    const saved = process.env.OPENLDR_SKIP_ENV_FILE;
    delete process.env.OPENLDR_SKIP_ENV_FILE;
    try {
      enterRunDir({ ...GOOD, runDir });
      expect(process.env.OPENLDR_SKIP_ENV_FILE).toBe('true');
    } finally {
      process.chdir(before);
      if (saved === undefined) delete process.env.OPENLDR_SKIP_ENV_FILE;
      else process.env.OPENLDR_SKIP_ENV_FILE = saved;
    }
  });

  it('refuses a kept-folder path when the hand-off names no kept folder', async () => {
    const err = await parseServed('sync import', ['sync', 'import', join(keptDir, 'bundle.json')], []).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ServedRefusal);
    expect(mocks.runSyncImport).not.toHaveBeenCalled();
  });

  it('does nothing when there is no hand-off', async () => {
    resetServedHandoffForTests();
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', '--actor', 'bob', 'db', 'migrate']);
    expect(mocks.runDbMigrate).toHaveBeenCalledTimes(1);
  });
});
