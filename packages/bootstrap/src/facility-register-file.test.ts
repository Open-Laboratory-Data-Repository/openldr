import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createAuditStore } from '@openldr/audit';
import {
  createTerminologyAdminStore, createFacilityImportRunStore, createFacilityRegisterSourceStore, referenceCapture,
  type InternalSchema,
} from '@openldr/db';
import { importFacilityRegisterCsv, type FacilityRegisterFileDeps } from './facility-register-file';

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
    logger: { error: () => undefined } as never,
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

  it('an unknown column is refused and nothing is written', async () => {
    const { db, deps } = await build();
    const bad = [HEADER + ',mystery', ...THREE.map((r) => r + ',x')].join('\n') + '\n';
    const out = await importFacilityRegisterCsv(deps, input(bad, true));
    expect(out).toEqual({ ok: false, error: 'unrecognised column(s): mystery' });
    expect(await db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
    const runs = await createFacilityImportRunStore(db).list(URL);
    expect(runs.map((r) => r.status)).toEqual(['failed']);
  });
});
