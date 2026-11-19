import type { Kysely } from 'kysely';
import {
  buildWarehouseDataset, dropWarehouseDataset,
  type InternalSchema, type WarehouseDataset, type WarehouseDatasetDef, type WarehouseDatasetStore,
} from '@openldr/db';
import { validateSelectSql } from '@openldr/dashboards';
import { redact } from '@openldr/core';
import { readWarehouseReading } from './warehouse-status';

// Datasets a content pack defines (pack datasets design, 2026-11-19). A dataset is a name and one
// SELECT. Its result is kept as the warehouse table `dataset.<name>`, so a report reads a table made
// once and does not redo a heavy step on every run. On 2.3 million requests that took two reports
// from 37 and 31 seconds to 4.5 and 2.9.

export type PackDataset = WarehouseDatasetDef;

export interface DatasetBuildResult { name: string; ok: boolean; rows?: number; ms?: number; error?: string }

export interface WarehouseDatasetService {
  list(): Promise<WarehouseDataset[]>;
  /** Throws on the first problem and writes nothing: a warehouse that is not PostgreSQL, SQL that is
   *  not one read-only SELECT, a name another pack owns. */
  check(ownerPack: string, defs: PackDataset[]): Promise<void>;
  /** Saves the definitions and builds each, in the pack's order. Throws at the first build that
   *  fails, after recording its error. The ones after it stay saved and unbuilt. */
  install(ownerPack: string, defs: PackDataset[]): Promise<void>;
  /** Rebuilds one dataset, or all of them in order. A build that fails is reported, not thrown.
   *  Throws only for a name that is not a dataset. */
  rebuild(name?: string): Promise<DatasetBuildResult[]>;
  /** Rebuilds the datasets that are out of date, and only while the warehouse is up to date.
   *  Resolves to the names it rebuilt. */
  refreshDue(): Promise<string[]>;
  /** Drops the built table and forgets the dataset. */
  remove(name: string): Promise<void>;
  /** True while a build runs in this process. */
  building(): boolean;
}

export interface WarehouseDatasetDeps {
  store: WarehouseDatasetStore;
  internalDb: Kysely<InternalSchema>;
  warehouseDb: Kysely<any>;
  engine: 'postgres' | 'mssql' | 'mysql';
  logger: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
  build?: typeof buildWarehouseDataset;
  drop?: typeof dropWarehouseDataset;
}

/** One sentence for the screen and the stored row: the first line, with secrets masked. The lines
 *  after it are the statement text PostgreSQL echoes back. */
function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return redact(message.split('\n')[0] ?? '').slice(0, 500);
}

export function createWarehouseDatasetService(deps: WarehouseDatasetDeps): WarehouseDatasetService {
  const build = deps.build ?? buildWarehouseDataset;
  const drop = deps.drop ?? dropWarehouseDataset;

  // Builds in this process run one after the other. A build reads whole warehouse tables, so two at
  // once would only slow each other and every report beside them.
  let queue: Promise<unknown> = Promise.resolve();
  let waiting = 0;
  function inTurn<T>(fn: () => Promise<T>): Promise<T> {
    waiting += 1;
    const run = queue.then(fn, fn);
    queue = run.then(() => undefined, () => undefined).finally(() => { waiting -= 1; });
    return run;
  }

  async function buildOne(def: WarehouseDataset | (PackDataset & { name: string })): Promise<DatasetBuildResult> {
    // The newest change is read BEFORE the build. A record saved while the build runs then leaves
    // the dataset out of date, and the next refresh builds it again.
    const before = await readWarehouseReading(deps.internalDb);
    const started = Date.now();
    try {
      const { rows } = await build(deps.warehouseDb, { name: def.name, sql: def.sql, indexes: def.indexes });
      const ms = Date.now() - started;
      await deps.store.markBuilt(def.name, { seq: before.head, ms, rows });
      return { name: def.name, ok: true, rows, ms };
    } catch (err) {
      const error = errorText(err);
      await deps.store.markFailed(def.name, error);
      deps.logger.warn({ dataset: def.name, error }, 'a pack dataset failed to build; the last good table stays');
      return { name: def.name, ok: false, error };
    }
  }

  const service: WarehouseDatasetService = {
    list: () => deps.store.list(),

    async check(ownerPack, defs) {
      if (deps.engine !== 'postgres') throw new Error('datasets need a PostgreSQL warehouse');
      for (const def of defs) {
        try {
          validateSelectSql(def.sql, 'postgres');
        } catch (err) {
          throw new Error(`dataset ${def.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const existing = new Map((await deps.store.list()).map((d) => [d.name, d.ownerPack]));
      for (const def of defs) {
        const owner = existing.get(def.name);
        if (owner && owner !== ownerPack) throw new Error(`dataset ${def.name} belongs to ${owner}`);
      }
    },

    async install(ownerPack, defs) {
      await service.check(ownerPack, defs);
      await deps.store.replaceForPack(ownerPack, defs);
      for (const def of defs) {
        const out = await inTurn(() => buildOne(def));
        if (!out.ok) throw new Error(`dataset ${def.name}: ${out.error}`);
      }
    },

    rebuild(name) {
      // The whole call takes its turn, the listing too, so `building()` is true from the moment a
      // rebuild is asked for.
      return inTurn(async () => {
        const all = await deps.store.list();
        const chosen = name === undefined ? all : all.filter((d) => d.name === name);
        if (name !== undefined && chosen.length === 0) throw new Error(`no dataset named ${name}`);
        const out: DatasetBuildResult[] = [];
        for (const d of chosen) out.push(await buildOne(d));
        return out;
      });
    },

    async refreshDue() {
      const reading = await readWarehouseReading(deps.internalDb);
      if (reading.behind > 0) return [];
      // Out of date: never built, or built before the newest change. A dataset whose last build
      // failed and was never built counts as never built, so it is tried again here. One that has a
      // good table and failed since is tried again only after the next change, which moves `head`.
      const stale = (await deps.store.list()).filter((d) => d.builtAtSeq === null || d.builtAtSeq < reading.head);
      if (stale.length === 0) return [];
      return inTurn(async () => {
        const done: string[] = [];
        for (const d of stale) { await buildOne(d); done.push(d.name); }
        return done;
      });
    },

    async remove(name) {
      if (!(await deps.store.get(name))) throw new Error(`no dataset named ${name}`);
      await inTurn(async () => {
        await drop(deps.warehouseDb, name);
        await deps.store.remove(name);
      });
    },

    building: () => waiting > 0,
  };
  return service;
}

export interface DatasetRefresher {
  tickOnce(): Promise<void>;
  stop(): void;
}

/**
 * Keeps pack datasets up to date in a long-lived process. Every `intervalMs` it asks whether the
 * warehouse is up to date. Only on the second yes in a row does it rebuild what is out of date.
 *
 * Why two in a row: during an import the warehouse step can catch up for an instant between two
 * pages. A rebuild reads whole tables and takes tens of seconds at 2 million requests, so starting
 * one then would compete with the import and be out of date before it ended.
 */
export function createDatasetRefresher(deps: {
  upToDate: () => Promise<boolean>;
  refreshDue: () => Promise<string[]>;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
  intervalMs?: number;
}): DatasetRefresher {
  let stopped = false;
  let streak = 0;
  let active: Promise<void> | undefined;
  function tickOnce(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (active) return active;
    active = (async () => {
      streak = (await deps.upToDate()) ? streak + 1 : 0;
      if (streak < 2) return;
      const rebuilt = await deps.refreshDue();
      if (rebuilt.length > 0) deps.logger.info({ datasets: rebuilt }, 'pack datasets rebuilt');
    })()
      .catch((err) => { deps.logger.error({ err }, 'pack dataset refresh failed'); })
      .finally(() => { active = undefined; });
    return active;
  }
  const timer = setInterval(() => { void tickOnce(); }, deps.intervalMs ?? 15_000);
  timer.unref?.();
  return { tickOnce, stop() { stopped = true; clearInterval(timer); } };
}
