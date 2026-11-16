import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { beginOp } from '@openldr/core';
import { readGrant, type Capability } from '@openldr/marketplace';
import type { PluginDataStore } from '@openldr/db';
import type { PluginPolicy } from './policy';
import { policyAllows } from './policy';
import { HOST_COLLECTION_PREFIX, type ImportActor, type ImportService } from './import-run';
import { LABORATORY_CODE, type CheckRun, type ImportCheckService } from './import-check';
import { CopySetChangedError, type CopyRun, type CopySetProgress, type ImportCopyService } from './import-copy';

/** The caller principal (the authenticated host user forwarding on the plugin's behalf). */
export interface BrokerPrincipal {
  id: string;
  roles: string[];
  /** Display name for the audit trail; falls back to id when absent. */
  username?: string;
}

/** A security-relevant broker event for the audit trail. `outcome:'denied'` is a blocked op
 *  (capability/role/policy/egress gate or a malformed op); `outcome:'ok'` is a completed
 *  SENSITIVE op (wasm invoke or a live egress op). High-frequency reads are not emitted. */
export interface BrokerAuditEvent {
  pluginId: string;
  principal: BrokerPrincipal;
  op: string;
  outcome: 'denied' | 'ok';
  reason?: string;
}

/** Operations a plugin UI may request. storage.* is private (namespaced by the trusted
 *  pluginId); invoke runs the plugin's own wasm; the rest are gated host ops. */
export type BrokerOp =
  | { kind: 'storage.get'; collection: string; key: string }
  | { kind: 'storage.put'; collection: string; key: string; doc: unknown }
  | { kind: 'storage.delete'; collection: string; key: string }
  | { kind: 'storage.list'; collection: string; where?: { field: string; eq: unknown }; limit?: number }
  | { kind: 'invoke'; entrypoint: string; input: unknown }
  | { kind: 'reports.list' }
  | { kind: 'reports.columns'; id: string }
  | { kind: 'reports.run'; id: string; params?: Record<string, unknown> }
  | { kind: 'reports.eventSources' }
  | { kind: 'connectors.list' }
  | { kind: 'connectors.test'; id: string }
  | { kind: 'connectors.metadata'; id: string }
  | { kind: 'connectors.push'; connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }
  | { kind: 'connectors.validate'; connectorId: string; mapping: unknown }
  | { kind: 'fhir.facilities' }
  | { kind: 'schedule.register'; schedule: unknown }
  | { kind: 'schedule.list' }
  | { kind: 'schedule.remove'; id: string }
  // Imports (host:import). The page names a connector and options only. SQL never comes from
  // the page: the import service asks the plugin's signed wasm for it.
  | { kind: 'import.allowed' }
  | { kind: 'import.diagnose'; connectorId: string }
  | { kind: 'import.checks'; connectorId: string; options: Record<string, string> }
  | { kind: 'import.start'; connectorId: string; options: Record<string, string>; pageSize?: number; limit?: number; dryRun?: boolean }
  | { kind: 'import.status'; runId: string }
  | { kind: 'import.list' }
  | { kind: 'import.failures'; runId: string }
  | { kind: 'import.stop'; runId: string }
  | { kind: 'import.resume'; runId: string }
  // Copies (host:import too). The page names a connector and options; the plugin's wasm names the sets.
  | { kind: 'import.copy.start'; connectorId: string; options: Record<string, string>; pageSize?: number; reread?: boolean }
  | { kind: 'import.copy.list' }
  | { kind: 'import.copy.status'; copyId: string }
  | { kind: 'import.copy.stop'; copyId: string }
  | { kind: 'import.copy.delete'; copyId: string; confirm: true }
  // Check runs over a finished copy (host:import too). The page names a copy and options.
  | { kind: 'import.check.start'; copyId: string; referenceCopyId: string | null; options: Record<string, string>; pageSize?: number }
  | { kind: 'import.check.list' }
  | { kind: 'import.check.status'; runId: string }
  | { kind: 'import.check.stop'; runId: string }
  | { kind: 'import.check.held'; copyId: string; reason?: 'held' | 'error'; label?: string; laboratory?: string; offset: number; limit: number }
  | { kind: 'import.check.heldItem'; copyId: string; key: string }
  | { kind: 'import.check.heldItems'; copyId: string; reason?: 'held' | 'error'; label?: string; laboratory?: string; offset: number; limit: number };

/** A copy as a plugin page sees it: no set's `cursor`, which is a source key, and no `driver`,
 *  which names a server process. */
export type PageCopyRun = Omit<CopyRun, 'driver' | 'sets'> & { sets: Record<string, Omit<CopySetProgress, 'cursor'>> };

/** The one place a copy is cut down for a plugin page. Every copy op's answer goes through it. */
export function copyForPage(run: CopyRun): PageCopyRun {
  const { driver: _driver, sets, ...rest } = run;
  const shown: PageCopyRun['sets'] = {};
  for (const [name, { cursor: _cursor, ...progress }] of Object.entries(sets)) shown[name] = progress;
  return { ...rest, sets: shown };
}

/** A check run as a plugin page sees it: no `cursor`, which is a source key, no `driver`, which
 *  names a server process, and none of the record's own bookkeeping. */
export type PageCheckRun = Omit<CheckRun, 'driver' | 'rev' | 'kind' | 'pluginId' | 'pluginVersion' | 'cursor' | 'startedBy'>;

/** The one place a check run is cut down for a plugin page. Every check op's answer goes through it.
 *  A run where no request named a laboratory has only the null entry: the page gets an empty list,
 *  so it draws no picker. Once one code is named, every entry goes, the null one included. */
export function checkForPage(run: CheckRun): PageCheckRun {
  const { driver: _driver, rev: _rev, kind: _kind, pluginId: _pluginId, pluginVersion: _pluginVersion, cursor: _cursor, startedBy: _startedBy, laboratories, ...rest } = run;
  if (laboratories === undefined) return rest;
  return { ...rest, laboratories: laboratories.some((l) => l.code !== null) ? laboratories : [] };
}

export type BrokerResult = { ok: true; data: unknown } | { ok: false; error: string };

/** Default cap on the JSON byte size of a persisted/forwarded plugin document. Generous —
 *  the dhis2-sink metadataCache:latest doc holds a full DHIS2 metadata snapshot (1000+ data
 *  elements, a few MB). Overridable via PLUGIN_DATA_MAX_DOC_BYTES. */
export const DEFAULT_MAX_DOC_BYTES = 8 * 1024 * 1024;

const STR = z.string().min(1).max(256);
const ID = z.string().min(1).max(256);
// The import service checks option names and sizes again; this only bounds the wire shape.
const IMPORT_OPTIONS = z.record(z.string().max(64), z.string().max(1000));
/** A laboratory filter of the held list: the same rule as a code a group names. */
const LABORATORY = z.string().regex(LABORATORY_CODE);

/** Build the discriminated-union op schema. `maxDocBytes` bounds any persisted/forwarded
 *  arbitrary-object payload (doc/mapping/schedule/input) by its serialized byte size. */
export function buildBrokerOpSchema(maxDocBytes: number) {
  const docBound = (label: string) =>
    z.unknown().superRefine((v, ctx) => {
      let bytes = 0;
      try {
        bytes = Buffer.byteLength(JSON.stringify(v ?? null));
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not serializable` });
        return;
      }
      if (bytes > maxDocBytes) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} exceeds ${maxDocBytes} bytes (${bytes})` });
      }
    });

  return z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('storage.get'), collection: STR, key: STR }),
    z.object({ kind: z.literal('storage.put'), collection: STR, key: STR, doc: docBound('doc') }),
    z.object({ kind: z.literal('storage.delete'), collection: STR, key: STR }),
    z.object({ kind: z.literal('storage.list'), collection: STR, where: z.object({ field: STR, eq: z.unknown() }).optional(), limit: z.number().int().min(1).max(1000).optional() }),
    z.object({ kind: z.literal('invoke'), entrypoint: STR, input: docBound('input') }),
    z.object({ kind: z.literal('reports.list') }),
    z.object({ kind: z.literal('reports.columns'), id: ID }),
    z.object({ kind: z.literal('reports.run'), id: ID, params: docBound('params').optional() }),
    z.object({ kind: z.literal('reports.eventSources') }),
    z.object({ kind: z.literal('connectors.list') }),
    z.object({ kind: z.literal('connectors.test'), id: ID }),
    z.object({ kind: z.literal('connectors.metadata'), id: ID }),
    z.object({ kind: z.literal('connectors.push'), connectorId: ID, mapping: docBound('mapping'), orgUnitMap: z.record(z.string().max(256)).optional(), period: STR, dryRun: z.boolean() }),
    z.object({ kind: z.literal('connectors.validate'), connectorId: ID, mapping: docBound('mapping') }),
    z.object({ kind: z.literal('fhir.facilities') }),
    z.object({ kind: z.literal('schedule.register'), schedule: docBound('schedule') }),
    z.object({ kind: z.literal('schedule.list') }),
    z.object({ kind: z.literal('schedule.remove'), id: ID }),
    z.object({ kind: z.literal('import.allowed') }),
    z.object({ kind: z.literal('import.diagnose'), connectorId: ID }),
    z.object({ kind: z.literal('import.checks'), connectorId: ID, options: IMPORT_OPTIONS }),
    z.object({
      kind: z.literal('import.start'), connectorId: ID, options: IMPORT_OPTIONS,
      pageSize: z.number().int().positive().optional(), limit: z.number().int().positive().optional(), dryRun: z.boolean().optional(),
    }),
    z.object({ kind: z.literal('import.status'), runId: ID }),
    z.object({ kind: z.literal('import.list') }),
    z.object({ kind: z.literal('import.failures'), runId: ID }),
    z.object({ kind: z.literal('import.stop'), runId: ID }),
    z.object({ kind: z.literal('import.resume'), runId: ID }),
    z.object({
      kind: z.literal('import.copy.start'), connectorId: ID, options: IMPORT_OPTIONS,
      pageSize: z.number().int().positive().optional(), reread: z.boolean().optional(),
    }),
    z.object({ kind: z.literal('import.copy.list') }),
    z.object({ kind: z.literal('import.copy.status'), copyId: ID }),
    z.object({ kind: z.literal('import.copy.stop'), copyId: ID }),
    // Deleting a copy throws away every row it holds, so the page must say so in the op itself.
    z.object({ kind: z.literal('import.copy.delete'), copyId: ID, confirm: z.literal(true) }),
    z.object({
      kind: z.literal('import.check.start'), copyId: ID, referenceCopyId: ID.nullable(), options: IMPORT_OPTIONS,
      pageSize: z.number().int().positive().optional(),
    }),
    z.object({ kind: z.literal('import.check.list') }),
    z.object({ kind: z.literal('import.check.status'), runId: ID }),
    z.object({ kind: z.literal('import.check.stop'), runId: ID }),
    z.object({
      kind: z.literal('import.check.held'), copyId: ID, reason: z.enum(['held', 'error']).optional(), label: z.string().min(1).max(64).optional(),
      laboratory: LABORATORY.optional(), offset: z.number().int().min(0), limit: z.number().int().min(1).max(100),
    }),
    z.object({ kind: z.literal('import.check.heldItem'), copyId: ID, key: z.string().min(1).max(200) }),
    // Each item carries its findings and check, so a page reads a batch of up to 200 in one call.
    z.object({
      kind: z.literal('import.check.heldItems'), copyId: ID, reason: z.enum(['held', 'error']).optional(), label: z.string().min(1).max(64).optional(),
      laboratory: LABORATORY.optional(), offset: z.number().int().min(0), limit: z.number().int().min(1).max(200),
    }),
  ]);
}

/** Maps an op to the capability it requires (undefined = private/no capability). */
function gateFor(op: BrokerOp): string | undefined {
  switch (op.kind) {
    case 'reports.list': case 'reports.columns': case 'reports.run': case 'reports.eventSources': return 'host:reports';
    case 'connectors.list': case 'connectors.test': case 'connectors.metadata': case 'connectors.push': case 'connectors.validate': return 'host:connectors';
    case 'fhir.facilities': return 'host:fhir';
    case 'schedule.register': case 'schedule.list': case 'schedule.remove': return 'host:schedule';
    case 'import.allowed': case 'import.diagnose': case 'import.checks': case 'import.start': case 'import.status':
    case 'import.list': case 'import.failures': case 'import.stop': case 'import.resume':
    case 'import.copy.start': case 'import.copy.list': case 'import.copy.status': case 'import.copy.stop': case 'import.copy.delete':
    case 'import.check.start': case 'import.check.list': case 'import.check.status': case 'import.check.stop': case 'import.check.held': case 'import.check.heldItem':
    case 'import.check.heldItems':
      return 'host:import';
    default: return undefined; // storage.*, invoke
  }
}

/** Does this op make a LIVE outbound network request when dispatched? These ops gate to the
 *  `host:connectors` capability (NOT `net-egress`), so `policyAllows` does not cover them — the
 *  egress kill-switch (PLUGIN_EGRESS_ENABLED=false) is enforced for them at the OP level in
 *  `handle`. Each resolves a connector → decrypts its config → contacts the configured host:
 *   - connectors.test      live health_check + pull_metadata
 *   - connectors.metadata  live pull_metadata
 *   - connectors.push      live push to the target
 *   - connectors.validate  live pull_metadata to validate the mapping against
 *  connectors.list is DB-only (no egress) and is intentionally excluded. */
function egresses(op: BrokerOp): boolean {
  switch (op.kind) {
    case 'connectors.test':
    case 'connectors.metadata':
    case 'connectors.push':
    case 'connectors.validate':
      return true;
    default:
      return false;
  }
}

/** Required caller-role set for an op (empty = no role requirement). The capability is the
 *  plugin's ceiling; the CALLER's role is a separate axis, matching the native routes. */
function rolesFor(op: BrokerOp): string[] {
  switch (op.kind) {
    // Mirrors the native /api/connectors routes (lab_admin only).
    case 'connectors.list': case 'connectors.test': case 'connectors.metadata':
    case 'connectors.push': case 'connectors.validate':
    // Schedule register/list/remove mirror the native lab_admin-gated schedule routes.
    case 'schedule.register': case 'schedule.list': case 'schedule.remove':
    // Imports read a database connector and write records: admin only, like the connector routes.
    case 'import.allowed': case 'import.diagnose': case 'import.checks': case 'import.start': case 'import.status':
    case 'import.list': case 'import.failures': case 'import.stop': case 'import.resume':
    // Copies read a database connector the same way, so the same rule holds.
    case 'import.copy.start': case 'import.copy.list': case 'import.copy.status': case 'import.copy.stop': case 'import.copy.delete':
    case 'import.check.start': case 'import.check.list': case 'import.check.status': case 'import.check.stop': case 'import.check.held': case 'import.check.heldItem':
    case 'import.check.heldItems':
      return ['lab_admin'];
    // storage.*, invoke, reports.*, fhir.* — reports/fhir reads are broadly readable (native routes have no role gate).
    default: return [];
  }
}

export interface PluginBrokerDeps {
  plugins: {
    list(): Promise<Array<{ id: string; version: string; enabled: boolean; manifest: Record<string, unknown> }>>;
    loadSink(id: string, version?: string): Promise<{ invoke(entrypoint: string, input: unknown, opts?: unknown): Promise<unknown> } | undefined>;
  };
  pluginData: PluginDataStore;
  // `list` resolves the FULL report list across all sources (data-driven + templates) via the
  // async ReportingApi.listAll — NOT the catalog-only sync ReportingApi.list, which returns [] now
  // that the catalog is retired (Slice S6). The plugin-ui-sdk already awaits this RPC.
  reporting: { list(): Promise<unknown>; columns(id: string): Promise<unknown>; run(id: string, params: unknown): Promise<unknown>; eventSources(): unknown };
  connectors: { list(): Promise<unknown[]>; get(id: string): Promise<unknown | null> };
  /** Test a connector live (resolve→loadSink→health/metadata). Optional here; wired in app
   *  context. When absent, connectors.test returns a structured error. */
  testConnector?: (id: string) => Promise<unknown>;
  /** Pull live metadata for a connector (resolve→loadSink→pull_metadata). */
  connectorMetadata?: (id: string) => Promise<unknown>;
  /** Run a DHIS2 push for a caller-supplied mapping/orgUnitMap through a connector's sink. */
  connectorPush?: (input: { connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }) => Promise<unknown>;
  /** Validate a caller-supplied mapping against a connector's live metadata → string[]. */
  connectorValidate?: (input: { connectorId: string; mapping: unknown }) => Promise<unknown>;
  /** List FHIR Location facilities ({ id, name }[]) for the org-unit mapping screen. */
  facilities?: () => Promise<unknown>;
  /** Plugin-scoped schedule registry (wired in Task 4; undefined until then). */
  schedules?: { register(pluginId: string, schedule: unknown): Promise<unknown>; list(pluginId: string): Promise<unknown>; remove(pluginId: string, id: string): Promise<unknown> };
  /** The import service (import-run.ts). When absent, import ops return a structured error. */
  imports?: Pick<ImportService, 'allowed' | 'checks' | 'start' | 'get' | 'list' | 'failures' | 'stop' | 'resume'>;
  /** The copy service (import-copy.ts). When absent, copy ops return a structured error. */
  copies?: Pick<ImportCopyService, 'start' | 'get' | 'list' | 'stop' | 'remove'>;
  /** The check service (import-check.ts). When absent, check ops return a structured error. */
  checks?: Pick<ImportCheckService, 'start' | 'get' | 'list' | 'stop' | 'held' | 'heldItem' | 'heldItems'>;
  /** Step-by-step check of a host connector (connector-diagnose.ts), by connector id. */
  diagnoseConnector?: (id: string) => Promise<unknown>;
  policy: () => PluginPolicy;
  /** Max serialized byte size of a persisted/forwarded plugin doc. Defaults to DEFAULT_MAX_DOC_BYTES. */
  maxDocBytes?: number;
  /** Optional: server-side sink for redacted host-op error detail (never sent to the plugin). */
  logger?: { warn(obj: unknown, msg: string): void };
  /** Optional: best-effort audit sink for security-relevant broker events (denials + sensitive
   *  ops). Wired to ctx.audit in the AppContext. Must never throw into the broker. */
  audit?: (event: BrokerAuditEvent) => Promise<void>;
}

export interface PluginBroker {
  handle(pluginId: string, principal: BrokerPrincipal, op: unknown): Promise<BrokerResult>;
}

export function createPluginBroker(deps: PluginBrokerDeps): PluginBroker {
  function hasCapability(caps: Capability[], gate: string): boolean {
    return caps.some((c) => c.kind === gate);
  }

  const brokerOpSchema = buildBrokerOpSchema(deps.maxDocBytes ?? DEFAULT_MAX_DOC_BYTES);

  // Best-effort audit — never throws into the broker (audit must not break or block-fail an op).
  async function emit(pluginId: string, principal: BrokerPrincipal, op: string, outcome: 'denied' | 'ok', reason?: string): Promise<void> {
    try {
      await deps.audit?.({ pluginId, principal, op, outcome, reason });
    } catch { /* swallow — auditing a security event must not break the op */ }
  }

  return {
    async handle(pluginId, principal, rawOp) {
      // Records the denial to the audit trail, then returns the structured error.
      const deny = async (op: string, reason: string): Promise<BrokerResult> => {
        await emit(pluginId, principal, op, 'denied', reason);
        return { ok: false, error: reason };
      };
      // Parse FIRST so a malformed op can't probe installed-plugin state or dispatch.
      const parsed = brokerOpSchema.safeParse(rawOp);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ').slice(0, 300);
        return deny('(unparsed)', `invalid operation: ${msg}`);
      }
      const op: BrokerOp = parsed.data as BrokerOp;
      try {
        // 1. Plugin must be installed + enabled.
        const rows = await deps.plugins.list();
        const row = rows.find((r) => r.id === pluginId && r.enabled);
        if (!row) return deny(op.kind, `plugin ${pluginId} is not installed or disabled`);

        // 1b. Plugin-level required-roles gate — applies to EVERY op (incl. storage.*/invoke),
        // independent of and in addition to the per-op rolesFor() gate below. This is the
        // authorization boundary the native DHIS2 routes had: a plugin declaring
        // ui.requiredRoles:['lab_admin'] is fully off-limits to callers lacking those roles.
        const requiredRoles = (row.manifest as { payload?: { ui?: { requiredRoles?: string[] } } }).payload?.ui?.requiredRoles;
        if (requiredRoles?.length && !requiredRoles.some((r) => principal.roles.includes(r))) {
          return deny(op.kind, `plugin ${pluginId} requires one of roles: ${requiredRoles.join(', ')}`);
        }

        // 2. Global policy (kill-switches) — checked on EVERY call.
        const gate = gateFor(op);
        if (!policyAllows(deps.policy(), gate)) {
          return deny(op.kind, `operation ${op.kind} is disabled by global policy`);
        }

        // 2b. Egress kill-switch — connector ops gate to host:connectors (not net-egress), so
        // policyAllows can't see them; enforce PLUGIN_EGRESS_ENABLED for them here, before
        // capability/role/dispatch, so a false kill-switch blocks every outbound connector op.
        if (egresses(op) && !deps.policy().egressEnabled) {
          return deny(op.kind, `operation ${op.kind} is disabled by the egress kill-switch`);
        }

        // 3. Capability grant. Legacy rows (no capabilities field) are grandfathered.
        if (gate) {
          const grant = readGrant(row.manifest);
          if (!grant.legacy && !hasCapability(grant.capabilities, gate)) {
            return deny(op.kind, `operation ${op.kind} requires the ${gate} capability, which plugin ${pluginId} was not granted`);
          }
        }

        // Role gate: capability is the plugin's ceiling; the CALLER's role is a separate axis.
        const need = rolesFor(op);
        if (need.length > 0 && !need.some((r) => principal.roles.includes(r))) {
          return deny(op.kind, `operation ${op.kind} requires one of roles: ${need.join(', ')}`);
        }

        // 3b. Collections starting with `__` belong to the host (import runs, failures and the
        // list of connectors an admin allowed). A plugin page must not read or forge them.
        if ((op.kind === 'storage.get' || op.kind === 'storage.put' || op.kind === 'storage.delete' || op.kind === 'storage.list')
          && op.collection.startsWith(HOST_COLLECTION_PREFIX)) {
          return deny(op.kind, `collection ${op.collection} is reserved for the host`);
        }

        // 4. Dispatch. Storage is namespaced by the trusted pluginId argument.
        // Stamp wasm-invoking / egress ops in the in-flight registry (pluginId + op kind +
        // entrypoint) so a process-FATAL plugin crash mid-dispatch leaves a culprit trail the
        // uncaughtException handler can snapshot. The wasm boundary (createWasmSink) stamps too;
        // this adds the broker's richer op-kind label. Cleared in `finally`.
        const stamp = op.kind === 'invoke' || egresses(op)
          ? beginOp({ pluginId, op: op.kind, entrypoint: op.kind === 'invoke' ? op.entrypoint : undefined })
          : undefined;
        try {
        switch (op.kind) {
          case 'storage.get': return { ok: true, data: await deps.pluginData.get(pluginId, op.collection, op.key) };
          case 'storage.put': await deps.pluginData.put(pluginId, op.collection, op.key, op.doc); return { ok: true, data: null };
          case 'storage.delete': await deps.pluginData.delete(pluginId, op.collection, op.key); return { ok: true, data: null };
          case 'storage.list': return { ok: true, data: await deps.pluginData.list(pluginId, op.collection, { where: op.where, limit: op.limit }) };
          case 'invoke': {
            const sink = await deps.plugins.loadSink(pluginId, row.version);
            if (!sink) return { ok: false, error: `plugin ${pluginId} exposes no invokable wasm` };
            const data = await sink.invoke(op.entrypoint, op.input);
            await emit(pluginId, principal, `invoke:${op.entrypoint}`, 'ok'); // wasm execution
            return { ok: true, data };
          }
          case 'reports.list': return { ok: true, data: await deps.reporting.list() };
          case 'reports.columns': return { ok: true, data: await deps.reporting.columns(op.id) };
          case 'reports.run': return { ok: true, data: await deps.reporting.run(op.id, op.params ?? {}) };
          case 'reports.eventSources': return { ok: true, data: deps.reporting.eventSources() };
          case 'connectors.list': return { ok: true, data: await deps.connectors.list() };
          case 'connectors.test': {
            if (!deps.testConnector) return { ok: false, error: 'connectors.test is unavailable' };
            const data = await deps.testConnector(op.id);
            await emit(pluginId, principal, `connectors.test:${op.id}`, 'ok'); // live egress
            return { ok: true, data };
          }
          case 'connectors.metadata': {
            if (!deps.connectorMetadata) return { ok: false, error: 'connectors.metadata unavailable' };
            const data = await deps.connectorMetadata(op.id);
            await emit(pluginId, principal, `connectors.metadata:${op.id}`, 'ok'); // live egress
            return { ok: true, data };
          }
          case 'connectors.push': {
            if (!deps.connectorPush) return { ok: false, error: 'connectors.push unavailable' };
            const data = await deps.connectorPush({ connectorId: op.connectorId, mapping: op.mapping, orgUnitMap: op.orgUnitMap, period: op.period, dryRun: op.dryRun });
            await emit(pluginId, principal, `connectors.push:${op.connectorId}`, 'ok', op.dryRun ? 'dry-run' : 'live'); // live egress
            return { ok: true, data };
          }
          case 'connectors.validate': {
            if (!deps.connectorValidate) return { ok: false, error: 'connectors.validate unavailable' };
            const data = await deps.connectorValidate({ connectorId: op.connectorId, mapping: op.mapping });
            await emit(pluginId, principal, `connectors.validate:${op.connectorId}`, 'ok'); // live egress
            return { ok: true, data };
          }
          case 'fhir.facilities': {
            if (!deps.facilities) return { ok: false, error: 'fhir.facilities unavailable' };
            return { ok: true, data: await deps.facilities() };
          }
          case 'schedule.register': {
            if (!deps.schedules) return { ok: false, error: 'schedule unavailable' };
            return { ok: true, data: await deps.schedules.register(pluginId, op.schedule) };
          }
          case 'schedule.list': {
            if (!deps.schedules) return { ok: false, error: 'schedule unavailable' };
            return { ok: true, data: await deps.schedules.list(pluginId) };
          }
          case 'schedule.remove': {
            if (!deps.schedules) return { ok: false, error: 'schedule unavailable' };
            return { ok: true, data: await deps.schedules.remove(pluginId, op.id) };
          }
          case 'import.allowed': case 'import.diagnose': case 'import.checks': case 'import.start': case 'import.status':
          case 'import.list': case 'import.failures': case 'import.stop': case 'import.resume': {
            const imports = deps.imports;
            if (!imports) return { ok: false, error: 'imports are unavailable' };
            const actor: ImportActor = { type: 'user', id: principal.id, name: principal.username ?? principal.id };
            switch (op.kind) {
              case 'import.allowed': {
                // Names for the page's connector picker. Only the connectors allowed for this plugin.
                const out: Array<{ id: string; name: string; type: string | null }> = [];
                for (const id of await imports.allowed(pluginId)) {
                  const c = (await deps.connectors.get(id)) as { name?: string; type?: string | null } | null;
                  if (c) out.push({ id, name: c.name ?? id, type: c.type ?? null });
                }
                return { ok: true, data: out };
              }
              case 'import.diagnose': {
                if (!deps.diagnoseConnector) return { ok: false, error: 'import.diagnose is unavailable' };
                // The result names the host and port, so it is only for a connector the admin allowed.
                if (!(await imports.allowed(pluginId)).includes(op.connectorId)) {
                  return deny(op.kind, `connector ${op.connectorId} is not allowed for plugin ${pluginId}`);
                }
                return { ok: true, data: await deps.diagnoseConnector(op.connectorId) };
              }
              case 'import.checks': return { ok: true, data: await imports.checks({ pluginId, connectorId: op.connectorId, options: op.options }) };
              case 'import.start': return { ok: true, data: await imports.start({
                pluginId, connectorId: op.connectorId, options: op.options,
                ...(op.pageSize !== undefined ? { pageSize: op.pageSize } : {}),
                ...(op.limit !== undefined ? { limit: op.limit } : {}),
                ...(op.dryRun !== undefined ? { dryRun: op.dryRun } : {}),
                actor,
              }) };
              case 'import.status': return { ok: true, data: await imports.get(pluginId, op.runId) };
              case 'import.list': return { ok: true, data: await imports.list(pluginId) };
              case 'import.failures': return { ok: true, data: await imports.failures(pluginId, op.runId) };
              case 'import.stop': return { ok: true, data: await imports.stop(pluginId, op.runId, actor) };
              case 'import.resume': return { ok: true, data: await imports.resume(pluginId, op.runId, actor) };
            }
            return { ok: false, error: 'unknown operation' };
          }
          case 'import.copy.start': case 'import.copy.list': case 'import.copy.status': case 'import.copy.stop': case 'import.copy.delete': {
            const copies = deps.copies;
            if (!copies) return { ok: false, error: 'copies are unavailable' };
            const actor: ImportActor = { type: 'user', id: principal.id, name: principal.username ?? principal.id };
            switch (op.kind) {
              case 'import.copy.start': {
                try {
                  const run = await copies.start({
                    pluginId, connectorId: op.connectorId, options: op.options,
                    ...(op.pageSize !== undefined ? { pageSize: op.pageSize } : {}),
                    ...(op.reread !== undefined ? { reread: op.reread } : {}),
                    actor,
                  });
                  return { ok: true, data: { run: copyForPage(run) } };
                } catch (err) {
                  // A changed set is a question for the person, not a failure: the page asks
                  // whether to read those sets again, then starts with reread.
                  if (err instanceof CopySetChangedError) return { ok: true, data: { changedSets: [...err.sets] } };
                  throw err;
                }
              }
              case 'import.copy.list': return { ok: true, data: (await copies.list(pluginId)).map(copyForPage) };
              case 'import.copy.status': {
                const run = await copies.get(pluginId, op.copyId);
                return { ok: true, data: run ? copyForPage(run) : null };
              }
              case 'import.copy.stop': return { ok: true, data: copyForPage(await copies.stop(pluginId, op.copyId, actor)) };
              case 'import.copy.delete': return { ok: true, data: copyForPage(await copies.remove(pluginId, op.copyId, actor)) };
            }
            return { ok: false, error: 'unknown operation' };
          }
          case 'import.check.start': case 'import.check.list': case 'import.check.status': case 'import.check.stop':
          case 'import.check.held': case 'import.check.heldItem': case 'import.check.heldItems': {
            const checks = deps.checks;
            if (!checks) return { ok: false, error: 'checks are unavailable' };
            const actor: ImportActor = { type: 'user', id: principal.id, name: principal.username ?? principal.id };
            switch (op.kind) {
              case 'import.check.start': return { ok: true, data: checkForPage(await checks.start({
                pluginId, copyId: op.copyId, referenceCopyId: op.referenceCopyId, options: op.options,
                ...(op.pageSize !== undefined ? { pageSize: op.pageSize } : {}),
                actor,
              })) };
              case 'import.check.list': return { ok: true, data: (await checks.list(pluginId)).map(checkForPage) };
              case 'import.check.status': {
                const run = await checks.get(pluginId, op.runId);
                return { ok: true, data: run ? checkForPage(run) : null };
              }
              case 'import.check.stop': return { ok: true, data: checkForPage(await checks.stop(pluginId, op.runId, actor)) };
              case 'import.check.held': {
                const data = await checks.held(pluginId, op.copyId, {
                  ...(op.reason !== undefined ? { reason: op.reason } : {}),
                  ...(op.label !== undefined ? { label: op.label } : {}),
                  ...(op.laboratory !== undefined ? { laboratory: op.laboratory } : {}),
                  offset: op.offset, limit: op.limit,
                });
                // These rows hold real values. The audit row names the operation and the copy, nothing else.
                await emit(pluginId, principal, `import.check.held:${op.copyId}`, 'ok');
                return { ok: true, data };
              }
              case 'import.check.heldItem': {
                const data = await checks.heldItem(pluginId, op.copyId, op.key);
                await emit(pluginId, principal, `import.check.heldItem:${op.copyId}`, 'ok');
                return { ok: true, data };
              }
              case 'import.check.heldItems': {
                const data = await checks.heldItems(pluginId, op.copyId, {
                  ...(op.reason !== undefined ? { reason: op.reason } : {}),
                  ...(op.label !== undefined ? { label: op.label } : {}),
                  ...(op.laboratory !== undefined ? { laboratory: op.laboratory } : {}),
                  offset: op.offset, limit: op.limit,
                });
                // As for heldItem: the operation and the copy, never a key, a value or the size.
                await emit(pluginId, principal, `import.check.heldItems:${op.copyId}`, 'ok');
                return { ok: true, data };
              }
            }
            return { ok: false, error: 'unknown operation' };
          }
          default: return { ok: false, error: `unknown operation` };
        }
        } finally {
          stamp?.();
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        // Redact secret/egress-bearing host-op errors before they reach the untrusted plugin.
        // The plugin (and its UI) only sees a generic message + a correlation id; the full detail
        // goes to the server log under the SAME id, so an operator can grep the log for the ref
        // shown in the UI without any secret ever reaching the iframe.
        if (gateFor(op) === 'host:connectors') {
          const correlationId = randomUUID().slice(0, 8);
          deps.logger?.warn({ op: op.kind, pluginId, correlationId, detail }, 'plugin broker host op failed');
          return { ok: false, error: `operation ${op.kind} failed (ref: ${correlationId})` };
        }
        return { ok: false, error: detail };
      }
    },
  };
}
