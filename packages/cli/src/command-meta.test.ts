import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { Command } from 'commander';
import { CAPABILITY_KEYS, SYSTEM_ROLES } from '@openldr/rbac';

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
import { COMMAND_META, uiEntryOf, type CommandKind, type CompanionContext, type PathKind } from './command-meta';
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
interface Opt { long?: string; flags: string; required?: boolean; optional?: boolean }
const argsOf = (c: Command) => (c as unknown as { registeredArguments: readonly Arg[] }).registeredArguments;
const optsOf = (c: Command) => c.options as unknown as readonly Opt[];
const leaves = () => leafCommands(buildProgram()).map((cmd) => ({ cmd, path: commandPath(cmd) }));

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

  it('names only real options and arguments in paths, with a known kind', () => {
    const KINDS: PathKind[] = ['input-file', 'input-dir', 'output-file', 'output-dir'];
    const bad: string[] = [];
    for (const { cmd, path } of leaves()) {
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

  it('gives every app command a capability that is in the catalog', () => {
    const known = new Set(CAPABILITY_KEYS);
    const bad = Object.entries(COMMAND_META)
      .filter(([, m]) => m.kind === 'app' && (m.capability === undefined || !known.has(m.capability)))
      .map(([p, m]) => `${p}: ${m.capability ?? 'none'}`);
    expect(bad).toEqual([]);
  });

  it('gives no capability to a recovery or local command', () => {
    const bad = Object.entries(COMMAND_META).filter(([, m]) => m.kind !== 'app' && m.capability !== undefined).map(([p]) => p);
    expect(bad).toEqual([]);
  });

  // Ruling 51: keys the account must hold besides capability.
  it('names only catalog keys in alsoRequires, none repeated and none equal to the capability', () => {
    const known = new Set(CAPABILITY_KEYS);
    const bad: string[] = [];
    for (const [p, m] of Object.entries(COMMAND_META)) {
      const also = m.alsoRequires ?? [];
      if (m.alsoRequires && also.length === 0) bad.push(`${p}: empty alsoRequires`);
      for (const k of also) if (!known.has(k)) bad.push(`${p}: ${k} not in the catalog`);
      if (new Set(also).size !== also.length) bad.push(`${p}: a key repeated`);
      if (m.capability && also.includes(m.capability)) bad.push(`${p}: repeats its capability`);
    }
    expect(bad).toEqual([]);
  });

  it('gives alsoRequires to no recovery or local command', () => {
    expect(Object.entries(COMMAND_META).filter(([, m]) => m.kind !== 'app' && m.alsoRequires !== undefined).map(([p]) => p)).toEqual([]);
  });

  it('facilities add-type needs both keys its route needs (facilities-routes.ts:2078)', () => {
    const m = COMMAND_META['facilities add-type']!;
    expect([m.capability, ...(m.alsoRequires ?? [])].sort()).toEqual(['facilities.manage', 'terminology.manage']);
  });

  it('lists exactly the commands that need a second key', () => {
    const withSecond = Object.entries(COMMAND_META).filter(([, m]) => m.alsoRequires).map(([p, m]) => `${p}: ${m.capability} + ${m.alsoRequires!.join(', ')}`);
    expect(withSecond.sort()).toEqual([
      'facilities add-type: terminology.manage + facilities.manage',
      'facilities jobs: facilities.manage + facilities.view',
      'import resume: connectors.manage + ingest.run',
      'import start: connectors.manage + ingest.run',
      'patients duplicates list: patients.view_identifiers + patients.view',
      'patients list: patients.view_identifiers + patients.view',
      'patients show: patients.view_identifiers + patients.view',
      'report run: reports.export + reports.run',
      'test-catalog map match: terminology.manage + terminology.view',
      'test-catalog params: terminology.manage + terminology.view',
    ]);
  });

  it('keeps alsoRequires frozen', () => {
    const also = COMMAND_META['facilities add-type']!.alsoRequires as string[];
    expect(Array.isArray(also)).toBe(true);
    expect(() => { also.push('x'); }).toThrow(TypeError);
  });

  it('command-meta imports nothing from bootstrap, config or a command file', () => {
    const source = readFileSync(join(SRC, 'command-meta.ts'), 'utf8');
    const lines = source.split('\n').filter((l) => /^\s*(import\b|export\b[^=]*\bfrom\b)|\brequire\(|\bimport\(/.test(l));
    expect(lines).toEqual([]);
  });

  it('lets an empty path through only on settings lab set --logo-file', () => {
    const flagged = Object.entries(COMMAND_META).flatMap(([path, meta]) =>
      (meta.paths ?? []).filter((m) => m.allowEmpty).map((m) => `${path} ${m.target}`));
    expect(flagged).toEqual(['settings lab set --logo-file']);
  });

  it('cannot be changed by a caller', () => {
    const table = COMMAND_META as Record<string, unknown>;
    expect(() => { table['new command'] = { kind: 'recovery' }; }).toThrow(TypeError);
    expect(() => { (COMMAND_META['roles list'] as { kind: string }).kind = 'local'; }).toThrow(TypeError);
    expect(() => { (COMMAND_META['ingest']!.paths as unknown[]).push({ target: 'x', kind: 'input-file' }); }).toThrow(TypeError);
    expect(() => { (COMMAND_META['ingest']!.paths![0] as { kind: string }).kind = 'output-dir'; }).toThrow(TypeError);
    expect(COMMAND_META['roles list']?.kind).toBe('app');
  });

  it('finds nothing for a lookup by a name every object has', () => {
    expect(Object.getPrototypeOf(COMMAND_META)).toBeNull();
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(COMMAND_META[name], name).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Paths. Every value an app command takes is either marked in `paths`, or listed here as not a
// path, with a reason. A new option or argument with neither fails, so a future `--cert <pem>`
// cannot read a file on the server's disk unnoticed.
// ---------------------------------------------------------------------------------------------

const ID = 'an id, code, slug or name, looked up in the database';
const URI = 'a canonical URI or URL used as a key or sent over the network, never opened as a file';
const NUM = 'a number';
const FILTER = 'a filter or sort term, matched in the database';
const TEXT = 'free text, stored or shown as is';
const CHOICE = 'one of a fixed set of words';
const SETTING = 'a setting name or value, stored as text';
const WHEN = 'a date, time, year or sync cursor';
const PERSON = 'a name written into a record as is; refusing it through the app is a later task';
const REASON: Record<string, string> = {
  // positional arguments
  action: CHOICE, batchId: ID, capability: ID, code: ID, columns: 'column names in the warehouse', connector: ID,
  conceptMapUrl: URI, display: TEXT, entityId: ID, entityType: CHOICE, field: SETTING, id: ID, idA: ID, idB: ID,
  key: SETTING, keyId: ID, kind: CHOICE, level: CHOICE, loinc: ID, name: ID, plugin: ID, requestId: ID,
  resourceId: ID, resourceType: CHOICE, roles: ID, run: ID, site: CHOICE, siteId: ID, slug: ID, state: CHOICE,
  subject: ID, system: URI, systemId: ID, systemUrl: URI, table: 'a warehouse table name', 'target-code': ID,
  username: ID, value: SETTING, valueSetUrl: URI, version: 'a version number', workflowId: ID,
  // options
  '--action': FILTER, '--activity': CHOICE, '--actor': 'audit list: a filter on the actor id, not the root --actor',
  '--address': TEXT, '--agent': PERSON, '--approved-by': PERSON, '--caps': 'capability keys', '--category': FILTER,
  '--central-url': URI, '--code': ID, '--connector': ID, '--contact': TEXT, '--converter': ID, '--count': NUM,
  '--country': 'an ISO3 country code', '--desc': TEXT, '--duplicate': ID, '--email': TEXT, '--enabled': CHOICE,
  '--entity': FILTER, '--entity-id': FILTER, '--entity-type': FILTER, '--expires': WHEN, '--format': CHOICE,
  '--from': WHEN, '--icon': 'an icon name', '--id': ID, '--jurisdiction': TEXT, '--kind': CHOICE, '--label': TEXT,
  '--lang': CHOICE, '--level': CHOICE, '--limit': NUM, '--list-column': CHOICE, '--loinc': CHOICE, '--name': TEXT,
  '--national-system': URI, '--offset': NUM, '--on-absent': CHOICE, '--on-conflict': CHOICE, '--on-deleted': CHOICE,
  '--option': 'name=value plugin options, passed to the plugin as text', '--page-size': NUM,
  '--pages': 'Studio page routes such as /forms, not files',
  '--param': 'key=value report parameters, passed as text', '--patch': 'inline JSON text, parsed in memory',
  '--plugin': ID, '--publisher': ID, '--q': FILTER, '--reason': TEXT, '--register': URI,
  '--release-version': 'a version label, stored as text', '--resource-type': CHOICE, '--retry': ID,
  '--role': 'a role slug, or one of a fixed set of words', '--roles': ID, '--search': FILTER, '--searchable': CHOICE,
  '--site': ID, '--slug': ID, '--sort': FILTER, '--source': 'a source system id, stored as text',
  '--start-page': 'a Studio page route, not a file', '--status': CHOICE, '--survivor': ID, '--system': URI,
  '--timezone': 'an IANA time zone name', '--to': WHEN, '--url': URI, '--username': ID, '--valueset': URI,
  '--version': 'a version number', '--where': FILTER, '--year': WHEN,
};
// Per command, so a new option is reviewed for that command and not let through by its name alone.
const NOT_A_PATH: Record<string, string[]> = {
  'workflows receipts list': ['workflowId', '--limit', '--offset'],
  'workflows receipts show': ['requestId'],
  'connectors inspect': ['id'],
  'connectors update': ['id'],
  'connectors diagnose': ['id'],
  'connectors test': ['id'],
  'connectors remove': ['id'],
  'import allow': ['plugin', 'connector'],
  'import revoke': ['plugin', 'connector'],
  'import allowed': ['plugin'],
  'import start': ['--plugin', '--connector', '--option', '--limit', '--page-size'],
  'import resume': ['plugin', 'run'],
  'import status': ['plugin', 'run'],
  'import stop': ['plugin', 'run'],
  'import failures': ['plugin', 'run'],
  'settings flags set': ['key', 'value'],
  'settings numbers set': ['key', 'value'],
  'settings lab set': ['--name', '--address', '--contact', '--timezone'],
  'settings sync set': ['field', 'value'],
  'settings validation set': ['level'],
  'settings danger': ['action'],
  'roles show': ['slug'],
  'roles create': ['name', '--slug', '--desc', '--caps'],
  'roles edit': ['slug', '--name', '--desc', '--caps'],
  'roles delete': ['slug'],
  'roles grant': ['slug', 'capability'],
  'roles revoke': ['slug', 'capability'],
  'data-exposure hide': ['table', 'columns'],
  'data-exposure show': ['table', 'columns'],
  'test-catalog list': ['--search', '--category', '--loinc', '--enabled', '--status', '--limit', '--offset'],
  'test-catalog enable': ['code'],
  'test-catalog disable': ['code'],
  'test-catalog retire': ['code'],
  'test-catalog restore': ['code'],
  'test-catalog params': ['code'],
  'test-catalog map list': ['--status', '--search', '--limit', '--offset', '--level'],
  'test-catalog map set': ['system', 'code', 'target-code', '--level'],
  'test-catalog map clear': ['system', 'code', '--level'],
  'test-catalog map export': ['--level'],
  'test-catalog map import': ['--level'],
  'test-catalog map match': ['system'],
  'test-catalog result-fields list': ['--search', '--loinc', '--role', '--limit', '--offset'],
  'test-catalog result-fields link': ['code', 'loinc'],
  'test-catalog result-fields unlink': ['code'],
  'patients list': ['--search', '--status', '--limit', '--offset'],
  'patients show': ['id'],
  'patients identifier-systems set': ['system', '--label', '--list-column', '--searchable'],
  'patients duplicates list': ['--status', '--limit', '--offset'],
  'patients duplicates dismiss': ['idA', 'idB', '--reason'],
  'patients duplicates restore': ['idA', 'idB'],
  'facilities list': ['--where', '--sort', '--limit'],
  'facilities import': ['--national-system', '--format', '--release-version', '--on-deleted', '--on-absent', '--on-conflict'],
  'facilities suggest-values': ['--national-system'],
  'facilities add-type': ['display', '--national-system'],
  'facilities register-source': ['--url', '--name', '--code', '--version', '--jurisdiction', '--contact'],
  'facilities import-runs': ['--national-system', '--limit'],
  'facilities import-run': ['id'],
  'facilities import-run-cancel': ['id'],
  'facilities import-run-revalidate': ['id'],
  'facilities link-matching': ['--register'],
  'facilities delete': ['--where'],
  'facilities jobs': ['--retry'],
  'query export': ['--name'],
  'query import': ['--connector'],
  'sync enroll': ['siteId', '--name', '--central-url'],
  'sync rotate': ['siteId'],
  'sync revoke': ['siteId'],
  'sync amend': ['--resource-type', '--id', '--status', '--reason', '--patch', '--agent', '--activity'],
  'sync merge-patient': ['--survivor', '--duplicate', '--reason', '--agent'],
  'sync export': ['--kind', '--site', '--from'],
  'sync quarantine retry': ['entityType', 'entityId'],
  'sync divergence show': ['resourceType', 'resourceId', 'version'],
  'sync divergence clear': ['resourceType', 'resourceId', 'version'],
  'terminology import': ['kind'],
  'terminology lookup': ['system', 'code'],
  'terminology validate-code': ['--code', '--system', '--valueset'],
  'terminology expand': ['valueSetUrl', '--count', '--offset'],
  'terminology translate': ['conceptMapUrl', '--system', '--code'],
  'terminology publisher create': ['name', '--role', '--icon'],
  'terminology system list': ['--publisher'],
  'terminology system create': ['code', 'name', '--url', '--version', '--publisher'],
  'terminology term list': ['systemUrl', '--q'],
  'terminology valueset list': ['--publisher'],
  'terminology distribution import': ['system', '--version'],
  'terminology distribution purge': ['system'],
  'terminology ontology build': ['systemId'],
  'terminology ontology rebuild': ['systemId'],
  'terminology ontology unlink': ['systemId'],
  'forms lint': ['id'],
  'forms versions': ['id'],
  'forms restore': ['id', 'version'],
  'report-design delete': ['id'],
  'report-design publish': ['id'],
  'report-design versions': ['id'],
  'report-def delete': ['id'],
  'ingest': ['--source', '--converter', '--plugin'],
  'pipeline retry': ['batchId'],
  'pipeline logs': ['batchId'],
  'plugin test': ['id', '--version'],
  'plugin run': ['--plugin', '--version'],
  'plugin remove': ['id', '--version'],
  'report run': ['id', '--param', '--format', '--lang'],
  'report glass-export': ['--country', '--year', '--from', '--to'],
  'audit list': ['--actor', '--entity', '--entity-type', '--entity-id', '--action', '--from', '--to', '--where', '--sort'],
  'user directory-list': ['--offset', '--limit', '--search', '--enabled'],
  'user show': ['id'],
  'user create': ['--username', '--name', '--email', '--role'],
  'user key list': ['username'],
  'user key create': ['username', '--name', '--expires'],
  'user key revoke': ['username', 'keyId'],
  'user end-sessions': ['username'],
  'user set-role': ['id', 'roles'],
  'user activate': ['id'],
  'user preferences show': ['id'],
  'user preferences set': ['id', 'key', 'value'],
  'user deactivate': ['id'],
  'user assign-role': ['subject', 'slug'],
  'user unassign-role': ['subject', 'slug'],
  'layouts set': ['name', '--pages', '--start-page', '--roles'],
  'layouts delete': ['name'],
  'market install': ['--approved-by'],
  'market update': ['--approved-by'],
  'market rollback': ['id', 'version'],
  'market enable': ['id'],
  'market disable': ['id'],
  'market sites': ['id', 'site', 'state'],
  'market remove': ['id', 'version'],
  'artifact publish': ['--approved-by'],
};

describe('paths on app commands', () => {
  it('marks or lists, with a reason, every value an app command takes', () => {
    const unreviewed: string[] = [];
    for (const { cmd, path } of leaves()) {
      if (COMMAND_META[path]?.kind !== 'app') continue;
      const marked = new Set((COMMAND_META[path]?.paths ?? []).map((p) => p.target));
      const listed = new Set(NOT_A_PATH[path] ?? []);
      const values = [
        ...argsOf(cmd).map((a) => a.name()),
        ...optsOf(cmd).filter((o) => o.required || o.optional).map((o) => o.long ?? o.flags),
      ];
      for (const v of values) if (!marked.has(v) && !listed.has(v)) unreviewed.push(`${path} ${v}`);
    }
    expect(unreviewed).toEqual([]);
  });

  it('keeps the not-a-path list honest: real targets, each with a reason, none also marked', () => {
    const bad: string[] = [];
    const byPath = new Map(leaves().map((l) => [l.path, l.cmd]));
    for (const [path, targets] of Object.entries(NOT_A_PATH)) {
      const cmd = byPath.get(path);
      if (!cmd) { bad.push(`${path}: no such command`); continue; }
      if (COMMAND_META[path]?.kind !== 'app') bad.push(`${path}: not an app command`);
      const names = new Set([...argsOf(cmd).map((a) => a.name()), ...optsOf(cmd).map((o) => o.long ?? '')]);
      const marked = new Set((COMMAND_META[path]?.paths ?? []).map((p) => p.target));
      for (const t of targets) {
        if (!names.has(t)) bad.push(`${path}: no ${t}`);
        if (marked.has(t)) bad.push(`${path}: ${t} is marked and listed`);
        if (!REASON[t]) bad.push(`${path}: ${t} has no reason`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Destructive.
// ---------------------------------------------------------------------------------------------

const DESTRUCTIVE_WORDS = new Set([
  'delete', 'remove', 'purge', 'unlink', 'revoke', 'reset', 'clear', 'deactivate', 'end-sessions',
  'factory-reset', 'rollback', 'dismiss',
]);
// A command whose last word is one of those but that destroys nothing, with the reason. Empty today.
const NOT_DESTRUCTIVE: Record<string, string> = {};
// Last words of commands that only read.
const READ_WORDS = new Set([
  'list', 'show', 'status', 'inspect', 'diagnose', 'logs', 'versions', 'lookup', 'expand', 'translate',
  'validate-code', 'validate', 'verify', 'conflicts', 'import-runs', 'import-run', 'import-sources', 'allowed',
  'failures', 'check', 'doctor', 'health', 'directory-list', 'suggest-map', 'suggest-values', 'extract', 'lint',
  'audit', 'export',
]);
const lastWord = (path: string) => path.split(' ').at(-1)!;

// Ruling 50: destructive is about data stored in OpenLDR and about access, not about files on the
// caller's own disk. A local command whose --force only writes over the caller's own files is not
// destructive.
const LOCAL_FORCE_ONLY: Record<string, string> = {
  'artifact keygen': '--force writes over a key file in --out on the caller\'s own disk; nothing stored in OpenLDR changes',
};

// Destructive by what the code does, with no --force and no destructive word in the name.
const DESTRUCTIVE_BY_READING: Record<string, string> = {
  'sync import': 'a pull bundle reconciles whole terminology systems, and a delete record empties one (packages/bootstrap/src/sync-bundle.ts:280, :317)',
};

describe('destructive', () => {
  it('marks destructive every command that has a --force option', () => {
    const missing = leaves().filter(({ cmd, path }) => optsOf(cmd).some((o) => o.long === '--force') && !COMMAND_META[path]?.destructive && !LOCAL_FORCE_ONLY[path]);
    expect(missing.map((l) => l.path)).toEqual([]);
  });

  it('lets off only local commands whose --force touches the caller\'s own files', () => {
    for (const path of Object.keys(LOCAL_FORCE_ONLY)) {
      expect(COMMAND_META[path]?.kind, path).toBe('local');
      expect(COMMAND_META[path]?.destructive, path).toBeUndefined();
    }
  });

  it('marks destructive the commands read as destructive although no option or word says so', () => {
    for (const path of Object.keys(DESTRUCTIVE_BY_READING)) expect(COMMAND_META[path]?.destructive, path).toBe(true);
  });

  it('marks no local command destructive: a local command writes only the caller\'s own files', () => {
    expect(byKind('local').filter((p) => COMMAND_META[p]?.destructive)).toEqual([]);
  });

  it('marks destructive every command named for removing, revoking or resetting', () => {
    const missing = Object.entries(COMMAND_META)
      .filter(([path, m]) => DESTRUCTIVE_WORDS.has(lastWord(path)) && !m.destructive && !NOT_DESTRUCTIVE[path])
      .map(([path]) => path);
    expect(missing).toEqual([]);
  });

  it('marks no read command destructive', () => {
    const wrong = Object.entries(COMMAND_META).filter(([path, m]) => READ_WORDS.has(lastWord(path)) && m.destructive).map(([p]) => p);
    expect(wrong).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Capabilities (Task 7). The server refuses an app command when the account lacks this key.
// ---------------------------------------------------------------------------------------------

// Keys that only let the holder read. Every other key lets the holder change something.
const READ_ONLY_KEYS = new Set(['patients.view_identifiers', 'reports.run', 'reports.export', 'data.export']);
const isReadKey = (key: string) => key.endsWith('.view') || READ_ONLY_KEYS.has(key);
const capabilityOf = (path: string) => COMMAND_META[path]?.capability ?? '';
const appPaths = () => byKind('app');

const READ_NAMES = new Set(['list', 'show', 'status', 'inspect', 'export']);
// Commands named for reading that take a key which also allows writing. Each is the key the matching
// route reads with; the area has no read-only key, or the route chose the stronger one.
const READ_NAME_WRITE_KEY: Record<string, string> = {
  'connectors inspect': 'prints a connector\'s settings and which secrets are set; GET /api/connectors/:id/config needs connectors.manage (connectors-routes.ts:85)',
  'connectors list': 'lists connectors; GET /api/connectors needs connectors.manage and the area has no view key (connectors-routes.ts:83)',
  'data-exposure list': 'lists hidden columns; GET /api/dashboards/column-policy needs data_exposure.manage (dashboards-routes.ts:143)',
  'data-exposure show': 'not a read: it exposes hidden columns, a write to the policy (dashboards-routes.ts:162)',
  'import status': 'shows import runs; Studio lets only lab_admin read them, like the connector routes (plugin-broker.ts:170)',
  'query export': 'writes saved queries to a file; POST /api/custom-queries/export needs query.run, the one query key (query-routes.ts:148)',
  'settings flags list': 'lists feature flags; GET /api/settings/flags needs settings.feature_flags (settings-routes.ts:68)',
  'settings numbers list': 'lists number settings; GET /api/settings/numbers needs settings.edit_general (settings-routes.ts:406)',
  'settings sync show': 'shows the sync settings and which secrets are set; GET /api/settings/sync needs sync.manage (settings-routes.ts:107)',
  'settings validation show': 'shows validation strictness; GET /api/settings/validation needs settings.edit_general (settings-routes.ts:430)',
  'sync divergence list': 'lists divergences; GET /api/settings/sync/divergences needs sync.manage (settings-routes.ts:181)',
  'sync divergence show': 'shows a divergence with the dropped content; its route needs sync.manage (settings-routes.ts:187)',
  'sync export': 'writes a signed bundle of lab data to a file; no route does it, and sync.manage is the sync key only lab_admin holds',
  'sync list': 'lists enrolled sites; GET /api/settings/sync/sites needs sync.manage (settings-routes.ts:332)',
  'user key list': 'lists a user\'s access keys; GET /api/users/:id/keys needs users.manage (access-key-routes.ts:98)',
};

const WRITE_PREFIXES = [
  'create', 'set', 'delete', 'remove', 'import', 'install', 'enable', 'disable', 'grant', 'revoke', 'reset', 'rotate',
  'purge', 'retry', 'cancel', 'publish', 'restore', 'link', 'unlink', 'merge', 'amend',
];
// Commands whose name starts like a write but that only read, with a read key (isReadKey).
const WRITE_NAME_VIEW_KEY: Record<string, string> = {
  'facilities import-run': 'shows one import run; GET /api/facilities/import/runs/:id needs facilities.view (facilities-routes.ts:3068)',
  'facilities import-runs': 'lists import runs; GET /api/facilities/import/runs needs facilities.view (facilities-routes.ts:2790)',
  'facilities import-sources': 'lists the registers an import may name; GET /api/facilities/import/sources needs facilities.view (facilities-routes.ts:1926)',
};

// The command classes the Task 7 rulings name for extra care: running code or SQL the caller supplies,
// sending lab data out in bulk, changing who can do what, reading secrets or connection details,
// destroying data, and changing sign-in or the install.
const EXTRA_CARE = [
  // code or SQL
  'plugin install', 'plugin run', 'plugin test', 'market install', 'market update', 'market rollback', 'artifact publish',
  'query import', 'ingest', 'import start', 'import resume',
  // lab data out in bulk
  'export', 'report run', 'report glass-export', 'sync export', 'query export', 'patients duplicates export',
  'patients list', 'patients show', 'patients duplicates list',
  // who can do what
  'roles create', 'roles edit', 'roles delete', 'roles grant', 'roles revoke', 'user assign-role', 'user unassign-role',
  'user set-role', 'user create', 'user key create', 'user key list', 'user key revoke', 'user end-sessions',
  'user activate', 'user deactivate', 'import allow', 'import revoke',
  // secrets or connection details
  'connectors inspect', 'connectors list', 'connectors diagnose', 'connectors test', 'connectors add', 'connectors update',
  'settings sync show',
  // destroys or resets
  'settings danger', 'db reproject', 'terminology reproject', 'facilities delete', 'layouts delete', 'report-def delete',
  'report-design delete', 'roles delete', 'connectors remove', 'plugin remove', 'market remove', 'terminology distribution purge',
  'terminology ontology unlink', 'test-catalog map clear', 'test-catalog result-fields unlink', 'sync divergence clear',
  'sync import', 'sync merge-patient',
  // sign-in or the install
  'settings flags set', 'settings numbers set', 'settings lab set', 'settings sync set', 'settings validation set',
  'sync enroll', 'sync rotate', 'sync revoke',
];
// Extra-care commands whose key a role other than lab_admin holds, because Studio already gives that
// role the same power through the route named.
const STUDIO_GIVES_THE_SAME: Record<string, string> = {
  'query import': 'POST /api/custom-queries/import needs query.run (query-routes.ts:162)',
  'query export': 'POST /api/custom-queries/export needs query.run (query-routes.ts:148)',
  'report run': 'GET /api/reports/:id.csv and :id.pdf need reports.export (reports-routes.ts:54, :74)',
  'report glass-export': 'GET /api/reports/glass/ris.csv needs reports.export (reports-routes.ts:65)',
  'patients duplicates export': 'GET /api/patients/duplicates/export needs patients.view_identifiers (patient-routes.ts:47)',
  'patients list': 'GET /api/patients unmasks for patients.view_identifiers (patient-routes.ts:15, :26)',
  'patients show': 'GET /api/patients/:ref unmasks for patients.view_identifiers (patient-routes.ts:15, :97)',
  'patients duplicates list': 'GET /api/patients/duplicates unmasks for patients.view_identifiers (patient-routes.ts:15, :37)',
  'facilities delete': 'POST /api/facilities/bulk-delete needs facilities.manage (facilities-routes.ts:1769)',
  'report-def delete': 'DELETE /api/report-defs/:id needs reports.edit_templates (report-defs-routes.ts:42)',
  'report-design delete': 'DELETE /api/report-designs/:id needs reports.edit_templates (report-designs-routes.ts:146)',
  'terminology distribution purge': 'DELETE /api/terminology/publishers/:publisherId/distribution needs terminology.manage (terminology-admin-routes.ts:495)',
  'terminology ontology unlink': 'DELETE /api/terminology/ontology/distributions/:id needs terminology.manage (ontology-routes.ts:19)',
  'test-catalog map clear': 'POST /api/test-catalog/mappings/clear needs terminology.manage (test-mapping-routes.ts:79)',
  'test-catalog result-fields unlink': 'DELETE /api/test-catalog/result-fields/:code/loinc needs terminology.manage (result-fields-routes.ts:41)',
};

describe('capabilities', () => {
  it('a command named list, show, status, inspect or export does not need a write key', () => {
    const wrong = appPaths()
      .filter((p) => READ_NAMES.has(lastWord(p)) && !isReadKey(capabilityOf(p)) && !READ_NAME_WRITE_KEY[p])
      .map((p) => `${p}: ${capabilityOf(p)}`);
    expect(wrong).toEqual([]);
  });

  it('a command named for writing does not use a read key', () => {
    const wrong = appPaths()
      .filter((p) => WRITE_PREFIXES.some((w) => lastWord(p).startsWith(w)) && isReadKey(capabilityOf(p)) && !WRITE_NAME_VIEW_KEY[p])
      .map((p) => `${p}: ${capabilityOf(p)}`);
    expect(wrong).toEqual([]);
  });

  it('keeps both allow-lists honest: real app commands, still needed', () => {
    const bad: string[] = [];
    for (const p of Object.keys(READ_NAME_WRITE_KEY)) {
      if (COMMAND_META[p]?.kind !== 'app') bad.push(`${p}: not an app command`);
      else if (!READ_NAMES.has(lastWord(p)) || isReadKey(capabilityOf(p))) bad.push(`${p}: not needed`);
    }
    for (const p of Object.keys(WRITE_NAME_VIEW_KEY)) {
      if (COMMAND_META[p]?.kind !== 'app') bad.push(`${p}: not an app command`);
      else if (!WRITE_PREFIXES.some((w) => lastWord(p).startsWith(w)) || !isReadKey(capabilityOf(p))) bad.push(`${p}: not needed`);
    }
    expect(bad).toEqual([]);
  });

  it('gives an extra-care command a key only lab_admin holds, unless Studio gives a role the same power', () => {
    const presetHolders = (key: string) => SYSTEM_ROLES.filter((r) => r.slug !== 'lab_admin' && r.capabilities.includes(key)).map((r) => r.slug);
    const bad: string[] = [];
    for (const p of EXTRA_CARE) {
      if (COMMAND_META[p]?.kind !== 'app') { bad.push(`${p}: not an app command`); continue; }
      const holders = presetHolders(capabilityOf(p));
      if (holders.length > 0 && !STUDIO_GIVES_THE_SAME[p]) bad.push(`${p}: ${capabilityOf(p)} held by ${holders.join(', ')}`);
      if (holders.length === 0 && STUDIO_GIVES_THE_SAME[p]) bad.push(`${p}: listed but only lab_admin holds ${capabilityOf(p)}`);
    }
    for (const p of Object.keys(STUDIO_GIVES_THE_SAME)) if (!EXTRA_CARE.includes(p)) bad.push(`${p}: listed but not extra care`);
    expect(bad).toEqual([]);
  });

  // Spot checks on the keys the rulings and the brief fix by name.
  it('uses the keys the brief and the routes name', () => {
    for (const p of ['user key list', 'user key create', 'user key revoke']) expect(capabilityOf(p), p).toBe('users.manage');
    for (const p of ['user list', 'user show']) expect(capabilityOf(p), p).toBe('users.view');
    expect(capabilityOf('settings danger')).toBe('settings.danger_zone');
    // Ruling: no weaker than plugin install and market install.
    expect(capabilityOf('artifact publish')).toBe(capabilityOf('market install'));
    expect(capabilityOf('plugin install')).toBe(capabilityOf('market install'));
  });
});

// ---------------------------------------------------------------------------------------------
// Rulings 41, 42 and 43: refuse, companions and localWhen.
// ---------------------------------------------------------------------------------------------

describe('calls that cannot run through the app', () => {
  it('sync export needs --out', () => {
    const refuse = COMMAND_META['sync export']!.refuse!;
    expect(refuse([], {})).toBe('Through the app, sync export needs --out <file>.');
    expect(refuse([], { out: '' })).toBe('Through the app, sync export needs --out <file>.');
    expect(refuse([], { out: 'b.bundle' })).toBeNull();
  });

  it('report run --format pdf needs --out', () => {
    const refuse = COMMAND_META['report run']!.refuse!;
    expect(refuse(['r1'], { format: 'pdf' })).toBe('Through the app, report run --format pdf needs --out <file>.');
    expect(refuse(['r1'], { format: 'pdf', out: 'r1.pdf' })).toBeNull();
    expect(refuse(['r1'], { format: 'csv' })).toBeNull();
    expect(refuse(['r1'], {})).toBeNull();
  });

  // Ruling 50: --to comes back as an output folder, and an empty output value is not "no path".
  it('artifact publish --install needs a folder for --to', () => {
    const refuse = COMMAND_META['artifact publish']!.refuse!;
    expect(refuse(['b'], { install: true, to: '' })).toBe('artifact publish needs a folder for --to.');
    expect(refuse(['b'], { install: true, to: 'registry' })).toBeNull();
    // Without --install the command runs on the caller's machine (localWhen), so the app never sees it.
    expect(refuse(['b'], { install: false, to: '' })).toBeNull();
    expect(refuse(['b'], { to: 'registry' })).toBeNull();
  });

  it('no other command refuses', () => {
    expect(Object.entries(COMMAND_META).filter(([, m]) => m.refuse).map(([p]) => p).sort()).toEqual(['artifact publish', 'report run', 'sync export']);
  });
});

describe('artifact publish runs on the caller machine without --install', () => {
  it('says so through localWhen, and stays an app command', () => {
    const meta = COMMAND_META['artifact publish']!;
    expect(meta.kind).toBe('app');
    expect(meta.localWhen!(['b'], { to: 'r', install: false })).toBe(true);
    expect(meta.localWhen!(['b'], { to: 'r' })).toBe(true);
    expect(meta.localWhen!(['b'], { to: 'r', install: true })).toBe(false);
    expect(meta.paths).toEqual([{ target: 'bundleDir', kind: 'input-dir' }, { target: '--to', kind: 'output-dir' }]);
    expect(Object.entries(COMMAND_META).filter(([, m]) => m.localWhen).map(([p]) => p)).toEqual(['artifact publish']);
  });
});

describe('plugin install companions', () => {
  const wasm = COMMAND_META['plugin install']!.paths!.find((p) => p.target === 'wasm')!;
  const manifest = COMMAND_META['plugin install']!.paths!.find((p) => p.target === '--manifest')!;
  const ctx = (opts: Record<string, unknown>, self: string | undefined, siblings: Record<string, string>): CompanionContext => ({
    opts, readSelf: () => self, readSibling: (name) => siblings[name],
  });
  const withUi = (entry: unknown) => JSON.stringify({ payload: { ui: { entry } } });

  it('wasm: manifest.json beside it, and the UI page it names', () => {
    expect(wasm.companions!(ctx({}, 'wasm', { 'manifest.json': withUi('ui.html') }))).toEqual(['manifest.json', 'ui.html']);
    expect(wasm.companions!(ctx({}, 'wasm', { 'manifest.json': JSON.stringify({ ui: { entry: 'page.html' } }) }))).toEqual(['manifest.json', 'page.html']);
    expect(wasm.companions!(ctx({}, 'wasm', { 'manifest.json': '{}' }))).toEqual(['manifest.json']);
  });

  it('wasm: nothing when --manifest is given, or the manifest is missing or not JSON', () => {
    expect(wasm.companions!(ctx({ manifest: 'm.json' }, 'wasm', { 'manifest.json': withUi('ui.html') }))).toEqual([]);
    expect(wasm.companions!(ctx({}, 'wasm', {}))).toEqual([]);
    expect(wasm.companions!(ctx({}, 'wasm', { 'manifest.json': 'not json{' }))).toEqual([]);
  });

  it('never returns a UI entry that is not a plain file name', () => {
    for (const bad of ['../x.html', 'a/b.html', 'a\\b.html', '..', '.', '', 7, null]) {
      expect(wasm.companions!(ctx({}, 'wasm', { 'manifest.json': withUi(bad) })), String(bad)).toEqual(['manifest.json']);
      expect(manifest.companions!(ctx({ manifest: 'm.json' }, withUi(bad), {})), String(bad)).toEqual([]);
    }
  });

  it('--manifest: the UI page it names, read from itself', () => {
    expect(manifest.companions!(ctx({ manifest: 'm.json' }, withUi('ui.html'), {}))).toEqual(['ui.html']);
    expect(manifest.companions!(ctx({ manifest: 'm.json' }, '{}', {}))).toEqual([]);
    expect(manifest.companions!(ctx({ manifest: 'm.json' }, undefined, {}))).toEqual([]);
    expect(manifest.companions!(ctx({ manifest: 'm.json' }, 'not json{', {}))).toEqual([]);
  });

  it('uiEntryOf reads payload.ui.entry first, then ui.entry', () => {
    expect(uiEntryOf({ payload: { ui: { entry: 'a.html' } }, ui: { entry: 'b.html' } })).toBe('a.html');
    expect(uiEntryOf({ ui: { entry: 'b.html' } })).toBe('b.html');
    expect(uiEntryOf({})).toBeUndefined();
    expect(uiEntryOf(null)).toBeUndefined();
    expect(uiEntryOf('text')).toBeUndefined();
  });

  it('only plugin install has companions', () => {
    const withCompanions = Object.entries(COMMAND_META).filter(([, m]) => m.paths?.some((p) => p.companions)).map(([p]) => p);
    expect(withCompanions).toEqual(['plugin install']);
  });
});

// ---------------------------------------------------------------------------------------------
// A local command's code reaches no context builder. Two checks, because each misses something.
//
// 1. Static: from each local command's `.action(...)` in program.ts, follow every name to what it
//    refers to: named, default and namespace imports, and re-exports, across files in this package.
//    It fails on: a reference to a builder or the config loader; a relative import it cannot find;
//    a name from a package not on SAFE_PACKAGES or SAFE_NAMES; a network module; a call to fetch; a
//    read of process.env by a name that looks like a database URL or a secret, or by a computed name.
//    It cannot see inside a package beyond the names listed as safe, or a call through an object
//    (`ctx.x()`) to a function it did not reach by name.
// 2. Run time: run each local command for real, in a temporary folder, with every builder and the
//    config loader mocked to throw. It sees calls in other packages too, but only on the branches
//    the inputs reach.
// ---------------------------------------------------------------------------------------------

const FORBIDDEN = new Set(['createAppContext', 'createDbContext', 'createIngestContext', 'createTerminologyContext', 'loadConfig', 'createInternalDb']);
const NETWORK = new Set(['http', 'https', 'net', 'tls', 'dgram', 'undici', 'node:http', 'node:https', 'node:net', 'node:tls', 'node:dgram', 'node:http2', 'http2']);
// Whole modules read and found to touch no database and no network.
const SAFE_PACKAGES = new Set([
  'node:fs', 'node:fs/promises', 'node:path', 'node:crypto', 'node:os', 'node:url',
  '@openldr/fhir', // depends only on zod: schemas and validators
]);
// Single names from packages that also hold database code, each read.
const SAFE_NAMES = new Set([
  // packages/bootstrap/src/facility-xlsx.ts imports only csv-parse and xlsx.
  '@openldr/bootstrap:facilityXlsxToCsv', '@openldr/bootstrap:FacilityXlsxError',
  // packages/bootstrap/src/facility-mapping-suggest.ts imports only @openldr/terminology's field list.
  '@openldr/bootstrap:suggestColumns',
  // packages/terminology/src/facility-csv.ts imports only node:crypto and csv-parse.
  '@openldr/terminology:validateColumnMap', '@openldr/terminology:FACILITY_CONTRACT_FIELDS',
  // packages/core/src/error-catalog.ts: two constant tables. redact.ts and errors.ts: string
  // functions that redactError uses. None of the three files imports anything.
  '@openldr/core:CATALOG', '@openldr/core:DOMAINS', '@openldr/core:redact', '@openldr/core:errorMessage',
  // packages/forms/src/extract/extract.ts and to-transaction-bundle.ts: pure transforms of two FHIR resources.
  '@openldr/forms:ObservationExtractor', '@openldr/forms:ServiceRequestExtractor', '@openldr/forms:toTransactionBundle',
  // packages/marketplace/src/signing.ts, scaffold.ts, pack.ts, bundle-fs.ts, artifact-manifest.ts, grant.ts:
  // node:crypto, node:fs, node:path and zod only.
  '@openldr/marketplace:generatePublisherKeypair', '@openldr/marketplace:scaffold', '@openldr/marketplace:packBundle',
  '@openldr/marketplace:readBundle', '@openldr/marketplace:verifyBundle', '@openldr/marketplace:parseArtifactManifest',
  '@openldr/marketplace:readGrant', '@openldr/marketplace:allowedHosts',
  // packages/plugins/src/wasm-converter.ts (core, fhir, marketplace) and extism-runner.ts (@extism/extism):
  // run a plugin's wasm in this process.
  '@openldr/plugins:createWasmConverter', '@openldr/plugins:createExtismRunner',
  // artifact build runs `cargo build` and waits for it. A program on the caller's own machine.
  'node:child_process:execSync',
]);
const SECRET_ENV = /DATABASE|_DB_|_DB$|SECRET|PASSWORD|TOKEN|_KEY$|^KEY$|URL$/i;

interface Imp { from: string; name: string }
interface Reexport { from: string; names: Map<string, string> | null }
interface Mod {
  sf: ts.SourceFile; fns: Map<string, ts.Node>; imports: Map<string, Imp>;
  aliases: Map<string, string>; reexports: Reexport[]; bare: string[];
}

function createWalker(read: (file: string) => string | undefined) {
  const mods = new Map<string, Mod>();
  const mod = (file: string): Mod => {
    const cached = mods.get(file);
    if (cached) return cached;
    const sf = ts.createSourceFile(file, read(file) ?? '', ts.ScriptTarget.Latest, true);
    const m: Mod = { sf, fns: new Map(), imports: new Map(), aliases: new Map(), reexports: [], bare: [] };
    const isDefault = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((x) => x.kind === ts.SyntaxKind.DefaultKeyword);
    for (const st of sf.statements) {
      if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st))) {
        if (st.name) m.fns.set(st.name.text, st);
        if (isDefault(st)) m.fns.set('default', st);
      }
      if (ts.isExportAssignment(st)) m.fns.set('default', st.expression);
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) m.fns.set(d.name.text, d.initializer);
      }
      if (ts.isImportDeclaration(st)) {
        const from = (st.moduleSpecifier as ts.StringLiteral).text;
        const clause = st.importClause;
        if (!clause) { m.bare.push(from); continue; }
        if (clause.isTypeOnly) continue;
        if (clause.name) m.imports.set(clause.name.text, { from, name: 'default' });
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) m.imports.set(nb.name.text, { from, name: '*' });
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) if (!el.isTypeOnly) m.imports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
        }
      }
      if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
        const from = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
        const clause = st.exportClause;
        if (from && !clause) m.reexports.push({ from, names: null });
        else if (clause && ts.isNamedExports(clause)) {
          const names = new Map<string, string>();
          for (const el of clause.elements) names.set(el.name.text, (el.propertyName ?? el.name).text);
          if (from) m.reexports.push({ from, names });
          else for (const [exported, local] of names) m.aliases.set(exported, local);
        } else if (from && clause && ts.isNamespaceExport(clause)) {
          m.reexports.push({ from, names: new Map([[clause.name.text, '*']]) });
        }
      }
    }
    mods.set(file, m);
    return m;
  };
  const resolveRel = (fromFile: string, spec: string): string | null => {
    const base = join(dirname(fromFile), spec);
    for (const c of [base, `${base}.ts`, base.replace(/\.(m?js)$/, '.ts'), join(base, 'index.ts')]) {
      if (c.endsWith('.ts') && read(c) !== undefined) return c;
    }
    return null;
  };

  interface State { seen: Set<string>; found: Set<string> }
  const checkPackage = (spec: string, name: string, st: State): void => {
    if (NETWORK.has(spec)) st.found.add(`network import ${spec}`);
    else if (!SAFE_PACKAGES.has(spec) && !SAFE_NAMES.has(`${spec}:${name}`)) st.found.add(`${spec}:${name}`);
  };
  const useSpec = (file: string, spec: string, name: string, st: State): void => {
    if (!spec.startsWith('.')) { checkPackage(spec, name, st); return; }
    const target = resolveRel(file, spec);
    if (!target) { st.found.add(`unresolved import ${spec} in ${basename(file)}`); return; }
    reachExport(target, name, st);
  };
  const enter = (file: string, st: State): void => {
    const key = `${file}#<module>`;
    if (st.seen.has(key)) return;
    st.seen.add(key);
    for (const spec of mod(file).bare) useSpec(file, spec, '<side effect>', st);
  };
  const reachExport = (file: string, name: string, st: State): void => {
    const key = `${file}#export:${name}`;
    if (st.seen.has(key)) return;
    st.seen.add(key);
    enter(file, st);
    const m = mod(file);
    if (name === '*') { walk(file, m.sf, st); return; }
    const local = m.aliases.get(name) ?? name;
    const fn = m.fns.get(local);
    if (fn) { walk(file, fn, st); return; }
    const imp = m.imports.get(local);
    if (imp) { useSpec(file, imp.from, imp.name, st); return; }
    for (const re of m.reexports) {
      if (re.names === null) useSpec(file, re.from, name, st);
      else if (re.names.has(name)) useSpec(file, re.from, re.names.get(name)!, st);
    }
  };
  const isProcessEnv = (e: ts.Expression) => ts.isPropertyAccessExpression(e) && e.name.text === 'env' && ts.isIdentifier(e.expression) && e.expression.text === 'process';
  function walk(file: string, node: ts.Node, st: State): void {
    enter(file, st);
    const m = mod(file);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        if (n.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const spec = n.arguments[0];
          if (spec && ts.isStringLiteral(spec)) useSpec(file, spec.text, '*', st);
          else st.found.add(`dynamic import of a computed name in ${basename(file)}`);
        }
        const callee = n.expression.getText();
        if (callee === 'fetch' || callee.endsWith('.fetch')) st.found.add('fetch(');
      }
      if (ts.isPropertyAccessExpression(n) && isProcessEnv(n.expression) && SECRET_ENV.test(n.name.text)) st.found.add(`process.env.${n.name.text}`);
      if (ts.isElementAccessExpression(n) && isProcessEnv(n.expression)) st.found.add('process.env[...]');
      if (ts.isIdentifier(n)) {
        const name = n.text;
        if (FORBIDDEN.has(name)) st.found.add(name);
        const key = `${file}#${name}`;
        if (!st.seen.has(key)) {
          st.seen.add(key);
          const local = m.fns.get(name);
          if (local && local !== node) walk(file, local, st);
          const imp = m.imports.get(name);
          if (imp) useSpec(file, imp.from, imp.name, st);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  }

  return {
    mod,
    /** Everything the walk flags, starting from one node of one file. */
    reach(file: string, node: ts.Node): string[] {
      const st: State = { seen: new Set(), found: new Set() };
      walk(file, node, st);
      return [...st.found].sort();
    },
  };
}

const readReal = (file: string): string | undefined => { try { return readFileSync(file, 'utf8'); } catch { return undefined; } };

/** Each `.action(...)` callback in program.ts, keyed by the command path its chain builds. */
function actionsInProgram(walker: ReturnType<typeof createWalker>): Map<string, ts.Node> {
  const m = walker.mod(join(SRC, 'program.ts'));
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

/** Runs the walk over a few files held in memory, starting from `run` in /v/entry.ts. */
function reachVirtual(files: Record<string, string>): string[] {
  const walker = createWalker((f) => files[f]);
  const entry = walker.mod('/v/entry.ts');
  return walker.reach('/v/entry.ts', entry.fns.get('run')!);
}

describe('local commands', () => {
  it("a local command's code reaches no context builder, on any branch (static)", () => {
    const walker = createWalker(readReal);
    const actions = actionsInProgram(walker);
    const report: Record<string, string[]> = {};
    for (const path of byKind('local')) {
      const cb = actions.get(path);
      if (!cb) { report[path] = ['no .action found in program.ts']; continue; }
      const found = walker.reach(join(SRC, 'program.ts'), cb);
      if (found.length > 0) report[path] = found;
    }
    expect(report).toEqual({});
  });

  describe('the static check can fail', () => {
    const builder = 'import { createAppContext } from "@openldr/bootstrap";\nexport function x() { return createAppContext(); }\n';
    it('on a builder reached in the real code: artifact publish', () => {
      const walker = createWalker(readReal);
      const found = walker.reach(join(SRC, 'program.ts'), actionsInProgram(walker).get('artifact publish')!);
      expect(found).toContain('createIngestContext');
      expect(found).toContain('loadConfig');
    });
    it('on a relative import it cannot find', () => {
      expect(reachVirtual({ '/v/entry.ts': 'import { x } from "./missing.js";\nexport function run() { return x(); }\n' }))
        .toEqual(['unresolved import ./missing.js in entry.ts']);
    });
    it('through an import written with .js', () => {
      expect(reachVirtual({ '/v/entry.ts': 'import { x } from "./b.js";\nexport function run() { return x(); }\n', '/v/b.ts': builder }))
        .toContain('createAppContext');
    });
    it('through a namespace import', () => {
      expect(reachVirtual({ '/v/entry.ts': 'import * as b from "./b";\nexport function run() { return b.x(); }\n', '/v/b.ts': builder }))
        .toContain('createAppContext');
    });
    it('through a default import', () => {
      expect(reachVirtual({
        '/v/entry.ts': 'import b from "./b";\nexport function run() { return b(); }\n',
        '/v/b.ts': 'import { loadConfig } from "@openldr/config";\nexport default function () { return loadConfig(); }\n',
      })).toContain('loadConfig');
    });
    it('through a named re-export and a star re-export', () => {
      const entry = 'import { x } from "./idx";\nexport function run() { return x(); }\n';
      expect(reachVirtual({ '/v/entry.ts': entry, '/v/idx.ts': 'export { x } from "./b";\n', '/v/b.ts': builder })).toContain('createAppContext');
      expect(reachVirtual({ '/v/entry.ts': entry, '/v/idx.ts': 'export * from "./b";\n', '/v/b.ts': builder })).toContain('createAppContext');
    });
    it('on a package not read as safe', () => {
      expect(reachVirtual({ '/v/entry.ts': 'import { pad } from "left-pad";\nexport function run() { return pad(); }\n' }))
        .toEqual(['left-pad:pad']);
    });
    it('on a network module and on fetch', () => {
      expect(reachVirtual({ '/v/entry.ts': 'import { request } from "node:http";\nexport function run() { return request("x"); }\n' }))
        .toEqual(['network import node:http']);
      expect(reachVirtual({ '/v/entry.ts': 'export function run() { return fetch("http://127.0.0.1:3000"); }\n' }))
        .toEqual(['fetch(']);
    });
    it('on a read of a database URL or secret from the environment', () => {
      expect(reachVirtual({ '/v/entry.ts': 'export function run() { return process.env.INTERNAL_DATABASE_URL; }\n' }))
        .toEqual(['process.env.INTERNAL_DATABASE_URL']);
      expect(reachVirtual({ '/v/entry.ts': 'export function run() { return process.env.OPENLDR_SECRETS_KEY; }\n' }))
        .toEqual(['process.env.OPENLDR_SECRETS_KEY']);
      expect(reachVirtual({ '/v/entry.ts': 'const k = "X";\nexport function run() { return process.env[k]; }\n' }))
        .toEqual(['process.env[...]']);
    });
    it('and passes clean code', () => {
      expect(reachVirtual({ '/v/entry.ts': 'import { join } from "node:path";\nexport function run() { return join("a", "b") + process.env.APP_VERSION; }\n' }))
        .toEqual([]);
    });
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

    it('artifact publish without --install reaches no builder and no config loader', async () => {
      const keys = join(dir, 'publish-keys');
      expect((await run(['artifact', 'keygen', '--out', keys])).code).toBe(0);
      expect((await run(['artifact', 'new', 'form', 'pub', '--out', dir])).code).toBe(0);
      const bundle = join(dir, 'pub-bundle');
      expect((await run(['artifact', 'pack', join(dir, 'pub'), '--key', join(keys, 'publisher.priv'), '--out', bundle])).code).toBe(0);
      const registry = join(dir, 'registry');
      const { code, stdout } = await run(['artifact', 'publish', bundle, '--to', registry, '--json']);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toHaveProperty('published');
      for (const [name, fn] of Object.entries(builders)) expect(fn, name).not.toHaveBeenCalled();
    });

    it('a builder call is seen: an app command run the same way calls the mocked loader', async () => {
      // Shows the mocks are wired: `roles list` is an app command and reaches loadConfig first.
      expect((await run(['roles', 'list', '--json'])).code).toBe(1);
      expect(builders.loadConfig).toHaveBeenCalled();
      builders.loadConfig.mockClear();
      // And the same for publish with --install, the part localWhen sends through the app.
      const { code } = await run(['artifact', 'publish', join(dir, 'pub-bundle'), '--to', join(dir, 'registry2'), '--install']);
      expect(code).toBe(1);
      expect(builders.loadConfig).toHaveBeenCalled();
      builders.loadConfig.mockClear();
    });
  });
});
