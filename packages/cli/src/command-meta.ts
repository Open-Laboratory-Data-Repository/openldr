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
// off access (revoke, end sessions, deactivate, reset). Every app or recovery command with --force
// is destructive. It is about data stored in OpenLDR, not about files on the caller's own disk, so
// no local command is destructive. When unsure, true.
//
// capability: the one key an account must hold to run an app command. The server refuses the
// command without it. Each is the key of the route that does the same thing, cited beside the group
// as a file in apps/server/src and a line. A command that can read or write by option takes the
// write key, because the check runs before the options matter. Where no route does the same thing,
// the comment says why the key was chosen. Recovery and local commands have none.
//
// alsoRequires: further keys the account must hold, where one key is not enough (see CommandMeta).

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
 * On an input mark, an empty string as its value means "no path": for example
 * `settings lab set --logo-file ''` clears the logo. The client sends an empty value as is and
 * uploads nothing. An empty value on an output mark names no folder or file, so a command that
 * needs one refuses it (see `artifact publish`).
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
  /** Keys the account must hold besides `capability`. The server requires all of them before it
   *  starts the command (Ruling 51). Set only where the command needs two keys and neither implies
   *  the other: its route needs both, or it does what two routes with different keys do. */
  readonly alsoRequires?: readonly string[];
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
    if (meta.alsoRequires) Object.freeze(meta.alsoRequires);
    table[path] = Object.freeze(meta);
  }
  return Object.freeze(table);
}

/** Keyed by the command's path, words joined by one space: 'roles list', 'user key create'. */
export const COMMAND_META: Readonly<Record<string, CommandMeta>> = freezeTable({
  // Local: no database, no server, no context builder. Each writes only the caller's own files.
  'artifact build': { kind: 'local', paths: [inDir('dir')] },
  // --force writes over a key file in --out.
  'artifact keygen': { kind: 'local', paths: [outDir('--out')] },
  // Writes the scaffold over any file of the same name.
  'artifact new': { kind: 'local', paths: [outDir('--out')] },
  'artifact pack': { kind: 'local', paths: [inDir('dir'), inFile('--key'), outDir('--out')] },
  // Packs in place, writing over the project's own manifest.json.
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
  // Without --install it only copies the bundle into --to on the caller's machine. With --install
  // the whole command goes through the app, and --to comes back as an output folder. With --approve
  // it grants the plugin's capabilities, as market install does: marketplace-routes.ts:193.
  'artifact publish': {
    kind: 'app', capability: 'marketplace.manage', destructive: true, paths: [inDir('bundleDir'), outDir('--to')],
    localWhen: (_args, opts) => !opts.install,
    refuse: (_args, opts) => (opts.install && opts.to === '' ? 'artifact publish needs a folder for --to.' : null),
  },

  // audit-routes.ts:8 (GET /api/audit, :11).
  'audit list': { kind: 'app', capability: 'audit.view' },

  // connectors-routes.ts: every route needs connectors.manage, reads included. The area has no view key.
  'connectors add': { kind: 'app', capability: 'connectors.manage', paths: [inFile('--file')] }, // :105
  'connectors diagnose': { kind: 'app', capability: 'connectors.manage' }, // :191
  'connectors inspect': { kind: 'app', capability: 'connectors.manage' }, // :85, GET /api/connectors/:id/config
  'connectors list': { kind: 'app', capability: 'connectors.manage' }, // :83
  'connectors remove': { kind: 'app', capability: 'connectors.manage', destructive: true }, // :177
  'connectors test': { kind: 'app', capability: 'connectors.manage' }, // :255
  'connectors update': { kind: 'app', capability: 'connectors.manage', destructive: true, paths: [inFile('--file')] }, // :147

  // dashboards-routes.ts:18: GET and PUT /api/dashboards/column-policy (:143, :162) both need data_exposure.manage.
  'data-exposure hide': { kind: 'app', capability: 'data_exposure.manage' },
  'data-exposure list': { kind: 'app', capability: 'data_exposure.manage' },
  'data-exposure show': { kind: 'app', capability: 'data_exposure.manage' },

  // No route rebuilds the read model. It rewrites every projected warehouse row, a destructive
  // maintenance action, so it takes the danger zone's key (settings-routes.ts:32, :507).
  'db reproject': { kind: 'app', capability: 'settings.danger_zone', destructive: true },

  // No route exports the whole dataset, patient details included. data.export is new, and only
  // lab_admin holds it.
  'export': { kind: 'app', capability: 'data.export', paths: [outDir('--out')] },

  // facilities-routes.ts:41 (view) and :42 (manage). IMPORT (:61) and UPLOAD (:149) are manage.
  // Adds to a register's own facility-type list. The route (:2077-2078) needs facilities.manage AND
  // terminology.manage.
  'facilities add-type': { kind: 'app', capability: 'terminology.manage', alsoRequires: ['facilities.manage'] },
  'facilities conflicts': { kind: 'app', capability: 'facilities.manage' }, // :1144
  'facilities delete': { kind: 'app', capability: 'facilities.manage', destructive: true }, // :1769
  // --apply can retire rows the register declares removed or leaves out.
  'facilities import': { kind: 'app', capability: 'facilities.manage', destructive: true, paths: [inFile('path'), inFile('--column-map'), inFile('--value-map')] }, // :2118, :2035
  'facilities import-run': { kind: 'app', capability: 'facilities.view' }, // :3068
  'facilities import-run-cancel': { kind: 'app', capability: 'facilities.manage', destructive: true }, // :3039
  'facilities import-run-revalidate': { kind: 'app', capability: 'facilities.manage', paths: [inFile('--column-map')] }, // :3013
  'facilities import-runs': { kind: 'app', capability: 'facilities.view' }, // :2790
  'facilities import-sources': { kind: 'app', capability: 'facilities.view' }, // :1926
  // Always reads the health (:1160, view); --retry is :1195 (manage).
  'facilities jobs': { kind: 'app', capability: 'facilities.manage', alsoRequires: ['facilities.view'] },
  'facilities link-matching': { kind: 'app', capability: 'facilities.manage' }, // :1088
  'facilities list': { kind: 'app', capability: 'facilities.view' }, // :907
  'facilities publish': { kind: 'app', capability: 'facilities.manage' }, // :1063
  'facilities register-source': { kind: 'app', capability: 'facilities.manage' }, // :1935
  'facilities scan-observed': { kind: 'app', capability: 'facilities.manage' }, // :1026
  'facilities suggest-values': { kind: 'app', capability: 'facilities.manage', paths: [inFile('path'), inFile('--column-map')] }, // :1982

  // forms-routes.ts:171 (view) and :173 (edit). No route lints; lint reads forms as GET /api/forms/:id does (:212).
  'forms lint': { kind: 'app', capability: 'forms.view' },
  'forms list': { kind: 'app', capability: 'forms.view' }, // :185
  'forms restore': { kind: 'app', capability: 'forms.edit', destructive: true }, // :331
  'forms versions': { kind: 'app', capability: 'forms.view' }, // :301

  // Import from a database connector. allow, revoke and allowed are connectors-routes.ts:228 and
  // :235 (connectors.manage). The rest have no route: Studio runs them through the plugin broker,
  // which lets only lab_admin call any import op, "like the connector routes" (plugin-broker.ts:170).
  'import allow': { kind: 'app', capability: 'connectors.manage' },
  'import allowed': { kind: 'app', capability: 'connectors.manage' },
  'import failures': { kind: 'app', capability: 'connectors.manage' },
  'import resume': { kind: 'app', capability: 'connectors.manage' },
  'import revoke': { kind: 'app', capability: 'connectors.manage', destructive: true },
  'import start': { kind: 'app', capability: 'connectors.manage' },
  'import status': { kind: 'app', capability: 'connectors.manage' },
  'import stop': { kind: 'app', capability: 'connectors.manage' },

  // No route sends a file through the pipeline with any converter. It writes clinical records.
  // ingest.run is new, and only lab_admin holds it.
  'ingest': { kind: 'app', capability: 'ingest.run', paths: [inFile('file'), inFile('--config')] },

  // layout-routes.ts:11. Any signed-in user may read the list (:35), so it takes the settings view key.
  'layouts delete': { kind: 'app', capability: 'settings.edit_general', destructive: true }, // :61
  'layouts list': { kind: 'app', capability: 'settings.view' },
  // Replaces the layout with this name.
  'layouts set': { kind: 'app', capability: 'settings.edit_general', destructive: true }, // :40, :50

  // marketplace-routes.ts:19 (view) and :20 (manage).
  'market disable': { kind: 'app', capability: 'marketplace.manage' }, // :358
  'market enable': { kind: 'app', capability: 'marketplace.manage' }, // :353
  'market install': { kind: 'app', capability: 'marketplace.manage', destructive: true, paths: [inDir('dir')] }, // :193
  'market list': { kind: 'app', capability: 'marketplace.view' }, // :66
  'market remove': { kind: 'app', capability: 'marketplace.manage', destructive: true }, // :420
  'market rollback': { kind: 'app', capability: 'marketplace.manage', destructive: true }, // :396
  'market sites': { kind: 'app', capability: 'marketplace.manage' }, // :374 reads, :383 switches
  'market update': { kind: 'app', capability: 'marketplace.manage', destructive: true, paths: [inDir('dir')] }, // :193

  // patient-routes.ts:11-13. The routes unmask only for patients.view_identifiers (:15). The CLI
  // unmasks on --identifiers, and the server checks the key before the options are known to matter,
  // so list, show and duplicates list take the key their strongest option needs (Ruling 52). This
  // fails closed: a plain, masked call needs more than its route does. They also need patients.view,
  // which the route itself requires (:11).
  'patients duplicates dismiss': { kind: 'app', capability: 'patients.manage', destructive: true }, // :55
  'patients duplicates export': { kind: 'app', capability: 'patients.view_identifiers', paths: [outFile('--out')] }, // :47
  'patients duplicates list': { kind: 'app', capability: 'patients.view_identifiers', alsoRequires: ['patients.view'] }, // :37
  'patients duplicates restore': { kind: 'app', capability: 'patients.manage' }, // :55
  'patients identifier-systems list': { kind: 'app', capability: 'patients.view' }, // :77
  'patients identifier-systems set': { kind: 'app', capability: 'patients.manage' }, // :84
  'patients list': { kind: 'app', capability: 'patients.view_identifiers', alsoRequires: ['patients.view'] }, // :26
  'patients show': { kind: 'app', capability: 'patients.view_identifiers', alsoRequires: ['patients.view'] }, // :97

  // The pipeline's batches and queue. Reading them is what the activity feed shows
  // (activity-routes.ts:6, :9, :16). retry writes clinical records again, so it takes ingest.run.
  'pipeline logs': { kind: 'app', capability: 'activity.view' },
  'pipeline retry': { kind: 'app', capability: 'ingest.run' },
  'pipeline status': { kind: 'app', capability: 'activity.view' },

  // Installing an id and version that exist writes over the stored row (packages/plugins/src/store.ts).
  // install and remove do what marketplace-routes.ts:193 and :420 do; list is :66. run and test have
  // no route: they run installed plugin code, so they take the manage key only lab_admin holds.
  'plugin install': {
    kind: 'app', capability: 'marketplace.manage', destructive: true,
    paths: [
      { target: 'wasm', kind: 'input-file', companions: pluginWasmCompanions },
      { target: '--manifest', kind: 'input-file', companions: pluginManifestCompanions },
    ],
  },
  'plugin list': { kind: 'app', capability: 'marketplace.view' },
  'plugin remove': { kind: 'app', capability: 'marketplace.manage', destructive: true },
  'plugin run': { kind: 'app', capability: 'marketplace.manage', paths: [inFile('input')] },
  'plugin test': { kind: 'app', capability: 'marketplace.manage' },

  // No route. It lists FHIR resources with no source, plugin or batch: a read-only oversight check.
  'provenance audit': { kind: 'app', capability: 'audit.view' },

  // query-routes.ts:30: every custom-query route needs query.run, export (:148) and import (:162) included.
  'query export': { kind: 'app', capability: 'query.run', paths: [outFile('--out')] },
  'query import': { kind: 'app', capability: 'query.run', destructive: true, paths: [inFile('file')] },

  // Counts of the event queue, as the activity feed shows (activity-routes.ts:6).
  'queue status': { kind: 'app', capability: 'activity.view' },

  // reports-routes.ts:45-48. run prints JSON, CSV or PDF. CSV and PDF are reports.export (:54, :74),
  // JSON is reports.run (:197). Neither key implies the other, so run needs both.
  'report glass-export': { kind: 'app', capability: 'reports.export', paths: [outFile('--out')] }, // :65
  'report list': { kind: 'app', capability: 'reports.view' }, // :51
  // With --format pdf and no --out it writes <id>.pdf in the working folder, which the app removes.
  'report run': {
    kind: 'app', capability: 'reports.export', alsoRequires: ['reports.run'], paths: [outFile('--out')],
    refuse: (_args, opts) => (opts.format === 'pdf' && !hasOut(opts) ? 'Through the app, report run --format pdf needs --out <file>.' : null),
  },

  // report-defs-routes.ts:10-11.
  'report-def delete': { kind: 'app', capability: 'reports.edit_templates', destructive: true }, // :42
  'report-def list': { kind: 'app', capability: 'reports.view' }, // :13

  // report-designs-routes.ts:12-14.
  'report-design delete': { kind: 'app', capability: 'reports.edit_templates', destructive: true }, // :146
  'report-design list': { kind: 'app', capability: 'reports.view' }, // :16
  'report-design publish': { kind: 'app', capability: 'reports.edit_templates' }, // :105
  'report-design versions': { kind: 'app', capability: 'reports.view' }, // :114

  // roles-routes.ts:28 (view) and :29 (manage). grant and revoke change a role's set, as PUT
  // /api/roles/:id does (:71). doctor has no route; it only reads roles and their keys.
  'roles create': { kind: 'app', capability: 'roles.manage' }, // :44
  'roles delete': { kind: 'app', capability: 'roles.manage', destructive: true }, // :103
  'roles doctor': { kind: 'app', capability: 'roles.view' },
  // --caps replaces the whole set, which can take capabilities away.
  'roles edit': { kind: 'app', capability: 'roles.manage', destructive: true }, // :71
  'roles grant': { kind: 'app', capability: 'roles.manage' },
  'roles list': { kind: 'app', capability: 'roles.view' }, // :31
  'roles revoke': { kind: 'app', capability: 'roles.manage', destructive: true },
  'roles show': { kind: 'app', capability: 'roles.view' }, // :35

  // settings-routes.ts:30-34. Reads take the key their route reads with.
  'settings danger': { kind: 'app', capability: 'settings.danger_zone', destructive: true }, // :507
  'settings flags list': { kind: 'app', capability: 'settings.feature_flags' }, // :68
  'settings flags set': { kind: 'app', capability: 'settings.feature_flags' }, // :390
  // Writes over the stored logo and letterhead fields.
  'settings lab set': { kind: 'app', capability: 'settings.edit_general', destructive: true, paths: [inFile('--logo-file')] }, // :89
  'settings lab show': { kind: 'app', capability: 'reports.view' }, // :78
  'settings numbers list': { kind: 'app', capability: 'settings.edit_general' }, // :406
  'settings numbers set': { kind: 'app', capability: 'settings.edit_general' }, // :410
  // Writes over the stored client secret, and a wrong value stops sync.
  'settings sync set': { kind: 'app', capability: 'sync.manage', destructive: true }, // :111
  'settings sync show': { kind: 'app', capability: 'sync.manage' }, // :107
  'settings validation set': { kind: 'app', capability: 'settings.edit_general' }, // :434
  'settings validation show': { kind: 'app', capability: 'settings.edit_general' }, // :430

  // settings-routes.ts:33 (sync.view) and :34 (sync.manage). export and import have no route: they
  // move lab data in and out as signed bundles, so they take sync.manage, which only lab_admin holds.
  'sync amend': { kind: 'app', capability: 'sync.manage' }, // :236
  'sync divergence clear': { kind: 'app', capability: 'sync.manage', destructive: true }, // :209
  'sync divergence list': { kind: 'app', capability: 'sync.manage' }, // :181
  'sync divergence show': { kind: 'app', capability: 'sync.manage' }, // :187
  'sync enroll': { kind: 'app', capability: 'sync.manage' }, // :301
  // Without --out it writes a bundle in the working folder, which the app removes.
  'sync export': {
    kind: 'app', capability: 'sync.manage', paths: [outFile('--out')],
    refuse: (_args, opts) => (hasOut(opts) ? null : 'Through the app, sync export needs --out <file>.'),
  },
  // A pull bundle reconciles whole terminology systems, and a delete record empties one
  // (packages/bootstrap/src/sync-bundle.ts:280, :317).
  'sync import': { kind: 'app', capability: 'sync.manage', destructive: true, paths: [inFile('file')] },
  'sync list': { kind: 'app', capability: 'sync.manage' }, // :332
  // Re-points the duplicate's history at the survivor. There is no unmerge.
  'sync merge-patient': { kind: 'app', capability: 'sync.manage', destructive: true }, // :270
  'sync now': { kind: 'app', capability: 'sync.manage' }, // :137
  'sync quarantine list': { kind: 'app', capability: 'sync.view' }, // :155
  'sync quarantine retry': { kind: 'app', capability: 'sync.manage' }, // :158
  'sync revoke': { kind: 'app', capability: 'sync.manage', destructive: true }, // :378
  // The old secret stops working.
  'sync rotate': { kind: 'app', capability: 'sync.manage', destructive: true }, // :357
  'sync status': { kind: 'app', capability: 'sync.view' }, // :135

  // Writes: terminology-admin-routes.ts:14 and ontology-routes.ts:10 (terminology.manage). Reads:
  // terminology-routes.ts, terminology-admin-routes.ts and ontology-routes.ts let any signed-in user
  // read, so reads take the area's view key. reproject is db reproject under its old name.
  'terminology distribution import': { kind: 'app', capability: 'terminology.manage', paths: [inFile('--file')] }, // admin :458, :461
  'terminology distribution purge': { kind: 'app', capability: 'terminology.manage', destructive: true }, // admin :495
  'terminology expand': { kind: 'app', capability: 'terminology.view' }, // terminology-routes.ts:25
  'terminology import': { kind: 'app', capability: 'terminology.manage', paths: [{ target: 'path', kind: terminologyImportPath }] }, // admin :193, :432
  'terminology lookup': { kind: 'app', capability: 'terminology.view' }, // terminology-routes.ts:8
  // The folder is recorded as the distribution's source and read again by `rebuild`, so the server
  // keeps it. Building again replaces the system's index.
  'terminology ontology build': { kind: 'app', capability: 'terminology.manage', destructive: true, paths: [{ target: 'dir', kind: 'input-dir', keep: true }] }, // ontology :80
  'terminology ontology list': { kind: 'app', capability: 'terminology.view' }, // ontology :17
  'terminology ontology rebuild': { kind: 'app', capability: 'terminology.manage' }, // ontology :86
  'terminology ontology unlink': { kind: 'app', capability: 'terminology.manage', destructive: true }, // ontology :19
  'terminology publisher create': { kind: 'app', capability: 'terminology.manage' }, // admin :48
  'terminology publisher list': { kind: 'app', capability: 'terminology.view' }, // admin :47
  'terminology reproject': { kind: 'app', capability: 'settings.danger_zone', destructive: true },
  'terminology system create': { kind: 'app', capability: 'terminology.manage' }, // admin :85
  'terminology system list': { kind: 'app', capability: 'terminology.view' }, // admin :81
  'terminology term list': { kind: 'app', capability: 'terminology.view' }, // admin :155
  'terminology translate': { kind: 'app', capability: 'terminology.view' }, // terminology-routes.ts:37
  'terminology validate-code': { kind: 'app', capability: 'terminology.view' }, // terminology-routes.ts:16
  'terminology valueset list': { kind: 'app', capability: 'terminology.view' }, // admin :365

  // test-catalog-routes.ts:12-15, test-mapping-routes.ts:10-12 and result-fields-routes.ts:10-12:
  // reads are terminology.view, writes terminology.manage. A dry run by default with --apply to
  // write takes the write key.
  'test-catalog disable': { kind: 'app', capability: 'terminology.manage' }, // catalog :185
  'test-catalog enable': { kind: 'app', capability: 'terminology.manage' }, // catalog :185
  'test-catalog export': { kind: 'app', capability: 'terminology.view', paths: [outFile('--out')] }, // catalog :256
  // --apply writes over catalog rows.
  'test-catalog import': { kind: 'app', capability: 'terminology.manage', destructive: true, paths: [inFile('file'), inFile('--column-map'), inFile('--value-map')] }, // catalog :221, :233, :244
  'test-catalog list': { kind: 'app', capability: 'terminology.view' }, // catalog :132
  'test-catalog map clear': { kind: 'app', capability: 'terminology.manage', destructive: true }, // mapping :79
  'test-catalog map export': { kind: 'app', capability: 'terminology.view', paths: [outFile('--out')] }, // mapping :93
  'test-catalog map import': { kind: 'app', capability: 'terminology.manage', destructive: true, paths: [inFile('file')] }, // mapping :104, :115
  'test-catalog map list': { kind: 'app', capability: 'terminology.view' }, // mapping :49
  // Lists the matches (mapping :139, view) and with --apply writes them (mapping :147, manage).
  'test-catalog map match': { kind: 'app', capability: 'terminology.manage', alsoRequires: ['terminology.view'], destructive: true },
  'test-catalog map rebuild': { kind: 'app', capability: 'terminology.manage' }, // mapping :161
  // Replaces a code's mapping.
  'test-catalog map set': { kind: 'app', capability: 'terminology.manage', destructive: true }, // mapping :65
  // Lists a test's result parameters (catalog :132, view); --set replaces them (catalog :155, manage).
  'test-catalog params': { kind: 'app', capability: 'terminology.manage', alsoRequires: ['terminology.view'], destructive: true, paths: [inFile('--set')] },
  'test-catalog restore': { kind: 'app', capability: 'terminology.manage' }, // catalog :202
  'test-catalog result-fields export': { kind: 'app', capability: 'terminology.view', paths: [outFile('--out')] }, // fields :53
  'test-catalog result-fields import': { kind: 'app', capability: 'terminology.manage', destructive: true, paths: [inFile('file')] }, // fields :61, :69
  // Replaces a field's LOINC link.
  'test-catalog result-fields link': { kind: 'app', capability: 'terminology.manage', destructive: true }, // fields :27
  'test-catalog result-fields list': { kind: 'app', capability: 'terminology.view' }, // fields :21
  'test-catalog result-fields unlink': { kind: 'app', capability: 'terminology.manage', destructive: true }, // fields :41
  'test-catalog retire': { kind: 'app', capability: 'terminology.manage' }, // catalog :202

  // Builds an app context (packages/cli/src/update.ts), so it is not local. GET /api/update lets any
  // signed-in user read (settings-routes.ts:460), so it takes the settings view key.
  'update check': { kind: 'app', capability: 'settings.view' },

  // users-routes.ts, access-key-routes.ts:16 and roles-routes.ts:137. Changing a user's roles takes
  // roles.manage, as PUT /api/users/:id/roles does. create takes users.manage, as POST /api/users
  // does, roles in the body included (users-routes.ts:182).
  'user activate': { kind: 'app', capability: 'users.manage' }, // users :265
  'user assign-role': { kind: 'app', capability: 'roles.manage' }, // roles :137
  'user create': { kind: 'app', capability: 'users.manage' }, // users :182
  'user deactivate': { kind: 'app', capability: 'users.manage', destructive: true }, // users :265
  'user directory-list': { kind: 'app', capability: 'users.view' }, // users :134
  'user end-sessions': { kind: 'app', capability: 'users.force_logout', destructive: true }, // users :335
  'user key create': { kind: 'app', capability: 'users.manage' }, // keys :107
  'user key list': { kind: 'app', capability: 'users.manage' }, // keys :98
  'user key revoke': { kind: 'app', capability: 'users.manage', destructive: true }, // keys :148
  'user list': { kind: 'app', capability: 'users.view' }, // users :134
  // No route sets another user's preferences; editing an account is PUT /api/users/:id (users :219).
  'user preferences set': { kind: 'app', capability: 'users.manage' },
  'user preferences show': { kind: 'app', capability: 'users.view' }, // users :156
  // Replaces the user's roles, which can take access away.
  'user set-role': { kind: 'app', capability: 'roles.manage', destructive: true }, // roles :137
  'user show': { kind: 'app', capability: 'users.view' }, // users :156
  'user unassign-role': { kind: 'app', capability: 'roles.manage', destructive: true }, // roles :137
  'users list': { kind: 'app', capability: 'users.view' }, // users :134

  // workflows-routes.ts:144 (GET /api/workflows/:id/receipts :468 and /:requestId :479).
  'workflows receipts list': { kind: 'app', capability: 'workflows.view' },
  'workflows receipts show': { kind: 'app', capability: 'workflows.view' },
});
