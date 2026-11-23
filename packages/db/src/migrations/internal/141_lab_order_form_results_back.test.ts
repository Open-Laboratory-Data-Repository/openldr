import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import {
  LAB_ORDER_PREV_FIELDS_SNAPSHOT,
  LAB_ORDER_RESULTS_BACK_FIELDS_SNAPSHOT,
  RECEPTION_MARKER_KEY,
  up,
  down,
} from './141_lab_order_form_results_back';
// Imported to PROVE this migration's frozen copies still match what 140 left and what 138 found.
// The migration itself must never import them.
import { LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT as SHIPPED_140 } from './140_lab_rejection';
import { LAB_ORDER_PREV_FIELDS_SNAPSHOT as BEFORE_138 } from './138_lab_order_form_orders_only';

const ids = (fields: unknown) => (fields as any[]).map((f) => f.id);
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

async function seedOrderForm(db: any, fields: readonly unknown[], id = 'form-sample-order'): Promise<void> {
  await db.insertInto('form_definitions').values({
    id, name: 'Lab order', status: 'published', active: true,
    target_pages: JSON.stringify(['forms']),
    schema: JSON.stringify({ id, name: 'Lab order', fields, targetPages: ['forms'] }),
  } as never).execute();
}

async function readSchema(db: any, id = 'form-sample-order'): Promise<Record<string, unknown>> {
  const row = await db.selectFrom('form_definitions').select('schema').where('id', '=', id).executeTakeFirst();
  return json(row.schema);
}

async function freshDb(): Promise<any> {
  const db = await makeMigratedDb();
  await db.deleteFrom('form_definitions').where('name', '=', 'Lab order').execute();
  return db;
}

/** The Reception role as slice 2 seeded it: a system role, with its keys and one user. */
async function seedReception(db: any, isSystem = true, id = 'r-reception'): Promise<void> {
  await db.insertInto('roles').values({ id, slug: 'reception', name: 'Reception', description: null, is_system: isSystem }).execute();
  for (const capability of ['lab.receive', 'lab.reject', 'lab.worklist.view', 'patients.view']) {
    await db.insertInto('role_capabilities').values({ role_id: id, capability }).execute();
  }
  await db.insertInto('user_roles').values({ user_id: 'u-desk', role_id: id }).execute();
}

async function receptionRow(db: any): Promise<{ id: string; is_system: boolean } | undefined> {
  return db.selectFrom('roles').select(['id', 'is_system']).where('slug', '=', 'reception').executeTakeFirst();
}

async function capsOf(db: any, roleId: string): Promise<string[]> {
  const rows = await db.selectFrom('role_capabilities').select('capability').where('role_id', '=', roleId).execute();
  return (rows as Array<{ capability: string }>).map((r) => r.capability).sort();
}

async function usersOf(db: any, roleId: string): Promise<string[]> {
  const rows = await db.selectFrom('user_roles').select('user_id').where('role_id', '=', roleId).execute();
  return (rows as Array<{ user_id: string }>).map((r) => r.user_id).sort();
}

async function markerRow(db: any): Promise<unknown> {
  return db.selectFrom('app_settings').select('value').where('key', '=', RECEPTION_MARKER_KEY).executeTakeFirst();
}

describe('141 the Lab order form enters results and rejections again', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('the Lab order form', () => {
    it("puts Results and Order rejection back on a form still in 140's shape", async () => {
      const db = await freshDb();
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      await up(db);
      const fields = (await readSchema(db)).fields;
      expect(fields).toEqual(LAB_ORDER_RESULTS_BACK_FIELDS_SNAPSHOT);
      expect(ids(fields)).toContain('fld-ord-results');
      expect(ids(fields)).toContain('fld-ord-rejection');
    });

    it('restores the shape from before 138, with the original order numbers', () => {
      expect(LAB_ORDER_RESULTS_BACK_FIELDS_SNAPSHOT).toEqual(BEFORE_138);
      expect((LAB_ORDER_RESULTS_BACK_FIELDS_SNAPSHOT as any[]).map((f) => f.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("the frozen copy of 140's Lab order shape still matches what 140 actually left", () => {
      expect(LAB_ORDER_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_140);
    });

    it('leaves a form edited after 140 alone, and says why', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const db = await freshDb();
      const edited = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as any[]).map((f) => (f.id === 'fld-ord-notes' ? { ...f, displayLabel: 'Notes' } : f));
      await seedOrderForm(db, edited);
      await up(db);
      expect((await readSchema(db)).fields).toEqual(edited);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/migration 141/);
      expect(String(warn.mock.calls[0][0])).toMatch(/edited after it shipped/);
    });

    it('a second run changes nothing and says nothing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const db = await freshDb();
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      await seedReception(db);
      await up(db);
      const once = await readSchema(db);
      const roleOnce = await receptionRow(db);
      await up(db);
      expect(await readSchema(db)).toEqual(once);
      expect(await receptionRow(db)).toEqual(roleOnce);
      expect(warn).not.toHaveBeenCalled();
    });

    it('does not guess when two forms share the name, and says why', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const db = await freshDb();
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-a');
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'form-b');
      await up(db);
      expect((await readSchema(db, 'form-a')).fields).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      expect((await readSchema(db, 'form-b')).fields).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      expect(String(warn.mock.calls[0][0])).toMatch(/2 forms are named "Lab order"/);
    });

    it('does nothing when no Lab order form is seeded yet', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const db = await freshDb();
      await up(db);
      expect(await db.selectFrom('form_definitions').select('id').where('name', '=', 'Lab order').execute()).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });

    it("down() puts back 140's shape exactly as up() found it, and drops the marker", async () => {
      const db = await freshDb();
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      await up(db);
      await down(db);
      const schema = await readSchema(db);
      expect(schema.fields).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      expect(schema).not.toHaveProperty('__migration141');
    });

    it('down() leaves a form up() never touched alone', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const db = await freshDb();
      const edited = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as any[]).map((f) => (f.id === 'fld-ord-notes' ? { ...f, displayLabel: 'Notes' } : f));
      await seedOrderForm(db, edited);
      await up(db);
      await down(db);
      expect((await readSchema(db)).fields).toEqual(edited);
    });
  });

  describe('the Reception role', () => {
    it('becomes an ordinary role, keeping its keys and its users', async () => {
      const db = await freshDb();
      await seedReception(db);
      await up(db);
      expect(await receptionRow(db)).toEqual({ id: 'r-reception', is_system: false });
      expect(await capsOf(db, 'r-reception')).toEqual(['lab.receive', 'lab.reject', 'lab.worklist.view', 'patients.view']);
      expect(await usersOf(db, 'r-reception')).toEqual(['u-desk']);
    });

    it('does nothing when the install has no Reception role', async () => {
      const db = await freshDb();
      await up(db);
      expect(await receptionRow(db)).toBeUndefined();
      expect(await markerRow(db)).toBeUndefined();
    });

    it('down() makes it a system role again, keeping its keys and users', async () => {
      const db = await freshDb();
      await seedReception(db);
      await up(db);
      await down(db);
      expect(await receptionRow(db)).toEqual({ id: 'r-reception', is_system: true });
      expect(await capsOf(db, 'r-reception')).toEqual(['lab.receive', 'lab.reject', 'lab.worklist.view', 'patients.view']);
      expect(await usersOf(db, 'r-reception')).toEqual(['u-desk']);
      expect(await markerRow(db)).toBeUndefined();
    });

    it('down() leaves a Reception role the lab made itself alone', async () => {
      const db = await freshDb();
      await seedReception(db, false);
      await up(db);
      expect(await markerRow(db)).toBeUndefined();
      await down(db);
      expect(await receptionRow(db)).toEqual({ id: 'r-reception', is_system: false });
    });

    it('down() leaves a newer Reception role alone when the one up() changed was deleted', async () => {
      const db = await freshDb();
      await seedReception(db);
      await up(db);
      await db.deleteFrom('user_roles').where('role_id', '=', 'r-reception').execute();
      await db.deleteFrom('role_capabilities').where('role_id', '=', 'r-reception').execute();
      await db.deleteFrom('roles').where('id', '=', 'r-reception').execute();
      await seedReception(db, false, 'r-new-reception');
      await down(db);
      expect(await receptionRow(db)).toEqual({ id: 'r-new-reception', is_system: false });
    });
  });
});
