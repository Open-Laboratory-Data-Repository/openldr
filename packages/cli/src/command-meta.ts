// How each `openldr` command runs. The client and the server both read this table: the server
// checks it before it starts a command, and the client uses it to decide what to send.
//
// This file is data. It imports nothing, not even a type, because the server bundles it through
// `@openldr/cli/meta` and it must pull in nothing else.
//
// - app: runs in a process the server starts, after sign-in. Almost everything.
// - recovery: runs on this machine, straight on the database, with no sign-in. Exactly the ten in
//   the design (spec section 6.7). Nothing else may be added here.
// - local: runs on the caller's machine and touches no database, no server and no context builder,
//   whatever the options. Read from each command's code; command-meta.test.ts checks it.
//
// Each entry was read from the command's code in packages/cli/src, not guessed from its name.
// When unsure, the entry is app, which needs sign-in.

export type CommandKind = 'app' | 'recovery' | 'local';
export type PathKind = 'input-file' | 'input-dir' | 'output-file' | 'output-dir';
export interface PathMark {
  /** An option's long flag such as '--out', or a positional argument's name such as 'file'. */
  target: string;
  /** A function when the kind depends on the other arguments. */
  kind: PathKind | ((args: string[], opts: Record<string, unknown>) => PathKind);
  /** True when the server keeps the upload after the request, for a command that needs it again. */
  keep?: boolean;
}
export interface CommandMeta { kind: CommandKind; capability?: string; destructive?: boolean; paths?: PathMark[] }

const inFile = (target: string): PathMark => ({ target, kind: 'input-file' });
const inDir = (target: string): PathMark => ({ target, kind: 'input-dir' });
const outFile = (target: string): PathMark => ({ target, kind: 'output-file' });
const outDir = (target: string): PathMark => ({ target, kind: 'output-dir' });

/** `terminology import <kind> <path>`: LOINC reads a folder; amr reads a WHONET database file; the
 *  rest read a JSON file (packages/cli/src/terminology.ts, packages/bootstrap/src/terminology-context.ts). */
const terminologyImportPath = (args: string[]): PathKind => (args[0] === 'loinc' ? 'input-dir' : 'input-file');

/** Freezes the table, each entry, each paths list and each mark, so no caller can change a kind. */
function freezeTable(table: Record<string, CommandMeta>): Readonly<Record<string, CommandMeta>> {
  for (const meta of Object.values(table)) {
    for (const mark of meta.paths ?? []) Object.freeze(mark);
    if (meta.paths) Object.freeze(meta.paths);
    Object.freeze(meta);
  }
  return Object.freeze(table);
}

/** Keyed by the command's path, words joined by one space: 'roles list', 'user key create'. */
export const COMMAND_META: Readonly<Record<string, CommandMeta>> = freezeTable({
  // Local: no database, no server, no context builder.
  'artifact build': { kind: 'local', paths: [inDir('dir')] },
  'artifact keygen': { kind: 'local', destructive: true, paths: [outDir('--out')] },
  'artifact new': { kind: 'local', paths: [outDir('--out')] },
  'artifact pack': { kind: 'local', paths: [inDir('dir'), inFile('--key'), outDir('--out')] },
  'artifact sign': { kind: 'local', paths: [inDir('dir'), inFile('--key')] },
  'artifact test': { kind: 'local', paths: [inDir('dir'), inFile('--sample')] },
  'commands': { kind: 'local' },
  'errors list': { kind: 'local' },
  'facilities suggest-map': { kind: 'local', paths: [inFile('path')] },
  'fhir validate': { kind: 'local', paths: [inFile('file')] },
  'forms extract': { kind: 'local', paths: [inFile('questionnaire'), inFile('response')] },
  'market verify': { kind: 'local', paths: [inDir('dir')] },

  // Recovery: straight on the database, no sign-in (spec section 6.7).
  'auth rebind-issuer': { kind: 'recovery', destructive: true },
  'auth setup-code': { kind: 'recovery' },
  'db migrate': { kind: 'recovery' },
  'db reset': { kind: 'recovery', destructive: true },
  'db seed': { kind: 'recovery' },
  'doctor': { kind: 'recovery' },
  'health': { kind: 'recovery' },
  'storage copy': { kind: 'recovery' },
  'target-store test': { kind: 'recovery' },
  'user reset-password': { kind: 'recovery', destructive: true },

  // App: through the running server, after sign-in.
  // `artifact publish` has a local part (--to copies the bundle into a folder) and a database part
  // (--install). It stays app until the split is ruled on.
  'artifact publish': { kind: 'app', paths: [inDir('bundleDir'), outDir('--to')] },

  'audit list': { kind: 'app' },

  'connectors add': { kind: 'app', paths: [inFile('--file')] },
  'connectors diagnose': { kind: 'app' },
  'connectors inspect': { kind: 'app' },
  'connectors list': { kind: 'app' },
  'connectors remove': { kind: 'app', destructive: true },
  'connectors test': { kind: 'app' },
  'connectors update': { kind: 'app', paths: [inFile('--file')] },

  'data-exposure hide': { kind: 'app' },
  'data-exposure list': { kind: 'app' },
  'data-exposure show': { kind: 'app' },

  'db reproject': { kind: 'app', destructive: true },

  'export': { kind: 'app', paths: [outDir('--out')] },

  'facilities add-type': { kind: 'app' },
  'facilities conflicts': { kind: 'app' },
  'facilities delete': { kind: 'app', destructive: true },
  'facilities import': { kind: 'app', paths: [inFile('path'), inFile('--column-map'), inFile('--value-map')] },
  'facilities import-run': { kind: 'app' },
  'facilities import-run-cancel': { kind: 'app' },
  'facilities import-run-revalidate': { kind: 'app', paths: [inFile('--column-map')] },
  'facilities import-runs': { kind: 'app' },
  'facilities import-sources': { kind: 'app' },
  'facilities jobs': { kind: 'app' },
  'facilities link-matching': { kind: 'app' },
  'facilities list': { kind: 'app' },
  'facilities publish': { kind: 'app' },
  'facilities register-source': { kind: 'app' },
  'facilities scan-observed': { kind: 'app' },
  'facilities suggest-values': { kind: 'app', paths: [inFile('path'), inFile('--column-map')] },

  'forms lint': { kind: 'app' },
  'forms list': { kind: 'app' },
  'forms restore': { kind: 'app', destructive: true },
  'forms versions': { kind: 'app' },

  'import allow': { kind: 'app' },
  'import allowed': { kind: 'app' },
  'import failures': { kind: 'app' },
  'import resume': { kind: 'app' },
  'import revoke': { kind: 'app' },
  'import start': { kind: 'app' },
  'import status': { kind: 'app' },
  'import stop': { kind: 'app' },

  'ingest': { kind: 'app', paths: [inFile('file'), inFile('--config')] },

  'layouts delete': { kind: 'app', destructive: true },
  'layouts list': { kind: 'app' },
  'layouts set': { kind: 'app' },

  'market disable': { kind: 'app' },
  'market enable': { kind: 'app' },
  'market install': { kind: 'app', destructive: true, paths: [inDir('dir')] },
  'market list': { kind: 'app' },
  'market remove': { kind: 'app' },
  'market rollback': { kind: 'app' },
  'market sites': { kind: 'app' },
  'market update': { kind: 'app', destructive: true, paths: [inDir('dir')] },

  'patients duplicates dismiss': { kind: 'app' },
  'patients duplicates export': { kind: 'app', paths: [outFile('--out')] },
  'patients duplicates list': { kind: 'app' },
  'patients duplicates restore': { kind: 'app' },
  'patients identifier-systems list': { kind: 'app' },
  'patients identifier-systems set': { kind: 'app' },
  'patients list': { kind: 'app' },
  'patients show': { kind: 'app' },

  'pipeline logs': { kind: 'app' },
  'pipeline retry': { kind: 'app' },
  'pipeline status': { kind: 'app' },

  'plugin install': { kind: 'app', paths: [inFile('wasm'), inFile('--manifest')] },
  'plugin list': { kind: 'app' },
  'plugin remove': { kind: 'app' },
  'plugin run': { kind: 'app', paths: [inFile('input')] },
  'plugin test': { kind: 'app' },

  'provenance audit': { kind: 'app' },

  'query export': { kind: 'app', paths: [outFile('--out')] },
  'query import': { kind: 'app', destructive: true, paths: [inFile('file')] },

  'queue status': { kind: 'app' },

  'report glass-export': { kind: 'app', paths: [outFile('--out')] },
  'report list': { kind: 'app' },
  'report run': { kind: 'app', paths: [outFile('--out')] },

  'report-def delete': { kind: 'app', destructive: true },
  'report-def list': { kind: 'app' },

  'report-design delete': { kind: 'app', destructive: true },
  'report-design list': { kind: 'app' },
  'report-design publish': { kind: 'app' },
  'report-design versions': { kind: 'app' },

  'roles create': { kind: 'app' },
  'roles delete': { kind: 'app' },
  'roles doctor': { kind: 'app' },
  'roles edit': { kind: 'app' },
  'roles grant': { kind: 'app' },
  'roles list': { kind: 'app' },
  'roles revoke': { kind: 'app' },
  'roles show': { kind: 'app' },

  'settings danger': { kind: 'app', destructive: true },
  'settings flags list': { kind: 'app' },
  'settings flags set': { kind: 'app' },
  'settings lab set': { kind: 'app', paths: [inFile('--logo-file')] },
  'settings lab show': { kind: 'app' },
  'settings numbers list': { kind: 'app' },
  'settings numbers set': { kind: 'app' },
  'settings sync set': { kind: 'app' },
  'settings sync show': { kind: 'app' },
  'settings validation set': { kind: 'app' },
  'settings validation show': { kind: 'app' },

  'sync amend': { kind: 'app' },
  'sync divergence clear': { kind: 'app' },
  'sync divergence list': { kind: 'app' },
  'sync divergence show': { kind: 'app' },
  'sync enroll': { kind: 'app' },
  'sync export': { kind: 'app', paths: [outFile('--out')] },
  'sync import': { kind: 'app', paths: [inFile('file')] },
  'sync list': { kind: 'app' },
  'sync merge-patient': { kind: 'app' },
  'sync now': { kind: 'app' },
  'sync quarantine list': { kind: 'app' },
  'sync quarantine retry': { kind: 'app' },
  'sync revoke': { kind: 'app' },
  'sync rotate': { kind: 'app' },
  'sync status': { kind: 'app' },

  'terminology distribution import': { kind: 'app', paths: [inFile('--file')] },
  'terminology distribution purge': { kind: 'app' },
  'terminology expand': { kind: 'app' },
  'terminology import': { kind: 'app', paths: [{ target: 'path', kind: terminologyImportPath }] },
  'terminology lookup': { kind: 'app' },
  // The folder is recorded as the distribution's source and read again by `rebuild`, so the server keeps it.
  'terminology ontology build': { kind: 'app', paths: [{ target: 'dir', kind: 'input-dir', keep: true }] },
  'terminology ontology list': { kind: 'app' },
  'terminology ontology rebuild': { kind: 'app' },
  'terminology ontology unlink': { kind: 'app' },
  'terminology publisher create': { kind: 'app' },
  'terminology publisher list': { kind: 'app' },
  'terminology reproject': { kind: 'app', destructive: true },
  'terminology system create': { kind: 'app' },
  'terminology system list': { kind: 'app' },
  'terminology term list': { kind: 'app' },
  'terminology translate': { kind: 'app' },
  'terminology validate-code': { kind: 'app' },
  'terminology valueset list': { kind: 'app' },

  'test-catalog disable': { kind: 'app' },
  'test-catalog enable': { kind: 'app' },
  'test-catalog export': { kind: 'app', paths: [outFile('--out')] },
  'test-catalog import': { kind: 'app', paths: [inFile('file'), inFile('--column-map'), inFile('--value-map')] },
  'test-catalog list': { kind: 'app' },
  'test-catalog map clear': { kind: 'app', destructive: true },
  'test-catalog map export': { kind: 'app', paths: [outFile('--out')] },
  'test-catalog map import': { kind: 'app', destructive: true, paths: [inFile('file')] },
  'test-catalog map list': { kind: 'app' },
  'test-catalog map match': { kind: 'app', destructive: true },
  'test-catalog map rebuild': { kind: 'app' },
  'test-catalog map set': { kind: 'app' },
  'test-catalog params': { kind: 'app', paths: [inFile('--set')] },
  'test-catalog restore': { kind: 'app' },
  'test-catalog result-fields export': { kind: 'app', paths: [outFile('--out')] },
  'test-catalog result-fields import': { kind: 'app', destructive: true, paths: [inFile('file')] },
  'test-catalog result-fields link': { kind: 'app' },
  'test-catalog result-fields list': { kind: 'app' },
  'test-catalog result-fields unlink': { kind: 'app', destructive: true },
  'test-catalog retire': { kind: 'app' },

  // Builds an app context (packages/cli/src/update.ts), so it is not local.
  'update check': { kind: 'app' },

  'user activate': { kind: 'app' },
  'user assign-role': { kind: 'app' },
  'user create': { kind: 'app' },
  'user deactivate': { kind: 'app' },
  'user directory-list': { kind: 'app' },
  'user end-sessions': { kind: 'app' },
  'user key create': { kind: 'app' },
  'user key list': { kind: 'app' },
  'user key revoke': { kind: 'app', destructive: true },
  'user list': { kind: 'app' },
  'user preferences set': { kind: 'app' },
  'user preferences show': { kind: 'app' },
  'user set-role': { kind: 'app' },
  'user show': { kind: 'app' },
  'user unassign-role': { kind: 'app' },
  'users list': { kind: 'app' },

  'workflows receipts list': { kind: 'app' },
  'workflows receipts show': { kind: 'app' },
});
