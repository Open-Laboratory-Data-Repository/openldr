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
//
// destructive: true when the command removes stored data, overwrites it with no way back, or cuts
// off access (revoke, end sessions, deactivate, reset). Every command with --force is destructive.
// When unsure, true.

export type CommandKind = 'app' | 'recovery' | 'local';
export type PathKind = 'input-file' | 'input-dir' | 'output-file' | 'output-dir';

/** What a companions function may look at. Both readers return undefined for a missing file. */
export interface CompanionContext {
  opts: Record<string, unknown>;
  /** The text of the file this mark names. */
  readSelf(): string | undefined;
  /** The text of a file beside the file this mark names. */
  readSibling(name: string): string | undefined;
}

/**
 * One argument or option that names a file or folder.
 * An empty string as its value means "no path": for example `settings lab set --logo-file ''`
 * clears the logo. The client sends an empty value as is and uploads nothing.
 */
export interface PathMark {
  /** An option's long flag such as '--out', or a positional argument's name such as 'file'. */
  readonly target: string;
  /** A function when the kind depends on the other arguments. */
  readonly kind: PathKind | ((args: string[], opts: Record<string, unknown>) => PathKind);
  /** True when the server keeps the upload after the request, for a command that needs it again. */
  readonly keep?: boolean;
  /** Plain file names beside this file that the command also reads, so they are uploaded with it. */
  readonly companions?: (ctx: CompanionContext) => string[];
}

export interface CommandMeta {
  readonly kind: CommandKind;
  readonly capability?: string;
  readonly destructive?: boolean;
  readonly paths?: readonly PathMark[];
  /** True means this call runs on the caller's own machine, although the command is not local. */
  readonly localWhen?: (args: string[], opts: Record<string, unknown>) => boolean;
  /** A message means this call cannot run through the app; null means it can. */
  readonly refuse?: (args: string[], opts: Record<string, unknown>) => string | null;
}

const inFile = (target: string): PathMark => ({ target, kind: 'input-file' });
const inDir = (target: string): PathMark => ({ target, kind: 'input-dir' });
const outFile = (target: string): PathMark => ({ target, kind: 'output-file' });
const outDir = (target: string): PathMark => ({ target, kind: 'output-dir' });

/** `terminology import <kind> <path>`: LOINC reads a folder; amr reads a WHONET database file; the
 *  rest read a JSON file (packages/cli/src/terminology.ts, packages/bootstrap/src/terminology-context.ts). */
const terminologyImportPath = (args: string[]): PathKind => (args[0] === 'loinc' ? 'input-dir' : 'input-file');

/** The UI page a plugin manifest names: payload.ui.entry in an artifact manifest, ui.entry in the
 *  older flat one. `readAdjacentUi` in plugin.ts uses this, so the rule exists once. */
export function uiEntryOf(manifest: unknown): string | undefined {
  if (manifest === null || typeof manifest !== 'object') return undefined;
  const m = manifest as { ui?: { entry?: string }; payload?: { ui?: { entry?: string } } };
  return m.payload?.ui?.entry ?? m.ui?.entry;
}

/** One plain file name: not empty, not `.` or `..`, and no `/`, `\` or NUL. */
function isPlainFileName(name: unknown): name is string {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
}

/** The UI entry of a manifest's text, when it is a plain file name. A missing or broken manifest gives none. */
function uiCompanion(text: string | undefined): string[] {
  if (text === undefined) return [];
  let manifest: unknown;
  try { manifest = JSON.parse(text); } catch { return []; }
  const entry = uiEntryOf(manifest);
  return isPlainFileName(entry) ? [entry] : [];
}

/** `plugin install <wasm>` reads manifest.json beside the wasm when --manifest is absent, and the
 *  UI page that manifest names from beside it (packages/cli/src/plugin.ts). */
const pluginWasmCompanions = ({ opts, readSibling }: CompanionContext): string[] => {
  if (opts.manifest !== undefined) return [];
  const text = readSibling('manifest.json');
  if (text === undefined) return [];
  try { JSON.parse(text); } catch { return []; }
  return ['manifest.json', ...uiCompanion(text)];
};

/** `plugin install --manifest <path>` reads the UI page the manifest names from beside it. */
const pluginManifestCompanions = ({ readSelf }: CompanionContext): string[] => uiCompanion(readSelf());

const hasOut = (opts: Record<string, unknown>): boolean => typeof opts.out === 'string' && opts.out !== '';

/** Freezes each mark, each paths list and each entry, then the table, so no caller can change a kind.
 *  The table has no prototype, so a lookup by a caller's string such as '__proto__' finds nothing. */
function freezeTable(entries: Record<string, CommandMeta>): Readonly<Record<string, CommandMeta>> {
  const table = Object.create(null) as Record<string, CommandMeta>;
  for (const [path, meta] of Object.entries(entries)) {
    for (const mark of meta.paths ?? []) Object.freeze(mark);
    if (meta.paths) Object.freeze(meta.paths);
    table[path] = Object.freeze(meta);
  }
  return Object.freeze(table);
}

/** Keyed by the command's path, words joined by one space: 'roles list', 'user key create'. */
export const COMMAND_META: Readonly<Record<string, CommandMeta>> = freezeTable({
  // Local: no database, no server, no context builder.
  'artifact build': { kind: 'local', paths: [inDir('dir')] },
  'artifact keygen': { kind: 'local', destructive: true, paths: [outDir('--out')] },
  // Writes the scaffold over any file of the same name.
  'artifact new': { kind: 'local', destructive: true, paths: [outDir('--out')] },
  'artifact pack': { kind: 'local', paths: [inDir('dir'), inFile('--key'), outDir('--out')] },
  // Packs in place, writing over the project's own manifest.json.
  'artifact sign': { kind: 'local', destructive: true, paths: [inDir('dir'), inFile('--key')] },
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
  // Without --install it only copies the bundle into --to on the caller's machine. With --install
  // the whole command goes through the app, and --to comes back as an output folder.
  'artifact publish': {
    kind: 'app', destructive: true, paths: [inDir('bundleDir'), outDir('--to')],
    localWhen: (_args, opts) => !opts.install,
  },

  'audit list': { kind: 'app' },

  'connectors add': { kind: 'app', paths: [inFile('--file')] },
  'connectors diagnose': { kind: 'app' },
  'connectors inspect': { kind: 'app' },
  'connectors list': { kind: 'app' },
  'connectors remove': { kind: 'app', destructive: true },
  'connectors test': { kind: 'app' },
  'connectors update': { kind: 'app', destructive: true, paths: [inFile('--file')] },

  'data-exposure hide': { kind: 'app' },
  'data-exposure list': { kind: 'app' },
  'data-exposure show': { kind: 'app' },

  'db reproject': { kind: 'app', destructive: true },

  'export': { kind: 'app', paths: [outDir('--out')] },

  'facilities add-type': { kind: 'app' },
  'facilities conflicts': { kind: 'app' },
  'facilities delete': { kind: 'app', destructive: true },
  // --apply can retire rows the register declares removed or leaves out.
  'facilities import': { kind: 'app', destructive: true, paths: [inFile('path'), inFile('--column-map'), inFile('--value-map')] },
  'facilities import-run': { kind: 'app' },
  'facilities import-run-cancel': { kind: 'app', destructive: true },
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
  'import revoke': { kind: 'app', destructive: true },
  'import start': { kind: 'app' },
  'import status': { kind: 'app' },
  'import stop': { kind: 'app' },

  'ingest': { kind: 'app', paths: [inFile('file'), inFile('--config')] },

  'layouts delete': { kind: 'app', destructive: true },
  'layouts list': { kind: 'app' },
  // Replaces the layout with this name.
  'layouts set': { kind: 'app', destructive: true },

  'market disable': { kind: 'app' },
  'market enable': { kind: 'app' },
  'market install': { kind: 'app', destructive: true, paths: [inDir('dir')] },
  'market list': { kind: 'app' },
  'market remove': { kind: 'app', destructive: true },
  'market rollback': { kind: 'app', destructive: true },
  'market sites': { kind: 'app' },
  'market update': { kind: 'app', destructive: true, paths: [inDir('dir')] },

  'patients duplicates dismiss': { kind: 'app', destructive: true },
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

  // Installing an id and version that exist writes over the stored row (packages/plugins/src/store.ts).
  'plugin install': {
    kind: 'app', destructive: true,
    paths: [
      { target: 'wasm', kind: 'input-file', companions: pluginWasmCompanions },
      { target: '--manifest', kind: 'input-file', companions: pluginManifestCompanions },
    ],
  },
  'plugin list': { kind: 'app' },
  'plugin remove': { kind: 'app', destructive: true },
  'plugin run': { kind: 'app', paths: [inFile('input')] },
  'plugin test': { kind: 'app' },

  'provenance audit': { kind: 'app' },

  'query export': { kind: 'app', paths: [outFile('--out')] },
  'query import': { kind: 'app', destructive: true, paths: [inFile('file')] },

  'queue status': { kind: 'app' },

  'report glass-export': { kind: 'app', paths: [outFile('--out')] },
  'report list': { kind: 'app' },
  // With --format pdf and no --out it writes <id>.pdf in the working folder, which the app removes.
  'report run': {
    kind: 'app', paths: [outFile('--out')],
    refuse: (_args, opts) => (opts.format === 'pdf' && !hasOut(opts) ? 'Through the app, report run --format pdf needs --out <file>.' : null),
  },

  'report-def delete': { kind: 'app', destructive: true },
  'report-def list': { kind: 'app' },

  'report-design delete': { kind: 'app', destructive: true },
  'report-design list': { kind: 'app' },
  'report-design publish': { kind: 'app' },
  'report-design versions': { kind: 'app' },

  'roles create': { kind: 'app' },
  'roles delete': { kind: 'app', destructive: true },
  'roles doctor': { kind: 'app' },
  // --caps replaces the whole set, which can take capabilities away.
  'roles edit': { kind: 'app', destructive: true },
  'roles grant': { kind: 'app' },
  'roles list': { kind: 'app' },
  'roles revoke': { kind: 'app', destructive: true },
  'roles show': { kind: 'app' },

  'settings danger': { kind: 'app', destructive: true },
  'settings flags list': { kind: 'app' },
  'settings flags set': { kind: 'app' },
  // Writes over the stored logo and letterhead fields.
  'settings lab set': { kind: 'app', destructive: true, paths: [inFile('--logo-file')] },
  'settings lab show': { kind: 'app' },
  'settings numbers list': { kind: 'app' },
  'settings numbers set': { kind: 'app' },
  // Writes over the stored client secret, and a wrong value stops sync.
  'settings sync set': { kind: 'app', destructive: true },
  'settings sync show': { kind: 'app' },
  'settings validation set': { kind: 'app' },
  'settings validation show': { kind: 'app' },

  'sync amend': { kind: 'app' },
  'sync divergence clear': { kind: 'app', destructive: true },
  'sync divergence list': { kind: 'app' },
  'sync divergence show': { kind: 'app' },
  'sync enroll': { kind: 'app' },
  // Without --out it writes a bundle in the working folder, which the app removes.
  'sync export': {
    kind: 'app', paths: [outFile('--out')],
    refuse: (_args, opts) => (hasOut(opts) ? null : 'Through the app, sync export needs --out <file>.'),
  },
  'sync import': { kind: 'app', paths: [inFile('file')] },
  'sync list': { kind: 'app' },
  // Re-points the duplicate's history at the survivor. There is no unmerge.
  'sync merge-patient': { kind: 'app', destructive: true },
  'sync now': { kind: 'app' },
  'sync quarantine list': { kind: 'app' },
  'sync quarantine retry': { kind: 'app' },
  'sync revoke': { kind: 'app', destructive: true },
  // The old secret stops working.
  'sync rotate': { kind: 'app', destructive: true },
  'sync status': { kind: 'app' },

  'terminology distribution import': { kind: 'app', paths: [inFile('--file')] },
  'terminology distribution purge': { kind: 'app', destructive: true },
  'terminology expand': { kind: 'app' },
  'terminology import': { kind: 'app', paths: [{ target: 'path', kind: terminologyImportPath }] },
  'terminology lookup': { kind: 'app' },
  // The folder is recorded as the distribution's source and read again by `rebuild`, so the server
  // keeps it. Building again replaces the system's index.
  'terminology ontology build': { kind: 'app', destructive: true, paths: [{ target: 'dir', kind: 'input-dir', keep: true }] },
  'terminology ontology list': { kind: 'app' },
  'terminology ontology rebuild': { kind: 'app' },
  'terminology ontology unlink': { kind: 'app', destructive: true },
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
  // --apply writes over catalog rows.
  'test-catalog import': { kind: 'app', destructive: true, paths: [inFile('file'), inFile('--column-map'), inFile('--value-map')] },
  'test-catalog list': { kind: 'app' },
  'test-catalog map clear': { kind: 'app', destructive: true },
  'test-catalog map export': { kind: 'app', paths: [outFile('--out')] },
  'test-catalog map import': { kind: 'app', destructive: true, paths: [inFile('file')] },
  'test-catalog map list': { kind: 'app' },
  'test-catalog map match': { kind: 'app', destructive: true },
  'test-catalog map rebuild': { kind: 'app' },
  // Replaces a code's mapping.
  'test-catalog map set': { kind: 'app', destructive: true },
  // --set replaces the test's result parameters.
  'test-catalog params': { kind: 'app', destructive: true, paths: [inFile('--set')] },
  'test-catalog restore': { kind: 'app' },
  'test-catalog result-fields export': { kind: 'app', paths: [outFile('--out')] },
  'test-catalog result-fields import': { kind: 'app', destructive: true, paths: [inFile('file')] },
  // Replaces a field's LOINC link.
  'test-catalog result-fields link': { kind: 'app', destructive: true },
  'test-catalog result-fields list': { kind: 'app' },
  'test-catalog result-fields unlink': { kind: 'app', destructive: true },
  'test-catalog retire': { kind: 'app' },

  // Builds an app context (packages/cli/src/update.ts), so it is not local.
  'update check': { kind: 'app' },

  'user activate': { kind: 'app' },
  'user assign-role': { kind: 'app' },
  'user create': { kind: 'app' },
  'user deactivate': { kind: 'app', destructive: true },
  'user directory-list': { kind: 'app' },
  'user end-sessions': { kind: 'app', destructive: true },
  'user key create': { kind: 'app' },
  'user key list': { kind: 'app' },
  'user key revoke': { kind: 'app', destructive: true },
  'user list': { kind: 'app' },
  'user preferences set': { kind: 'app' },
  'user preferences show': { kind: 'app' },
  // Replaces the user's roles, which can take access away.
  'user set-role': { kind: 'app', destructive: true },
  'user show': { kind: 'app' },
  'user unassign-role': { kind: 'app', destructive: true },
  'users list': { kind: 'app' },

  'workflows receipts list': { kind: 'app' },
  'workflows receipts show': { kind: 'app' },
});
