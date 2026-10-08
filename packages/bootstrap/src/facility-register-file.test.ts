import { describe, it, expect, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createAuditStore } from '@openldr/audit';
import {
  createTerminologyAdminStore, createFacilityImportRunStore, createFacilityJobStore, createFacilityRegisterSourceStore, referenceCapture,
  type InternalSchema,
} from '@openldr/db';
import { importFacilityRegisterCsv, type FacilityRegisterFileDeps } from './facility-register-file';

// Lets one test make finishing the run fail. Every other test uses the real store unchanged.
const finishFails = vi.hoisted(() => ({ on: false }));
vi.mock('@openldr/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@openldr/db')>();
  return {
    ...real,
    createFacilityImportRunStore: (db: Parameters<typeof real.createFacilityImportRunStore>[0]) => {
      const store = real.createFacilityImportRunStore(db);
      return {
        ...store,
        finishApply: (...args: Parameters<typeof store.finishApply>) => {
          if (finishFails.on) return Promise.reject(new Error('finish failed'));
          return store.finishApply(...args);
        },
      };
    },
  };
});

const URL = 'urn:test:labs';
const HEADER = 'national_code,name,level,ownership,status,country,zone,region,district,council,ward,village,address,phone,latitude,longitude';
const row = (code: string, name: string) => `${code},${name},,,,,,,,,,,,,,`;
const csv = (rows: string[]) => [HEADER, ...rows].join('\n') + '\n';
const THREE = [row('t1', 'Alpha Post'), row('t2', 'Beta Post'), row('t3', 'Gamma Post')];
const actor = { id: 'u1', name: 'tester' };

async function build() {
  const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
  const audit = createAuditStore(db);
  const deps: FacilityRegisterFileDeps = {
    db, capture: referenceCapture, admin: createTerminologyAdminStore(db), audit,
    facilityJobs: createFacilityJobStore(db),
    logger: { error: vi.fn(), warn: vi.fn() },
  };
  return { db, deps, audit };
}
const input = (body: string, apply: boolean) => ({ url: URL, name: 'Test labs', code: 'TL', csv: body, apply, actor });

describe('importFacilityRegisterCsv', () => {
  it('apply false creates nothing and returns the preview', async () => {
    const { db, deps } = await build();
    const out = await importFacilityRegisterCsv(deps, input(csv(THREE), false));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result).toMatchObject({ parsed: 3, create: 3, written: { created: 0 } });
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
    expect(await createFacilityRegisterSourceStore(db).getByUrl(URL)).toBeNull();
    expect(await createFacilityImportRunStore(db).list(URL)).toHaveLength(0);
  });

  it('apply true creates the source, imports rows, audits, and finishes the run applied', async () => {
    const { db, deps, audit } = await build();
    const out = await importFacilityRegisterCsv(deps, input(csv(THREE), true));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.written.created).toBe(3);
    expect(await createFacilityRegisterSourceStore(db).getByUrl(URL)).toMatchObject({ url: URL, name: 'Test labs', code: 'TL' });
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(3);
    const events = (await audit.list({ action: 'facility.import' }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityType: 'facility', entityId: URL, actorName: 'tester', metadata: { source: 'content-pack' } });
    const runs = await createFacilityImportRunStore(db).list(URL);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('applied');
  });

  it('the rebuild an apply queues records the installing actor', async () => {
    const { db, deps } = await build();
    await importFacilityRegisterCsv(deps, input(csv(THREE), true));
    expect(await createFacilityJobStore(db).latest('facility-map-rebuild')).toMatchObject({ requestedBy: 'u1' });
  });

  it('a second apply reuses the source and leaves 3 rows', async () => {
    const { db, deps } = await build();
    await importFacilityRegisterCsv(deps, input(csv(THREE), true));
    const out = await importFacilityRegisterCsv(deps, input(csv(THREE), true));
    expect(out.ok).toBe(true);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(3);
    expect(await db.selectFrom('coding_systems').selectAll().where('url', '=', URL).execute()).toHaveLength(1);
  });

  it('a row missing from a newer file is reported absent and never retired', async () => {
    const { db, deps } = await build();
    await importFacilityRegisterCsv(deps, input(csv(THREE), true));
    const out = await importFacilityRegisterCsv(deps, input(csv(THREE.slice(0, 2)), true));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.written.retired).toBe(0);
      expect(out.result.absent).toBe(1);
    }
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(3);
  });

  it('an unknown column on a later apply is refused, writes nothing new, and fails the run', async () => {
    const { db, deps } = await build();
    await importFacilityRegisterCsv(deps, input(csv(THREE.slice(0, 1)), true));
    const bad = [HEADER + ',mystery', ...THREE.map((r) => r + ',x')].join('\n') + '\n';
    const out = await importFacilityRegisterCsv(deps, input(bad, true));
    expect(out).toEqual({ ok: false, error: 'unrecognised column(s): mystery' });
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(1);
    const runs = await createFacilityImportRunStore(db).list(URL);
    expect(runs.map((r) => r.status).sort()).toEqual(['applied', 'failed']);
  });

  it('carries listed extra columns into extras, matched without regard to case', async () => {
    const { db, deps } = await build();
    const body = [HEADER + ',Province_Code,district_code', row('t1', 'Alpha Post') + ',01,U2', row('t2', 'Beta Post') + ',02,'].join('\n') + '\n';
    const out = await importFacilityRegisterCsv(deps, { ...input(body, true), extraColumns: ['province_code', 'District_Code'] });
    expect(out.ok).toBe(true);
    const rows = await db.selectFrom('facility_registry').select(['facility_code', 'extras']).orderBy('facility_code').execute();
    expect(rows[0]).toMatchObject({ facility_code: 't1', extras: { province_code: '01', district_code: 'U2' } });
    expect((rows[1].extras as Record<string, unknown>).province_code).toBe('02');
  });

  it('still refuses an unknown column that extraColumns does not list', async () => {
    const { db, deps } = await build();
    const body = [HEADER + ',province_code,mystery', row('t1', 'Alpha Post') + ',01,x'].join('\n') + '\n';
    const out = await importFacilityRegisterCsv(deps, { ...input(body, true), extraColumns: ['province_code'] });
    expect(out).toEqual({ ok: false, error: 'unrecognised column(s): mystery' });
    expect(await createFacilityRegisterSourceStore(db).getByUrl(URL)).toBeNull();
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('refuses a listed extra column when extraColumns is not given', async () => {
    const { deps } = await build();
    const body = [HEADER + ',province_code', row('t1', 'Alpha Post') + ',01'].join('\n') + '\n';
    const out = await importFacilityRegisterCsv(deps, input(body, true));
    expect(out).toEqual({ ok: false, error: 'unrecognised column(s): province_code' });
  });

  it('a deactivated source is refused on a preview too', async () => {
    const { db, deps } = await build();
    await createFacilityRegisterSourceStore(db).create({ url: URL, name: 'Test labs', code: 'TL' });
    await db.updateTable('coding_systems').set({ active: false } as never).where('url', '=', URL).execute();
    const out = await importFacilityRegisterCsv(deps, input(csv(THREE), false));
    expect(out.ok).toBe(false);
  });

  it('a refused first apply leaves no source row and no run', async () => {
    const { db, deps } = await build();
    const bad = [HEADER + ',mystery', ...THREE.map((r) => r + ',x')].join('\n') + '\n';
    const out = await importFacilityRegisterCsv(deps, input(bad, true));
    expect(out).toEqual({ ok: false, error: 'unrecognised column(s): mystery' });
    expect(await createFacilityRegisterSourceStore(db).getByUrl(URL)).toBeNull();
    expect(await createFacilityImportRunStore(db).list(URL)).toHaveLength(0);
  });

  it('a run that will not finish is logged, and the import result still stands', async () => {
    const { deps } = await build();
    finishFails.on = true;
    try {
      const out = await importFacilityRegisterCsv(deps, input(csv(THREE), true));
      expect(out.ok).toBe(true);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'applied' }), expect.stringContaining('failed to finish a facility import run'),
      );
    } finally {
      finishFails.on = false;
    }
  });

  it('a failing audit store does not fail an applied import', async () => {
    const { db, deps } = await build();
    const out = await importFacilityRegisterCsv(
      { ...deps, audit: { record: async () => { throw new Error('audit down'); } } }, input(csv(THREE), true));
    expect(out.ok).toBe(true);
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(3);
    expect(deps.logger.error).toHaveBeenCalled();
  });
});
