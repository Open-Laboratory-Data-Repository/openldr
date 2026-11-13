import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { Command } from 'commander';

// Every context builder and the config loader throw here. A local command that reaches one fails,
// and the spy records the call. The real modules stay in place for everything else.
const builders = vi.hoisted(() => {
  const thrower = (name: string) => () => { throw new Error(`${name} called by a local command`); };
  return {
    createAppContext: vi.fn(thrower('createAppContext')),
    createDbContext: vi.fn(thrower('createDbContext')),
    createIngestContext: vi.fn(thrower('createIngestContext')),
    createTerminologyContext: vi.fn(thrower('createTerminologyContext')),
    loadConfig: vi.fn(thrower('loadConfig')),
    createInternalDb: vi.fn(thrower('createInternalDb')),
  };
});
vi.mock('@openldr/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openldr/bootstrap')>()),
  createAppContext: builders.createAppContext,
  createDbContext: builders.createDbContext,
  createIngestContext: builders.createIngestContext,
  createTerminologyContext: builders.createTerminologyContext,
}));
vi.mock('@openldr/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openldr/config')>()),
  loadConfig: builders.loadConfig,
}));
vi.mock('@openldr/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openldr/db')>()),
  createInternalDb: builders.createInternalDb,
}));

import { buildProgram } from './program';
import { COMMAND_META, type CommandKind, type PathKind } from './command-meta';
import { commandPath, leafCommands } from './command-list';

const SRC = dirname(fileURLToPath(import.meta.url));

const TEN_PATHS = [
  'db migrate', 'db reset', 'db seed', 'doctor', 'health', 'target-store test', 'storage copy',
  'auth setup-code', 'auth rebind-issuer', 'user reset-password',
];

// Read from each command's code (see the Task 6 report). A change here is a change to what may
// run with no sign-in, so it must be a deliberate edit to both lists.
const LOCAL_PATHS = [
  'artifact build', 'artifact keygen', 'artifact new', 'artifact pack', 'artifact sign', 'artifact test',
  'commands', 'errors list', 'facilities suggest-map', 'fhir validate', 'forms extract', 'market verify',
];

function byKind(kind: CommandKind): string[] {
  return Object.entries(COMMAND_META).filter(([, m]) => m.kind === kind).map(([p]) => p).sort();
}

interface Arg { name(): string }
interface Opt { long?: string; flags: string }
const argsOf = (c: Command) => (c as unknown as { registeredArguments: readonly Arg[] }).registeredArguments;
const optsOf = (c: Command) => c.options as unknown as readonly Opt[];

describe('COMMAND_META', () => {
  it('has an entry for every command in the program and no entry for a command that does not exist', () => {
    const paths = leafCommands(buildProgram()).map(commandPath).sort();
    expect(Object.keys(COMMAND_META).sort()).toEqual(paths);
  });

  it('marks exactly the ten recovery commands', () => {
    expect(byKind('recovery')).toEqual([...TEN_PATHS].sort());
  });

  it('marks exactly the commands read as local', () => {
    expect(byKind('local')).toEqual([...LOCAL_PATHS].sort());
  });

  it('marks every option and argument whose name or placeholder names a file, path, dir or folder', () => {
    // Names that look like a path but are not one on disk, each with its reason.
    const NOT_PATHS: Record<string, string> = {
      'layouts set --pages': 'Studio page routes such as /forms, not files',
      'layouts set --start-page': 'a Studio page route, not a file',
      'artifact new --sdk-path': 'text written into the scaffolded Cargo.toml; this command never reads it',
    };
    const looksLikePath = (s: string) => /file|path|dir|folder/i.test(s);
    const missing: string[] = [];
    for (const cmd of leafCommands(buildProgram())) {
      const path = commandPath(cmd);
      const marked = new Set((COMMAND_META[path]?.paths ?? []).map((p) => p.target));
      for (const a of argsOf(cmd)) {
        if (looksLikePath(a.name()) && !marked.has(a.name()) && !NOT_PATHS[`${path} ${a.name()}`]) missing.push(`${path} <${a.name()}>`);
      }
      for (const o of optsOf(cmd)) {
        const placeholder = /<([^>]+)>/.exec(o.flags)?.[1] ?? '';
        const named = o.long === '--out' || o.long === '--file' || /-(file|dir|path)$/.test(o.long ?? '');
        if ((named || looksLikePath(placeholder)) && !marked.has(o.long ?? '') && !NOT_PATHS[`${path} ${o.long}`]) missing.push(`${path} ${o.flags}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('names only real options and arguments in paths, with a known kind', () => {
    const KINDS: PathKind[] = ['input-file', 'input-dir', 'output-file', 'output-dir'];
    const bad: string[] = [];
    for (const cmd of leafCommands(buildProgram())) {
      const path = commandPath(cmd);
      const names = new Set([...argsOf(cmd).map((a) => a.name()), ...optsOf(cmd).map((o) => o.long ?? '')]);
      for (const mark of COMMAND_META[path]?.paths ?? []) {
        if (!names.has(mark.target)) bad.push(`${path}: no ${mark.target}`);
        if (typeof mark.kind === 'string' && !KINDS.includes(mark.kind)) bad.push(`${path}: kind ${mark.kind}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('decides terminology import <path> from the kind argument', () => {
    const mark = COMMAND_META['terminology import']?.paths?.find((p) => p.target === 'path');
    expect(typeof mark?.kind).toBe('function');
    const kindFor = (k: string) => (mark!.kind as (a: string[], o: Record<string, unknown>) => PathKind)([k, 'x'], {});
    expect(kindFor('loinc')).toBe('input-dir');
    for (const k of ['amr', 'organisms', 'parameters', 'resource']) expect(kindFor(k)).toBe('input-file');
  });

  it('keeps the folder ontology build records for rebuild', () => {
    expect(COMMAND_META['terminology ontology build']?.paths).toEqual([{ target: 'dir', kind: 'input-dir', keep: true }]);
  });

  it('marks destructive every command that has a --force option, and no other', () => {
    const withForce = leafCommands(buildProgram())
      .filter((c) => optsOf(c).some((o) => o.long === '--force')).map(commandPath).sort();
    const destructive = Object.entries(COMMAND_META).filter(([, m]) => m.destructive).map(([p]) => p).sort();
    expect(destructive).toEqual(withForce);
  });

  it('leaves capability unset, for Task 7 to fill', () => {
    expect(Object.values(COMMAND_META).filter((m) => m.capability !== undefined)).toEqual([]);
  });

  it('command-meta imports nothing from bootstrap, config or a command file', () => {
    const source = readFileSync(join(SRC, 'command-meta.ts'), 'utf8');
    const lines = source.split('\n').filter((l) => /^\s*(import\b|export\b[^=]*\bfrom\b)|\brequire\(|\bimport\(/.test(l));
    expect(lines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// A local command's code reaches no context builder. Two checks, because each misses something.
//
// 1. Static: from each local command's `.action(...)` in program.ts, follow every name to the
//    function it refers to, in this package, across files. Any reference to a builder or the config
//    loader fails, on any branch, whatever the options. A name imported from @openldr/bootstrap or
//    @openldr/db fails unless it is on a short list of functions read to be pure. It cannot see inside
//    other packages beyond that list, or calls made through an object (`ctx.x()`), or a dynamic import.
// 2. Run time: run each local command for real, in a temporary folder, with every builder and the
//    config loader mocked to throw. It sees calls in other packages too, but only on the branch the
//    inputs reach.
// ---------------------------------------------------------------------------------------------

const FORBIDDEN = new Set(['createAppContext', 'createDbContext', 'createIngestContext', 'createTerminologyContext', 'loadConfig', 'createInternalDb']);
// Read to be pure: packages/bootstrap/src/facility-xlsx.ts imports only csv-parse and xlsx, and
// packages/bootstrap/src/facility-mapping-suggest.ts only @openldr/terminology's field list.
const PURE_IMPORTS = new Set([
  '@openldr/bootstrap:facilityXlsxToCsv', '@openldr/bootstrap:FacilityXlsxError',
  '@openldr/bootstrap:suggestColumns', '@openldr/bootstrap:ColumnSuggestion',
]);

interface Mod { sf: ts.SourceFile; fns: Map<string, ts.Node>; imports: Map<string, { from: string; name: string }> }
const mods = new Map<string, Mod>();
function mod(file: string): Mod {
  const cached = mods.get(file);
  if (cached) return cached;
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const fns = new Map<string, ts.Node>();
  const imports = new Map<string, { from: string; name: string }>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) fns.set(st.name.text, st);
    if (ts.isClassDeclaration(st) && st.name) fns.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) fns.set(d.name.text, d.initializer);
    }
    if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      const from = (st.moduleSpecifier as ts.StringLiteral).text;
      for (const el of st.importClause.namedBindings.elements) imports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
    }
  }
  const m = { sf, fns, imports };
  mods.set(file, m);
  return m;
}
function localFile(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate;
  return null;
}
function reach(file: string, node: ts.Node, seen: Set<string>, found: Set<string>): void {
  const m = mod(file);
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const spec = n.arguments[0];
      if (!(spec && ts.isStringLiteral(spec) && spec.text.startsWith('node:'))) found.add(`dynamic import ${n.arguments[0]?.getText()}`);
    }
    if (ts.isIdentifier(n)) {
      const name = n.text;
      if (FORBIDDEN.has(name)) found.add(name);
      const key = `${file}#${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        const local = m.fns.get(name);
        if (local && local !== node) reach(file, local, seen, found);
        const imp = m.imports.get(name);
        if (imp) {
          const target = localFile(file, imp.from);
          if (target) {
            const fn = mod(target).fns.get(imp.name);
            if (fn) reach(target, fn, seen, found);
          } else if (/^@openldr\/(bootstrap|db)/.test(imp.from) && !PURE_IMPORTS.has(`${imp.from}:${imp.name}`)) {
            found.add(`${imp.from}:${imp.name}`);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
}
/** Each `.action(...)` callback in program.ts, keyed by the command path its chain builds. */
function actionsInProgram(): Map<string, ts.Node> {
  const file = join(SRC, 'program.ts');
  const m = mod(file);
  const varPath = new Map<string, string[]>([['program', []]]);
  const out = new Map<string, ts.Node>();
  const chain = (e: ts.Expression): string[] | null => {
    if (ts.isIdentifier(e)) return varPath.get(e.text) ?? null;
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const base = chain(e.expression.expression);
      if (!base) return null;
      if (e.expression.name.text !== 'command') return base;
      const a = e.arguments[0];
      return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? [...base, a.text.split(' ')[0]] : null;
    }
    return null;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const p = chain(n.initializer);
      if (p) varPath.set(n.name.text, p);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'action') {
      const p = chain(n.expression.expression);
      if (p) out.set(p.join(' '), n.arguments[0]);
    }
    ts.forEachChild(n, visit);
  };
  visit(m.sf);
  return out;
}

describe('local commands', () => {
  it("a local command's code reaches no context builder, on any branch (static)", () => {
    const actions = actionsInProgram();
    const file = join(SRC, 'program.ts');
    const report: Record<string, string[]> = {};
    for (const path of byKind('local')) {
      const cb = actions.get(path);
      if (!cb) { report[path] = ['no .action found in program.ts']; continue; }
      const found = new Set<string>();
      reach(file, cb, new Set(), found);
      if (found.size > 0) report[path] = [...found].sort();
    }
    expect(report).toEqual({});
  });

  it('the static check finds a builder when one is reached', () => {
    // The check must be able to fail: artifact publish reaches createIngestContext through runArtifactPublish.
    const found = new Set<string>();
    reach(join(SRC, 'program.ts'), actionsInProgram().get('artifact publish')!, new Set(), found);
    expect([...found]).toContain('createIngestContext');
    expect([...found]).toContain('loadConfig');
  });

  describe('at run time, with every builder mocked to throw', () => {
    let dir: string;
    const ran = new Set<string>();
    const fixture = (name: string) => join(SRC, '__fixtures__', name);

    beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'command-meta-')); });
    afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
    beforeEach(() => { process.exitCode = undefined; });

    async function run(argv: string[]): Promise<{ code: number; stdout: string }> {
      let stdout = '';
      const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { stdout += String(chunk); return true; });
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        const program = buildProgram().exitOverride();
        await program.parseAsync(['node', 'openldr', ...argv]);
        const leaf = argv.filter((a) => !a.startsWith('-'));
        for (const path of byKind('local')) if (leaf.join(' ').startsWith(path)) ran.add(path);
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
      const code = Number(process.exitCode ?? 0);
      process.exitCode = undefined;
      return { code, stdout };
    }

    it('runs every local command without calling a builder or the config loader', async () => {
      expect((await run(['errors', 'list', '--json'])).code).toBe(0);
      expect((await run(['commands', '--json'])).code).toBe(0);
      expect((await run(['fhir', 'validate', fixture('valid-patient.json')])).code).toBe(0);
      expect((await run(['forms', 'extract', fixture('sample-questionnaire.json'), fixture('sample-response.json')])).code).toBe(0);
      const csv = join(dir, 'register.csv');
      await writeFile(csv, 'code,name,latitude\nA1,Clinic,1.5\n');
      expect((await run(['facilities', 'suggest-map', csv, '--json'])).code).toBe(0);

      const keys = join(dir, 'keys');
      expect((await run(['artifact', 'keygen', '--out', keys, '--json'])).code).toBe(0);
      expect((await run(['artifact', 'new', 'form', 'intake', '--out', dir, '--json'])).code).toBe(0);
      const proj = join(dir, 'intake');
      expect((await run(['artifact', 'build', proj, '--json'])).code).toBe(0);
      const bundle = join(dir, 'bundle');
      expect((await run(['artifact', 'pack', proj, '--key', join(keys, 'publisher.priv'), '--out', bundle, '--json'])).code).toBe(0);
      expect((await run(['market', 'verify', bundle, '--json'])).code).toBe(0);
      expect((await run(['artifact', 'sign', proj, '--key', join(keys, 'publisher.priv'), '--json'])).code).toBe(0);
      // A form artifact is refused before any plugin runs, so this exits 1. It still must not build a context.
      expect((await run(['artifact', 'test', proj, '--sample', fixture('valid-patient.json'), '--json'])).code).toBe(1);

      for (const [name, fn] of Object.entries(builders)) expect(fn, name).not.toHaveBeenCalled();
      expect([...ran].sort()).toEqual(byKind('local'));
    });

    it('a builder call is seen: an app command run the same way calls the mocked loader', async () => {
      // Shows the mocks are wired: `roles list` is an app command and reaches loadConfig first.
      expect((await run(['roles', 'list', '--json'])).code).toBe(1);
      expect(builders.loadConfig).toHaveBeenCalled();
      builders.loadConfig.mockClear();
    });
  });
});
