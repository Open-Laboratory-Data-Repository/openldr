import type { PluginRuntime } from '@openldr/plugins';
import type { PluginDataStore } from '@openldr/db';
import type { ImportCopyService } from './import-copy';
import type { ImportCheckService } from './import-check';
import type { ImportService } from './import-run';
import { auditQuietly, type ImportActor, type ImportServiceDeps } from './import-run';

// Removing a plugin never leaves its work running (design 2026-11-20-plugin-update-and-remove).
// A running copy holds the SQL it was given and reads on without the plugin, so removal stops the
// plugin's checks, then its reads, waits until each has stopped, and only then deletes what the
// person chose and removes the plugin. Records a check saved into OpenLDR are never touched.

/** What to keep: everything, the settings but not the copied data, or nothing. */
export type RemoveKeep = 'all' | 'settings' | 'nothing';
export const REMOVE_KEEPS: readonly RemoveKeep[] = ['all', 'settings', 'nothing'];

export interface RemovalPlan {
  /** Checks, then one-pass imports, then reads: the order removal stops them in. */
  running: Array<{ kind: 'copy' | 'check' | 'import'; id: string; label: string; status: string }>;
  copies: number;
  copiedBytes: number;
}

/** Some reads or checks did not stop within the wait. Nothing was deleted or removed. */
export class PluginStillStopping extends Error {
  constructor(readonly ids: string[]) {
    super(`still stopping: ${ids.join(', ')}. Nothing was removed; try again in a minute`);
    this.name = 'PluginStillStopping';
  }
}

/** Removing the active version by version would remove the plugin with its work still running. */
export class ActiveVersionRemoval extends Error {
  constructor(readonly pluginId: string, readonly version: string) {
    super(`${version} is the active version of ${pluginId}. Remove the whole plugin, which stops its work first, or roll back to another version before removing this one`);
    this.name = 'ActiveVersionRemoval';
  }
}

export interface PluginRemovalDeps {
  plugins: Pick<PluginRuntime, 'remove' | 'list'>;
  importCopies: Pick<ImportCopyService, 'list' | 'get' | 'stop' | 'remove'>;
  importChecks: Pick<ImportCheckService, 'list' | 'get' | 'stop'>;
  imports: Pick<ImportService, 'list' | 'get' | 'stop'>;
  pluginData: Pick<PluginDataStore, 'purgeExcept'>;
  audit: ImportServiceDeps['audit'];
  sleep?: (ms: number) => Promise<void>;
}

export interface PluginRemoval {
  plan(pluginId: string): Promise<RemovalPlan>;
  remove(pluginId: string, o: { keep: RemoveKeep; actor: ImportActor; waitMs?: number }): Promise<{ stopped: string[]; deletedCopies: number }>;
  /** Removes one installed version that is not the active one. Stops nothing: the active version keeps running. */
  removeVersion(pluginId: string, version: string, actor: ImportActor): Promise<void>;
}

/** A copy's records stay when everything else goes: a copy being deleted removes its own. */
const COPY_RECORDS = '__import-copies';
const LIVE = new Set(['queued', 'running', 'waiting', 'stopping']);
const POLL_MS = 1000;

export function createPluginRemoval(deps: PluginRemovalDeps): PluginRemoval {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function plan(pluginId: string): Promise<RemovalPlan> {
    const [copies, checks, imports] = await Promise.all([deps.importCopies.list(pluginId), deps.importChecks.list(pluginId), deps.imports.list(pluginId)]);
    const running: RemovalPlan['running'] = [
      ...checks.filter((c) => LIVE.has(c.status)).map((c) => ({ kind: 'check' as const, id: c.id, label: c.copyId, status: c.status })),
      ...imports.filter((r) => LIVE.has(r.status)).map((r) => ({ kind: 'import' as const, id: r.id, label: r.connectorId, status: r.status })),
      ...copies.filter((c) => LIVE.has(c.status)).map((c) => ({ kind: 'copy' as const, id: c.id, label: c.connectorId, status: c.status })),
    ];
    const copiedBytes = copies.reduce((sum, c) => sum + Object.values(c.sets ?? {}).reduce((s, set) => s + (set.bytes ?? 0), 0), 0);
    return { running, copies: copies.filter((c) => c.status !== 'deleting').length, copiedBytes };
  }

  /** Waits until every id has left the live statuses, polling once a second. */
  async function waitStopped(pluginId: string, items: RemovalPlan['running'], waitMs: number): Promise<void> {
    const tries = Math.max(1, Math.ceil(waitMs / POLL_MS));
    let pending = items;
    for (let i = 0; i < tries && pending.length > 0; i += 1) {
      const still: RemovalPlan['running'] = [];
      for (const item of pending) {
        const run = item.kind === 'check' ? await deps.importChecks.get(pluginId, item.id)
          : item.kind === 'import' ? await deps.imports.get(pluginId, item.id)
            : await deps.importCopies.get(pluginId, item.id);
        if (run && LIVE.has(run.status)) still.push(item);
      }
      pending = still;
      if (pending.length > 0 && i < tries - 1) await sleep(POLL_MS);
    }
    if (pending.length > 0) throw new PluginStillStopping(pending.map((p) => p.id));
  }

  async function remove(pluginId: string, o: { keep: RemoveKeep; actor: ImportActor; waitMs?: number }) {
    if (!REMOVE_KEEPS.includes(o.keep)) throw new Error(`keep must be one of ${REMOVE_KEEPS.join(', ')}`);
    const { running } = await plan(pluginId);
    // Checks before reads: a read with a live check cannot be deleted, and a check reads the copy.
    for (const item of running) {
      if (item.status === 'stopping') continue;
      if (item.kind === 'check') await deps.importChecks.stop(pluginId, item.id, o.actor);
      else if (item.kind === 'import') await deps.imports.stop(pluginId, item.id, o.actor);
      else await deps.importCopies.stop(pluginId, item.id, o.actor);
    }
    await waitStopped(pluginId, running, o.waitMs ?? 120_000);

    let deletedCopies = 0;
    if (o.keep !== 'all') {
      for (const copy of await deps.importCopies.list(pluginId)) {
        if (copy.status === 'deleting') continue;
        await deps.importCopies.remove(pluginId, copy.id, o.actor);
        deletedCopies += 1;
      }
    }
    if (o.keep === 'nothing') await deps.pluginData.purgeExcept(pluginId, [COPY_RECORDS]);
    await deps.plugins.remove(pluginId, undefined, { actor: { id: o.actor.id, name: o.actor.name } });

    const stopped = running.map((r) => r.id);
    await auditQuietly(deps.audit, {
      action: 'import.plugin.remove', pluginId, actor: o.actor, metadata: { keep: o.keep, stopped, deletedCopies },
    });
    return { stopped, deletedCopies };
  }

  async function removeVersion(pluginId: string, version: string, actor: ImportActor) {
    const rows = (await deps.plugins.list()).filter((p) => p.id === pluginId);
    if (rows.some((p) => p.version === version && p.active)) throw new ActiveVersionRemoval(pluginId, version);
    await deps.plugins.remove(pluginId, version, { actor: { id: actor.id, name: actor.name } });
  }

  return { plan, remove, removeVersion };
}
