import type { Logger } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { Converter } from '@openldr/ingest';
import {
  parseArtifactManifest,
  pluginManifestToArtifact,
  verifyArtifact,
  keyFingerprint,
  evaluateTrust,
  isCompatible,
  readGrant,
  canonicalJSON,
  type ArtifactManifest,
  type TrustStore,
  type Capability,
} from '@openldr/marketplace';
import { PluginShapeError, tableShapesSchema, type PluginSchemas, type TableShape } from '@openldr/db';
import { parseManifest, type PluginManifest } from './manifest';
import { sha256Hex } from './hash';
import type { PluginStore, PluginRow } from './store';
import type { PluginRunner } from './runner';
import { createWasmConverter } from './wasm-converter';
import { createWasmSink, type WasmSink } from './wasm-sink';
import { PermissionGroupTakenError, groupRefusal, permissionGroups } from './stored-permissions';

export interface MarketplaceInstallAudit {
  action: string;
  entityType: string;
  entityId: string;
  actorType: 'user' | 'system';
  actorId?: string | null;
  actorName: string;
  metadata?: Record<string, unknown>;
}

export interface PluginRuntimeDeps {
  blob: BlobStoragePort;
  store: PluginStore;
  runner: PluginRunner;
  logger: Logger;
  trustStore: TrustStore;
  ceVersion: string;
  verifyConfig: { devAllowUnsigned: boolean };
  recordInstall?: (e: MarketplaceInstallAudit) => Promise<void>;
  /** Builds the tables a plugin declares in payload.tables. Install only plans and applies them.
   *  Removal drops them (plugin-removal.ts), never install, rollback or disable. */
  schemas?: Pick<PluginSchemas, 'plan' | 'apply'>;
  /** Told after a version is installed, enabled, disabled, removed or rolled back. The host uses
   *  it to refresh the capability catalog and grant a plugin's permissions to the Administrator
   *  (plan 2026-11-23-plugin-host-2b, rulings 3 and 4). A failure here is logged, never thrown:
   *  the lifecycle change has already happened. */
  onChange?: (e: { id: string; action: 'install' | 'enable' | 'disable' | 'remove' | 'rollback' }) => Promise<void>;
}

export interface InstallApproval {
  approvedBy: string;
  acknowledgedCapabilities: Capability[];
}

export interface InstallOptions {
  publicKeyDer?: Uint8Array;
  actor?: { id?: string | null; name: string };
  approval?: InstallApproval;
  /** Bytes of the bundle's ui.html, required iff the manifest declares payload.ui. */
  ui?: Uint8Array;
}

type LifecycleOpts = { actor?: { id?: string | null; name: string } };

export interface PluginRuntime {
  install(wasm: Uint8Array, rawManifest: unknown, opts?: InstallOptions): Promise<PluginManifest>;
  list(): Promise<PluginRow[]>;
  test(id: string, version?: string): Promise<{ ok: boolean; error?: string }>;
  remove(id: string, version?: string, opts?: LifecycleOpts): Promise<void>;
  load(id: string, version?: string): Promise<Converter | undefined>;
  loadSink(id: string, version?: string): Promise<WasmSink | undefined>;
  loadUi(id: string, version?: string): Promise<Uint8Array | undefined>;
  rollback(id: string, version: string, opts?: LifecycleOpts): Promise<void>;
  setEnabled(id: string, enabled: boolean, opts?: LifecycleOpts): Promise<void>;
}

function wasmKey(id: string, version: string): string {
  return `plugins/${id}/${version}/plugin.wasm`;
}
function manifestKey(id: string, version: string): string {
  return `plugins/${id}/${version}/manifest.json`;
}
function uiKey(id: string, version: string): string {
  return `plugins/${id}/${version}/ui.html`;
}

function isArtifactManifest(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && 'schemaVersion' in raw && 'payload' in raw;
}

function artifactToPluginManifest(a: ArtifactManifest): PluginManifest {
  const p = a.payload as Extract<ArtifactManifest['payload'], { kind: 'plugin' }>;
  return parseManifest({
    id: a.id,
    version: a.version,
    kind: p.pluginKind,
    entrypoint: p.entrypoint,
    entrypoints: p.entrypoints,
    wasmSha256: p.wasmSha256,
    description: a.description,
    readme: a.readme,
    license: a.license,
    wasi: p.wasi,
    limits: p.limits,
    ...(p.workflowNodes !== undefined ? { workflowNodes: p.workflowNodes } : {}),
  });
}

/** Extract the legacy PluginManifest fields from a persisted row manifest.
 *  If the row stores a full artifact manifest (schemaVersion + payload), extract from payload.
 *  Otherwise parse it directly as a legacy plugin manifest. */
function pluginManifestFromRow(row: PluginRow): PluginManifest {
  const m = row.manifest;
  if (m.schemaVersion && m.payload && (m.payload as { kind?: string }).kind === 'plugin') {
    return artifactToPluginManifest(parseArtifactManifest(m, { stored: true }));
  }
  return parseManifest(m);
}

export function createPluginRuntime(deps: PluginRuntimeDeps): PluginRuntime {
  const cache = new Map<string, Converter>();
  const sinkCache = new Map<string, WasmSink>();

  async function changed(id: string, action: 'install' | 'enable' | 'disable' | 'remove' | 'rollback'): Promise<void> {
    if (!deps.onChange) return;
    try {
      await deps.onChange({ id, action });
    } catch (err) {
      deps.logger.warn({ id, action, err }, 'plugin change hook failed');
    }
  }

  function invalidateCache(id: string) {
    for (const k of [...cache.keys()]) {
      if (k.startsWith(`${id}@`)) cache.delete(k);
    }
    for (const k of [...sinkCache.keys()]) {
      if (k.startsWith(`${id}@`)) sinkCache.delete(k);
    }
  }

  async function loadWasm(row: PluginRow): Promise<Uint8Array> {
    const wasm = await deps.blob.get(wasmKey(row.id, row.version));
    const actual = sha256Hex(wasm);
    if (actual !== row.sha256) {
      throw new Error(`plugin ${row.id}@${row.version} sha256 mismatch (expected ${row.sha256}, got ${actual})`);
    }
    return wasm;
  }

  async function load(id: string, version?: string): Promise<Converter | undefined> {
    const row = await deps.store.get(id, version);
    if (!row) return undefined;
    const key = `${row.id}@${row.version}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const wasm = await loadWasm(row);
    const grant = readGrant(row.manifest);
    const converter = createWasmConverter(pluginManifestFromRow(row), wasm, deps.runner, deps.logger, grant.legacy ? undefined : grant.capabilities);
    cache.set(key, converter);
    return converter;
  }

  /** The tables the stored, signed manifest declares. A corrupt list throws, like a corrupt grant. */
  function storedTables(row: PluginRow): TableShape[] {
    const tables = (row.manifest as { payload?: { tables?: unknown } }).payload?.tables;
    return tables === undefined ? [] : tableShapesSchema.parse(tables);
  }

  async function loadSink(id: string, version?: string): Promise<WasmSink | undefined> {
    const row = await deps.store.get(id, version);
    if (!row) return undefined;
    const key = `${row.id}@${row.version}`;
    const cached = sinkCache.get(key);
    if (cached) return cached;
    const manifest = pluginManifestFromRow(row);
    // A sink loads outright; a non-sink (e.g. a `kind:'source'` converter) is also invokable
    // as long as it declares named entrypoints — the workflow engine calls those via
    // invokeBytes(entrypoint, …). createWasmSink's allowlist still governs WHICH entrypoints
    // are callable, so this stays safe.
    if (manifest.kind !== 'sink' && manifest.entrypoints.length === 0) {
      throw new Error(`plugin ${row.id}@${row.version} is not invokable (kind=${manifest.kind}, no entrypoints)`);
    }
    const wasm = await loadWasm(row);
    const grant = readGrant(row.manifest);
    const sink = createWasmSink(manifest, wasm, deps.runner, deps.logger, grant.legacy ? undefined : grant.capabilities, storedTables(row));
    sinkCache.set(key, sink);
    return sink;
  }

  return {
    async install(wasm, rawManifest, opts = {}) {
      // Accept either a new artifact manifest or a legacy plugin manifest.
      // Preserve the raw object for signature verification (canonical bytes must match what was signed).
      const isArtifact = isArtifactManifest(rawManifest);
      const artifact: ArtifactManifest = isArtifact
        ? parseArtifactManifest(rawManifest)
        : pluginManifestToArtifact(rawManifest as never);

      if (artifact.payload.kind !== 'plugin') {
        throw new Error(`install: only plugin artifacts are wired in SP-1 (got ${artifact.payload.kind})`);
      }

      const payloadSha = sha256Hex(wasm);
      if (payloadSha !== artifact.payload.wasmSha256) {
        throw new Error(`manifest wasmSha256 (${artifact.payload.wasmSha256}) does not match the wasm (${payloadSha})`);
      }

      // Compatibility gate.
      if (!isCompatible(artifact.compatibility.ceVersion, deps.ceVersion)) {
        throw new Error(
          `artifact ${artifact.id}@${artifact.version} is not compatible with CE ${deps.ceVersion} (requires ${artifact.compatibility.ceVersion})`,
        );
      }

      // Signature + trust (only when a publisher is declared).
      let signatureVerified = false;
      if (artifact.publisher) {
        const pub = artifact.publisher;
        const hasKey = !!opts.publicKeyDer;
        // Verify against the raw manifest so canonical bytes match what was signed before zod defaults were applied.
        const rawForVerify = isArtifact ? (rawManifest as Record<string, unknown>) : (artifact as unknown as Record<string, unknown>);
        const verified =
          hasKey &&
          keyFingerprint(opts.publicKeyDer!) === pub.keyFingerprint &&
          verifyArtifact(rawForVerify, payloadSha, opts.publicKeyDer!);

        if (!verified) {
          if (!deps.verifyConfig.devAllowUnsigned) {
            throw new Error(`artifact ${artifact.id}@${artifact.version}: invalid or missing signature for publisher ${pub.id}`);
          }
        } else {
          signatureVerified = true;
          const fingerprint = keyFingerprint(opts.publicKeyDer!);
          const trust = evaluateTrust(pub.id, fingerprint, await deps.trustStore.get(pub.id));
          if (trust.decision === 'key-mismatch') {
            throw new Error(`artifact ${artifact.id}: publisher ${pub.id} key fingerprint does not match the pinned key`);
          }
          // First-use pinning deferred until after consent is confirmed (see below).
        }
      }

      // Consent: publisher-bearing artifacts require explicit approval of the requested capabilities.
      let approvedBy: string | null = null;
      if (artifact.publisher) {
        if (!opts.approval) {
          throw new Error(`artifact ${artifact.id}@${artifact.version}: install requires explicit approval (publisher ${artifact.publisher.id})`);
        }
        if (canonicalJSON(artifact.capabilities) !== canonicalJSON(opts.approval.acknowledgedCapabilities)) {
          throw new Error(`artifact ${artifact.id}: acknowledged capabilities do not match the requested capabilities`);
        }
        approvedBy = opts.approval.approvedBy;
        // Pin publisher on first-use only once consent is confirmed + signature verified.
        if (signatureVerified) {
          const fingerprint = keyFingerprint(opts.publicKeyDer!);
          const trust = evaluateTrust(artifact.publisher.id, fingerprint, await deps.trustStore.get(artifact.publisher.id));
          if (trust.decision === 'first-use') {
            await deps.trustStore.pin({
              publisherId: artifact.publisher.id,
              keyFingerprint: fingerprint,
              publisherName: artifact.publisher.name,
              approvedBy,
            });
          }
        }
      }

      // Validate ui bytes when the manifest declares a webview ui contribution (entry present).
      // Declarative-only plugins (no entry) carry no ui.html and need no bytes.
      const uiMeta = artifact.payload.kind === 'plugin' ? artifact.payload.ui : undefined;
      if (uiMeta?.entry) {
        if (!opts.ui) throw new Error(`artifact ${artifact.id}: manifest declares payload.ui.entry but no ui bytes were provided`);
        const uiSha = sha256Hex(opts.ui);
        if (uiSha !== uiMeta.sha256) {
          throw new Error(`artifact ${artifact.id}: ui.html sha (${uiSha}) does not match manifest payload.ui.sha256 (${uiMeta.sha256})`);
        }
      }

      // Declared tables, after every check above and before the version is made active, so a
      // refused or failed shape change leaves the version that was active before still active.
      const tables = artifact.payload.tables;
      const active = (await deps.store.list()).find((r) => r.id === artifact.id && r.active);
      const kept = active ? `${active.id}@${active.version} stays active` : 'nothing was installed';
      const notInstalled = `${artifact.id}@${artifact.version} was not installed, and ${kept}`;

      // The publisher a group claim is bound to: the fingerprint of the key the signature check
      // above verified, never the fingerprint the manifest names. Null when nothing was verified,
      // which includes an unverified install that devAllowUnsigned let through.
      const publisher = signatureVerified ? keyFingerprint(opts.publicKeyDer!) : null;

      // The group rule (ruling 1 as amended): each group the keys use must be unowned or owned by
      // this plugin id from this publisher. Checked here, before anything is written, so a refusal
      // leaves the old version active and its tables alone. The store claims the groups in the
      // install transaction.
      if (deps.store.groupOwners) {
        const groups = permissionGroups(artifact as unknown as Record<string, unknown>);
        const refused = groupRefusal(groups, await deps.store.groupOwners(groups), artifact.id, publisher);
        if (refused) throw new Error(`${notInstalled}: ${refused.message}`);
      }
      if (tables === undefined || tables.length === 0) {
        const before = (active?.manifest as { payload?: { tables?: unknown[] } } | undefined)?.payload?.tables;
        if (Array.isArray(before) && before.length > 0) {
          deps.logger.warn(
            { id: artifact.id, from: active!.version, to: artifact.version },
            'plugin upgrade declares no tables; the tables of the version before and their data stay',
          );
        }
      } else {
        if (!deps.schemas) {
          throw new Error(`artifact ${artifact.id}@${artifact.version} declares tables, but this OpenLDR cannot create plugin tables here`);
        }
        try {
          await deps.schemas.plan(artifact.id, tables);
          await deps.schemas.apply(artifact.id, tables);
        } catch (err) {
          if (err instanceof PluginShapeError) throw new PluginShapeError(err.reason, `${notInstalled}: ${err.message}`);
          // A database error: the full error goes to the log, and the caller gets a short reason
          // with no SQL text or stack.
          deps.logger.error({ id: artifact.id, version: artifact.version, err }, 'plugin tables could not be built');
          const code = (err as { code?: unknown } | null)?.code;
          const short = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? ` (database error ${code})` : '';
          throw new Error(`${notInstalled}: the database refused the table change${short}`);
        }
      }

      // Persist the FULL artifact manifest (capabilities included) so the store row carries the grant.
      const fullManifest = isArtifact ? (rawManifest as Record<string, unknown>) : (artifact as unknown as Record<string, unknown>);
      // Still derive the legacy PluginManifest for the blob + return value (back-compat callers).
      const pluginManifest = artifactToPluginManifest(artifact);

      await deps.blob.put(wasmKey(artifact.id, artifact.version), wasm, 'application/wasm');
      await deps.blob.put(
        manifestKey(artifact.id, artifact.version),
        new TextEncoder().encode(JSON.stringify(fullManifest)),
        'application/json',
      );
      if (uiMeta?.entry && opts.ui) {
        await deps.blob.put(uiKey(artifact.id, artifact.version), opts.ui, 'text/html');
      }
      try {
        await deps.store.install({ id: artifact.id, version: artifact.version, sha256: payloadSha, manifest: fullManifest, approvedBy, publisher });
      } catch (err) {
        // Another install claimed the group between the check above and this transaction.
        if (err instanceof PermissionGroupTakenError) throw new Error(`${notInstalled}: ${err.message}`);
        throw err;
      }
      invalidateCache(artifact.id);
      deps.logger.info({ id: artifact.id, version: artifact.version }, 'plugin installed');
      await changed(artifact.id, 'install');

      if (deps.recordInstall) {
        await deps.recordInstall({
          action: 'marketplace.install',
          entityType: 'artifact',
          entityId: `${artifact.id}@${artifact.version}`,
          actorType: opts.actor ? 'user' : 'system',
          actorId: opts.actor?.id ?? null,
          actorName: opts.actor?.name ?? 'system',
          metadata: {
            type: artifact.type,
            publisherId: artifact.publisher?.id ?? null,
            capabilities: artifact.capabilities,
            signatureVerified,
            approvedBy,
          },
        });
      }

      return pluginManifest;
    },

    list: () => deps.store.list(),

    async test(id, version) {
      try {
        const c = await load(id, version);
        if (!c) return { ok: false, error: 'plugin not installed' };
        await c.convert(new Uint8Array(), { batchId: 'plugin-test' });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async remove(id, version, o = {}) {
      await deps.store.remove(id, version);
      invalidateCache(id);
      await changed(id, 'remove');
      await deps.recordInstall?.({
        action: 'marketplace.remove',
        entityType: 'artifact',
        entityId: version ? `${id}@${version}` : id,
        actorType: o.actor ? 'user' : 'system',
        actorId: o.actor?.id ?? null,
        actorName: o.actor?.name ?? 'system',
      });
    },

    async rollback(id, version, o = {}) {
      try {
        await deps.store.rollback(id, version);
      } catch (err) {
        if (err instanceof PermissionGroupTakenError) throw new Error(`cannot roll back ${id} to ${version}: ${err.message}`);
        throw err;
      }
      invalidateCache(id);
      await changed(id, 'rollback');
      await deps.recordInstall?.({
        action: 'marketplace.rollback',
        entityType: 'artifact',
        entityId: `${id}@${version}`,
        actorType: o.actor ? 'user' : 'system',
        actorId: o.actor?.id ?? null,
        actorName: o.actor?.name ?? 'system',
      });
    },

    async setEnabled(id, enabled, o = {}) {
      try {
        await deps.store.setEnabled(id, enabled);
      } catch (err) {
        if (err instanceof PermissionGroupTakenError) throw new Error(`cannot enable ${id}: ${err.message}`);
        throw err;
      }
      invalidateCache(id);
      await changed(id, enabled ? 'enable' : 'disable');
      await deps.recordInstall?.({
        action: enabled ? 'marketplace.enable' : 'marketplace.disable',
        entityType: 'artifact',
        entityId: id,
        actorType: o.actor ? 'user' : 'system',
        actorId: o.actor?.id ?? null,
        actorName: o.actor?.name ?? 'system',
      });
    },

    load,
    loadSink,

    async loadUi(id, version) {
      const row = await deps.store.get(id, version);
      if (!row) return undefined;
      const m = row.manifest as { payload?: { ui?: { entry?: string; sha256?: string } } };
      if (!m.payload?.ui?.entry) return undefined;
      let bytes: Uint8Array;
      try {
        bytes = await deps.blob.get(uiKey(row.id, row.version));
      } catch {
        return undefined;
      }
      // SEC-11: re-verify the stored UI bytes against the signed manifest sha. Fail closed on
      // tamper-at-rest (or a missing sha, which shouldn't happen for a webview plugin) so the
      // asset route 404s rather than serving altered HTML into the plugin iframe.
      const expected = m.payload.ui.sha256;
      const actual = sha256Hex(bytes);
      if (!expected || actual !== expected) {
        deps.logger.warn({ id: row.id, version: row.version, expected, actual }, 'plugin ui sha mismatch on load — refusing to serve');
        return undefined;
      }
      return bytes;
    },
  };
}
