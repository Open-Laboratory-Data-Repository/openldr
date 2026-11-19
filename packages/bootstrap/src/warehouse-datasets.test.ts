import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { advanceCursor, createFhirStore, createWarehouseDatasetStore } from '@openldr/db';
import { createWarehouseDatasetService, createDatasetRefresher, datasetNotBuiltMessage, withDatasetMessage } from './warehouse-datasets';
import { readWarehouseReading } from './warehouse-status';

const quiet = { info() {}, warn() {}, error() {}, debug() {} } as never;

async function world(opts: { engine?: 'postgres' | 'mssql' | 'mysql'; failing?: string[] } = {}) {
  const db = await makeMigratedDb();
  const store = createWarehouseDatasetStore(db as never);
  const fhir = createFhirStore(db as never);
  const built: string[] = [];
  const dropped: string[] = [];
  const failing = new Set(opts.failing ?? []);
  let running = 0;
  let overlapped = false;
  let duringBuild: (() => Promise<void>) | null = null;
  const service = createWarehouseDatasetService({
    store, internalDb: db as never, warehouseDb: {} as never, engine: opts.engine ?? 'postgres', logger: quiet,
    build: async (_db, def) => {
      running += 1;
      if (running > 1) overlapped = true;
      await new Promise((r) => setTimeout(r, 5));
      if (duringBuild) await duringBuild();
      running -= 1;
      if (failing.has(def.name)) throw new Error(`relation "nope" does not exist\nLINE 1: select`);
      built.push(def.name);
      return { rows: 7 };
    },
    drop: async (_db, name) => { dropped.push(name); },
  });
  /** Moves the warehouse cursor to the newest change: the warehouse is up to date. */
  const catchUp = async () => { await advanceCursor(db as never, 'projection', (await readWarehouseReading(db as never)).head); };
  const save = (id: string) => fhir.save({ resourceType: 'Patient', id } as never);
  return { db, store, service, built, dropped, failing, catchUp, save, overlapped: () => overlapped, onBuild: (f: (() => Promise<void>) | null) => { duringBuild = f; } };
}

describe('pack datasets: check', () => {
  it('check_refuses_a_warehouse_that_is_not_postgresql', async () => {
    const w = await world({ engine: 'mssql' });
    await expect(w.service.check('p', [{ name: 'abc', sql: 'select 1' }])).rejects.toThrow('datasets need a PostgreSQL warehouse');
    await w.db.destroy();
  });
  it('check_refuses_sql_that_is_not_one_select', async () => {
    const w = await world();
    await expect(w.service.check('p', [{ name: 'abc', sql: 'delete from patients' }])).rejects.toThrow(/dataset abc: /);
    await expect(w.service.check('p', [{ name: 'abc', sql: 'select 1; select 2' }])).rejects.toThrow(/dataset abc: /);
    expect(await w.store.list()).toEqual([]);
    await w.db.destroy();
  });
  it('check_refuses_a_name_another_pack_owns', async () => {
    const w = await world();
    await w.catchUp();
    await w.service.install('first', [{ name: 'abc', sql: 'select 1' }]);
    await expect(w.service.check('second', [{ name: 'abc', sql: 'select 2' }])).rejects.toThrow('dataset abc belongs to first');
    await w.db.destroy();
  });
});

describe('pack datasets: install and rebuild', () => {
  it('install_saves_and_builds_in_the_packs_order', async () => {
    const w = await world();
    await w.catchUp();
    const head = (await readWarehouseReading(w.db as never)).head;
    await w.service.install('p', [{ name: 'zzz', sql: 'select 1' }, { name: 'aaa', sql: 'select 2' }]);
    expect(w.built).toEqual(['zzz', 'aaa']);
    expect((await w.service.list()).map((d) => [d.name, d.builtAtSeq, d.rowCount, d.lastError])).toEqual([['zzz', head, 7, null], ['aaa', head, 7, null]]);
    await w.db.destroy();
  });
  it('install_stops_at_the_first_failed_build_and_records_its_error', async () => {
    const w = await world({ failing: ['bad'] });
    await expect(w.service.install('p', [{ name: 'one', sql: 'select 1' }, { name: 'bad', sql: 'select 2' }, { name: 'two', sql: 'select 3' }])).rejects.toThrow('dataset bad: relation "nope" does not exist');
    expect(w.built).toEqual(['one']);
    const bad = await w.store.get('bad');
    // The first line only, so a stored error is one sentence and holds no statement text.
    expect(bad).toMatchObject({ lastError: 'relation "nope" does not exist', builtAtSeq: null });
    expect(await w.store.get('two')).toMatchObject({ builtAtSeq: null, lastError: null });
    await w.db.destroy();
  });
  it('a_failed_rebuild_keeps_the_built_values_and_sets_the_error', async () => {
    const w = await world();
    await w.catchUp();
    await w.service.install('p', [{ name: 'abc', sql: 'select 1' }]);
    const before = await w.store.get('abc');
    w.failing.add('abc');
    expect(await w.service.rebuild('abc')).toEqual([{ name: 'abc', ok: false, error: 'relation "nope" does not exist' }]);
    expect(await w.store.get('abc')).toMatchObject({ builtAtSeq: before!.builtAtSeq, rowCount: 7, lastError: 'relation "nope" does not exist' });
    await w.db.destroy();
  });
  it('rebuild_with_no_name_rebuilds_all_in_order_and_an_unknown_name_is_refused', async () => {
    const w = await world();
    await w.service.install('p', [{ name: 'one', sql: 'select 1' }, { name: 'two', sql: 'select 2' }]);
    w.built.length = 0;
    const out = await w.service.rebuild();
    expect(out.map((o) => [o.name, o.ok, o.rows])).toEqual([['one', true, 7], ['two', true, 7]]);
    expect(w.built).toEqual(['one', 'two']);
    await expect(w.service.rebuild('nope')).rejects.toThrow('no dataset named nope');
    await w.db.destroy();
  });
  it('builds_run_one_at_a_time', async () => {
    const w = await world();
    await w.service.install('p', [{ name: 'one', sql: 'select 1' }, { name: 'two', sql: 'select 2' }]);
    expect(w.service.building()).toBe(false);
    const both = Promise.all([w.service.rebuild(), w.service.rebuild('two')]);
    expect(w.service.building()).toBe(true);
    await both;
    expect(w.overlapped()).toBe(false);
    expect(w.service.building()).toBe(false);
    await w.db.destroy();
  });
  it('remove_drops_the_table_and_the_row', async () => {
    const w = await world();
    await w.service.install('p', [{ name: 'abc', sql: 'select 1' }]);
    await w.service.remove('abc');
    expect(w.dropped).toEqual(['abc']);
    expect(await w.service.list()).toEqual([]);
    await expect(w.service.remove('abc')).rejects.toThrow('no dataset named abc');
    await w.db.destroy();
  });
});

describe('pack datasets: refresh', () => {
  it('refresh_does_nothing_while_the_warehouse_is_behind', async () => {
    const w = await world();
    await w.catchUp();
    await w.service.install('p', [{ name: 'abc', sql: 'select 1' }]);
    w.built.length = 0;
    await w.save('p1');
    expect(await w.service.refreshDue()).toEqual([]);
    expect(w.built).toEqual([]);
    await w.db.destroy();
  });
  it('refresh_rebuilds_only_the_stale_ones_when_up_to_date', async () => {
    const w = await world();
    await w.catchUp();
    await w.service.install('p', [{ name: 'old', sql: 'select 1' }]);
    await w.save('p1');
    await w.catchUp();
    await w.service.install('q', [{ name: 'new', sql: 'select 2' }]);
    w.built.length = 0;
    expect(await w.service.refreshDue()).toEqual(['old']);
    expect(w.built).toEqual(['old']);
    expect(await w.service.refreshDue()).toEqual([]);
    await w.db.destroy();
  });
  it('a_change_saved_during_a_build_leaves_the_dataset_stale', async () => {
    const w = await world();
    await w.catchUp();
    await w.service.install('p', [{ name: 'abc', sql: 'select 1' }]);
    await w.save('p1');
    await w.catchUp();
    let once = true;
    w.onBuild(async () => { if (once) { once = false; await w.save('p2'); } });
    expect(await w.service.refreshDue()).toEqual(['abc']);
    w.onBuild(null);
    await w.catchUp();
    expect(await w.service.refreshDue()).toEqual(['abc']);
    expect(await w.service.refreshDue()).toEqual([]);
    await w.db.destroy();
  });
  it('an_install_and_a_refresh_at_once_build_each_dataset_once', async () => {
    const w = await world();
    await w.catchUp();
    // The refresh is asked for while the install is still building. It takes its turn after it.
    const installing = w.service.install('p', [{ name: 'one', sql: 'select 1' }, { name: 'two', sql: 'select 2' }]);
    await new Promise((r) => setTimeout(r, 2));
    const refreshed = w.service.refreshDue();
    await installing;
    await refreshed;
    // Whichever of the two built `two`, each dataset was built once.
    expect(w.built).toEqual(['one', 'two']);
    await w.db.destroy();
  });

  it('an_install_does_not_build_again_what_a_refresh_just_built', async () => {
    const w = await world();
    await w.catchUp();
    await w.service.install('p', [{ name: 'one', sql: 'select 1' }]);
    w.built.length = 0;
    // The same definitions again, with nothing changed since: nothing to build.
    await w.service.install('p', [{ name: 'one', sql: 'select 1' }]);
    expect(w.built).toEqual([]);
    // A changed definition is built.
    await w.service.install('p', [{ name: 'one', sql: 'select 11' }]);
    expect(w.built).toEqual(['one']);
    await w.db.destroy();
  });

  it('a_dataset_that_failed_is_tried_again_only_after_the_next_change', async () => {
    const w = await world({ failing: ['abc'] });
    await w.catchUp();
    await expect(w.service.install('p', [{ name: 'abc', sql: 'select 1' }])).rejects.toThrow();
    // Never built: tried on the next refresh.
    w.failing.clear();
    expect(await w.service.refreshDue()).toEqual(['abc']);
    await w.db.destroy();
  });
});

describe('pack datasets: the refresher', () => {
  it('rebuilds_only_after_two_checks_in_a_row_find_the_warehouse_up_to_date', async () => {
    const calls: string[] = [];
    let upToDate = false;
    const refresher = createDatasetRefresher({
      upToDate: async () => upToDate,
      refreshDue: async () => { calls.push('refresh'); return []; },
      logger: quiet, intervalMs: 1_000_000,
    });
    await refresher.tickOnce();
    upToDate = true;
    await refresher.tickOnce();
    expect(calls).toEqual([]);
    await refresher.tickOnce();
    expect(calls).toEqual(['refresh']);
    upToDate = false;
    await refresher.tickOnce();
    upToDate = true;
    await refresher.tickOnce();
    expect(calls).toEqual(['refresh']);
    refresher.stop();
  });
  it('a_refresh_that_throws_does_not_stop_the_refresher', async () => {
    let n = 0;
    const refresher = createDatasetRefresher({ upToDate: async () => true, refreshDue: async () => { n += 1; throw new Error('boom'); }, logger: quiet, intervalMs: 1_000_000 });
    await refresher.tickOnce(); await refresher.tickOnce(); await refresher.tickOnce();
    expect(n).toBe(2);
    refresher.stop();
  });
});

describe('pack datasets: a report run before its dataset exists', () => {
  it('names_the_dataset_that_is_not_built_yet', () => {
    expect(datasetNotBuiltMessage('relation "dataset.zm_request_times" does not exist')).toBe('The dataset zm_request_times is still being built. Try again when it is ready.');
    expect(datasetNotBuiltMessage('relation "patients_x" does not exist')).toBeNull();
    expect(datasetNotBuiltMessage('syntax error at or near "selct"')).toBeNull();
  });
  it('replaces_only_that_error', async () => {
    await expect(withDatasetMessage(async () => { throw new Error('relation "dataset.abc" does not exist'); })).rejects.toThrow('The dataset abc is still being built. Try again when it is ready.');
    await expect(withDatasetMessage(async () => { throw new Error('division by zero'); })).rejects.toThrow('division by zero');
    expect(await withDatasetMessage(async () => 4)).toBe(4);
  });
});

