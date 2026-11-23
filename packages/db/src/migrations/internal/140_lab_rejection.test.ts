import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { createRoleStore } from '../../role-store';
import {
  LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT,
  LAB_ORDER_PREV_FIELDS_SNAPSHOT,
  LAB_TASK_SYSTEM,
  LAB_TASK_VALUE_SET,
  up,
  down,
} from './140_lab_rejection';
// Imported to PROVE this migration's frozen copy still matches what 138 left. The migration itself
// must never import it.
import { LAB_ORDER_ORDERS_ONLY_FIELDS_SNAPSHOT as SHIPPED_138 } from './138_lab_order_form_orders_only';

const ids = (fields: unknown) => (fields as any[]).map((f) => f.id);

async function seedOrderForm(db: any, fields: readonly unknown[], id = 'form-sample-order'): Promise<void> {
  await db.insertInto('form_definitions').values({
    id, name: 'Lab order', status: 'published', active: true,
    target_pages: JSON.stringify(['forms']),
    schema: JSON.stringify({ id, name: 'Lab order', fields, targetPages: ['forms'] }),
  } as never).execute();
}

async function readFields(db: any, id = 'form-sample-order'): Promise<unknown> {
  const row = await db.selectFrom('form_definitions').select('schema').where('id', '=', id).executeTakeFirst();
  const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
  return schema.fields;
}

async function freshDb(): Promise<any> {
  const db = await makeMigratedDb();
  await db.deleteFrom('form_definitions').where('name', '=', 'Lab order').execute();
  return db;
}

/** Roles as an existing install has them after slice 1a: the technician without lab.reject. */
async function seedRoles(db: any): Promise<void> {
  const roles: Array<[string, string, boolean, string[]]> = [
    ['r-tech', 'lab_technician', true, ['forms.view', 'forms.submit', 'lab.results.enter', 'lab.worklist.view']],
    ['r-reception', 'reception', true, ['lab.receive', 'lab.reject', 'lab.worklist.view', 'patients.view']],
    ['r-manager', 'lab_manager', true, ['lab.receive', 'lab.reject']],
    ['r-custom', 'bench-clerks', false, ['lab.results.enter']],
  ];
  for (const [id, slug, isSystem, caps] of roles) {
    await db.insertInto('roles').values({ id, slug, name: slug, description: null, is_system: isSystem }).execute();
    for (const capability of caps) await db.insertInto('role_capabilities').values({ role_id: id, capability }).execute();
  }
}

async function capsOf(db: any, roleId: string): Promise<string[]> {
  const rows = await db.selectFrom('role_capabilities').select('capability').where('role_id', '=', roleId).execute();
  return (rows as Array<{ capability: string }>).map((r) => r.capability).sort();
}

async function taskConcepts(db: any): Promise<Array<{ code: string; display: string }>> {
  return db.selectFrom('terminology_concepts').select(['code', 'display']).where('system', '=', LAB_TASK_SYSTEM).orderBy('code').execute();
}

describe('140 lab rejection', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('task codes', () => {
    it('seeds the lab task code system with both codes', async () => {
      const db = await makeMigratedDb();
      expect(await db.selectFrom('coding_systems').select(['id', 'url']).where('url', '=', LAB_TASK_SYSTEM).execute())
        .toEqual([{ id: 'cs-url-LAB-TASK', url: LAB_TASK_SYSTEM }]);
      expect(await taskConcepts(db)).toEqual([
        { code: 'correct-request', display: 'Correct the request' },
        { code: 'recollect-sample', display: 'Collect a new sample' },
      ]);
    });

    it('registers a ValueSet over the system as a FHIR record, with no fhir.change_log row', async () => {
      const db = await makeMigratedDb();
      const vs = await db.selectFrom('value_sets').select(['id', 'immutable']).where('url', '=', LAB_TASK_VALUE_SET).executeTakeFirstOrThrow();
      expect(vs).toEqual({ id: 'vs-lab-task', immutable: false });
      expect(await db.selectFrom('terminology_systems').select(['kind', 'resource_id']).where('url', '=', LAB_TASK_VALUE_SET).executeTakeFirstOrThrow())
        .toEqual({ kind: 'ValueSet', resource_id: 'vs-lab-task' });
      const row = await db.selectFrom('fhir.fhir_resources').select('resource')
        .where('resource_type', '=', 'ValueSet').where('id', '=', 'vs-lab-task').executeTakeFirstOrThrow();
      const resource = typeof row.resource === 'string' ? JSON.parse(row.resource) : row.resource;
      expect(resource).toMatchObject({ resourceType: 'ValueSet', url: LAB_TASK_VALUE_SET, compose: { include: [{ system: LAB_TASK_SYSTEM }] } });
      expect(await db.selectFrom('fhir.change_log').select('seq').where('resource_type', '=', 'ValueSet').where('resource_id', '=', 'vs-lab-task').execute())
        .toEqual([]);
    });

    it('is safe to run twice', async () => {
      const db = await makeMigratedDb();
      await up(db);
      expect(await taskConcepts(db)).toHaveLength(2);
      expect(await db.selectFrom('value_sets').select('id').where('url', '=', LAB_TASK_VALUE_SET).execute()).toHaveLength(1);
    });
  });

  describe('Lab Technician gains lab.reject', () => {
    it('grants it to the system technician role, and to no custom role', async () => {
      const db = await makeMigratedDb();
      await seedRoles(db);
      await up(db);
      expect(await capsOf(db, 'r-tech')).toContain('lab.reject');
      expect(await capsOf(db, 'r-custom')).toEqual(['lab.results.enter']);
    });

    it('grants it once: a second run writes no second row', async () => {
      const db = await makeMigratedDb();
      await seedRoles(db);
      await up(db);
      await up(db);
      const rows = await db.selectFrom('role_capabilities').select('role_id')
        .where('role_id', '=', 'r-tech').where('capability', '=', 'lab.reject').execute();
      expect(rows).toHaveLength(1);
    });

    // The run that comes after this migration on every start is the boot seed. lab.reject is already
    // in the capability ledger, so the seed must not hand it back once a lab removes it.
    it('a lab that removes it later does not get it back when the roles are seeded again', async () => {
      const db = await makeMigratedDb();
      const store = createRoleStore(db);
      await store.seedSystemRoles();
      const tech = (await store.getBySlug('lab_technician'))!;
      await db.deleteFrom('role_capabilities').where('role_id', '=', tech.id).where('capability', '=', 'lab.reject').execute();
      await up(db);
      expect(await capsOf(db, tech.id)).toContain('lab.reject');

      await db.deleteFrom('role_capabilities').where('role_id', '=', tech.id).where('capability', '=', 'lab.reject').execute();
      await store.seedSystemRoles();
      expect(await capsOf(db, tech.id)).not.toContain('lab.reject');
    });
  });

  describe('the Lab order form drops its rejection field', () => {
    it("keeps a frozen copy equal to the form 138 left", () => {
      expect(LAB_ORDER_PREV_FIELDS_SNAPSHOT).toEqual(SHIPPED_138);
    });

    it('drops only the rejection field, and leaves no gap in the order', () => {
      expect(ids(LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT)).toEqual(ids(LAB_ORDER_PREV_FIELDS_SNAPSHOT).filter((id) => id !== 'fld-ord-rejection'));
      expect((LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT as any[]).map((f) => f.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it("removes the field from an unedited form", async () => {
      const db = await freshDb();
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      await up(db);
      expect(await readFields(db)).toEqual(LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT);
    });

    it('leaves an edited form alone, keeps its rejection field, and says why', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const db = await freshDb();
      const edited = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as any[]).map((f) => (f.id === 'fld-ord-notes' ? { ...f, displayLabel: 'Our notes' } : f));
      await seedOrderForm(db, edited);
      await up(db);
      expect(await readFields(db)).toEqual(edited);
      expect(ids(await readFields(db))).toContain('fld-ord-rejection');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('migration 140'));
    });

    it('leaves every form alone when two are named "Lab order", and says why', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const db = await freshDb();
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'a');
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT, 'b');
      await up(db);
      expect(await readFields(db, 'a')).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      expect(await readFields(db, 'b')).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 forms'));
    });

    it('a second run changes nothing and says nothing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const db = await freshDb();
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      await up(db);
      await up(db);
      expect(await readFields(db)).toEqual(LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT);
      expect(warn).not.toHaveBeenCalled();
    });

    it('leaves another form that carries the field alone', async () => {
      const db = await freshDb();
      await db.insertInto('form_definitions').values({
        id: 'other', name: 'Clinic order', status: 'published', active: true, target_pages: JSON.stringify(['forms']),
        schema: JSON.stringify({ id: 'other', name: 'Clinic order', fields: LAB_ORDER_PREV_FIELDS_SNAPSHOT, targetPages: ['forms'] }),
      } as never).execute();
      await up(db);
      expect(await readFields(db, 'other')).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
    });
  });

  describe('down', () => {
    it('undoes what up() did, and only that', async () => {
      const db = await freshDb();
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      await seedRoles(db);
      await up(db);
      await db.insertInto('terminology_concepts').values({
        system: LAB_TASK_SYSTEM, code: 'lab-own', display: 'A task of our own', status: 'ACTIVE', properties: null,
      }).execute();
      await down(db);

      // The form comes back as 138 left it.
      expect(await readFields(db)).toEqual(LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      const row = await db.selectFrom('form_definitions').select('schema').where('id', '=', 'form-sample-order').executeTakeFirst();
      expect(typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema).not.toHaveProperty('__migration140');

      // The technician loses lab.reject. Reception and the manager keep theirs.
      expect(await capsOf(db, 'r-tech')).not.toContain('lab.reject');
      expect(await capsOf(db, 'r-reception')).toContain('lab.reject');
      expect(await capsOf(db, 'r-manager')).toContain('lab.reject');

      // The seeded codes, system and ValueSet go. A lab-added concept stays.
      expect(await db.selectFrom('coding_systems').select('id').where('url', '=', LAB_TASK_SYSTEM).execute()).toEqual([]);
      expect(await db.selectFrom('value_sets').select('id').where('url', '=', LAB_TASK_VALUE_SET).execute()).toEqual([]);
      expect(await db.selectFrom('terminology_systems').select('url').where('url', '=', LAB_TASK_VALUE_SET).execute()).toEqual([]);
      expect(await db.selectFrom('fhir.fhir_resources').select('id').where('resource_type', '=', 'ValueSet').where('id', '=', 'vs-lab-task').execute())
        .toEqual([]);
      expect(await taskConcepts(db)).toEqual([{ code: 'lab-own', display: 'A task of our own' }]);
      // 137's lists are another migration's rows.
      expect(await db.selectFrom('value_sets').select('id').where('url', '=', 'urn:openldr:valueset:order-return-reason').execute())
        .toHaveLength(1);
    });

    it('leaves a form an operator re-saved after up()', async () => {
      const db = await freshDb();
      await seedOrderForm(db, LAB_ORDER_PREV_FIELDS_SNAPSHOT);
      await up(db);
      // A builder save writes the schema without the marker.
      await db.updateTable('form_definitions').set({
        schema: JSON.stringify({ id: 'form-sample-order', name: 'Lab order', fields: LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT, targetPages: ['forms'] }),
      } as never).where('id', '=', 'form-sample-order').execute();
      await down(db);
      expect(await readFields(db)).toEqual(LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT);
    });

    it('does not remove lab.reject from a custom role', async () => {
      const db = await makeMigratedDb();
      await seedRoles(db);
      await db.insertInto('role_capabilities').values({ role_id: 'r-custom', capability: 'lab.reject' }).execute();
      await up(db);
      await down(db);
      expect(await capsOf(db, 'r-custom')).toContain('lab.reject');
    });
  });
});
