import { type Kysely } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import type { VsCompose } from '../../value-set-expander';

// Lab module slice 3: return a request, reject a sample, redraw
// (docs/superpowers/plans/2026-11-23-lab-slice-3.md, rulings 3, 9 and 10). Three changes.
//
// 1. The lab's task codes: a code system with two codes and a ValueSet that includes it, seeded the
//    way 137 seeds the return reasons, with no fhir.change_log row, so none syncs. HL7's task-code
//    has no "recollect", so the codes are local. They are workflow constants, like the desk origin,
//    and source code names them (packages/forms/src/extract/order-ids.ts).
//
// 2. The Lab Technician system role gains lab.reject. seedSystemRoles() grants a preset key only
//    when the capability ledger (067) has never seen it, and lab.reject entered the ledger in slice
//    1a. So a preset change alone reaches fresh installs only, and this grant reaches upgraded ones,
//    as 066 did for forms.submit. It runs once, as every migration does. The boot seed that runs on
//    every start does not grant it again, so a lab that removes it keeps that decision. A custom
//    role is not touched.
//
// 3. The Lab order loses its rejection field (fld-ord-rejection). 138 kept it until the lab's
//    rejection page shipped, and it ships in this slice. Same exact-match, marker and down()
//    discipline as 138: only a row still carrying 138's shape is rewritten. The field was the last
//    one, so the other fields keep their order numbers. Another form that carries the field keeps it.
//
// Values are inlined, not imported: a migration is a frozen record of one release.
export const LAB_TASK_SYSTEM = 'urn:openldr:cs:lab-task';
export const LAB_TASK_VALUE_SET = 'urn:openldr:valueset:lab-task';
const PUBLISHER_ID = 'pub-system';

// The id follows `codingSystems.upsertByUrl`'s `cs-url-${systemCode}`, as 137's do.
const SYSTEM = { id: 'cs-url-LAB-TASK', system_code: 'LAB-TASK', system_name: 'Lab tasks', url: LAB_TASK_SYSTEM, publisher_id: PUBLISHER_ID };

const TASK_CODES = [
  { code: 'correct-request', display: 'Correct the request' },
  { code: 'recollect-sample', display: 'Collect a new sample' },
];

const VALUE_SET = {
  id: 'vs-lab-task', url: LAB_TASK_VALUE_SET, name: 'lab-task',
  title: 'Lab tasks', description: 'What the lab asks a site to do: correct a request, or collect a new sample.',
  compose: { include: [{ system: LAB_TASK_SYSTEM }] } as VsCompose,
};

const TECHNICIAN_SLUG = 'lab_technician';
const REJECT_KEY = 'lab.reject';

/** 138's shipped Lab order shape, copied verbatim, not imported. */
export const LAB_ORDER_PREV_FIELDS_SNAPSHOT: readonly unknown[] = [
    {
      "id": "patient",
      "fhirPath": "ServiceRequest.subject",
      "displayLabel": "Patient",
      "description": null,
      "fieldType": "reference",
      "required": true,
      "enabled": true,
      "order": 0,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "patient",
      "referenceTarget": "Patient",
      "placeholder": "Search by name, ID, or phone\u2026"
    },
    {
      "id": "tests",
      "fhirPath": "ServiceRequest.code",
      "displayLabel": "Tests",
      "description": null,
      "fieldType": "reference",
      "required": true,
      "enabled": true,
      "order": 1,
      "cardinality": {
        "min": 1,
        "max": "*"
      },
      "referenceMultiple": true,
      "section": "order",
      "placeholder": "Search tests\u2026",
      "valueSetUrl": "urn:openldr:valueset:lab-tests"
    },
    {
      "id": "fld-ord-priority",
      "fhirPath": "ServiceRequest.priority",
      "displayLabel": "Priority",
      "description": null,
      "fieldType": "select",
      "required": true,
      "enabled": true,
      "order": 2,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "valueSetOptions": [
        {
          "code": "routine",
          "display": "Routine"
        },
        {
          "code": "urgent",
          "display": "Urgent"
        },
        {
          "code": "asap",
          "display": "ASAP"
        },
        {
          "code": "stat",
          "display": "STAT"
        }
      ]
    },
    {
      "id": "fld-ord-ward",
      "fhirPath": "ServiceRequest.locationCode.0",
      "displayLabel": "Ward / Department",
      "description": null,
      "fieldType": "select",
      "required": false,
      "enabled": true,
      "order": 3,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "valueSetOptions": [
        {
          "code": "opd",
          "display": "OPD"
        },
        {
          "code": "ipd",
          "display": "IPD"
        },
        {
          "code": "icu",
          "display": "ICU"
        }
      ]
    },
    {
      "id": "fld-ord-clinician",
      "fhirPath": "ServiceRequest.requester",
      "displayLabel": "Requesting Clinician",
      "description": null,
      "fieldType": "text",
      "required": false,
      "enabled": true,
      "order": 4,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "placeholder": "Dr. \u2026",
      "fhirDiscriminator": {
        "type": "Practitioner"
      }
    },
    {
      "id": "fld-ord-ref-number",
      "fhirPath": "ServiceRequest.identifier.value",
      "fhirDiscriminator": {
        "system": "urn:openldr:order:requisition"
      },
      "fhirValueField": "value",
      "displayLabel": "Reference Number",
      "description": "External requisition number",
      "fieldType": "text",
      "required": false,
      "enabled": true,
      "order": 5,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "placeholder": "REF-\u2026"
    },
    {
      "id": "fld-ord-notes",
      "fhirPath": "ServiceRequest.note.0.text",
      "displayLabel": "Clinical Notes",
      "description": "Clinical context, suspected diagnosis\u2026",
      "fieldType": "text",
      "required": false,
      "enabled": true,
      "order": 6,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order"
    },
    {
      "id": "fld-ord-ref-facility",
      "fhirPath": "ServiceRequest.requester",
      "displayLabel": "Referring Facility",
      "description": null,
      "fieldType": "facility",
      "required": false,
      "enabled": true,
      "order": 7,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "fhirDiscriminator": {
        "type": "Organization"
      },
      "referenceTarget": "urn:openldr:cs:facility-registry",
      "placeholder": "Search facilities by name or MFL ID\u2026"
    },
    {
      "id": "fld-ord-rejection",
      "fhirPath": "ServiceRequest.extension",
      "fhirDiscriminator": {
        "url": "urn:openldr:ext:rejection"
      },
      "displayLabel": "Order rejection",
      "description": null,
      "fieldType": "reference",
      "required": false,
      "enabled": true,
      "order": 8,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "valueSetUrl": "urn:openldr:valueset:order-reject-reason"
    }
  ];

/** The Lab order this release ships: 138's shape without the rejection field. Exported so
 *  packages/forms/src/samples/forms.test.ts can pin the CURRENT sample against it. */
export const LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT: readonly unknown[] =
  (LAB_ORDER_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[])
    .filter((f) => f.id !== 'fld-ord-rejection')
    .map((f, order) => ({ ...f, order }));

/** Mirrors 138's MARKER_KEY discipline. */
const MARKER_KEY = '__migration140';

interface Migration140Marker {
  prevFields: readonly unknown[];
}

async function seedTaskCodes(seedDb: Kysely<any>): Promise<void> {
  await seedDb.insertInto('coding_systems').values({
    ...SYSTEM, active: true, seeded: true, origin: 'core',
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
  for (const c of TASK_CODES) {
    await seedDb.insertInto('terminology_concepts').values({
      system: LAB_TASK_SYSTEM, code: c.code, display: c.display, status: 'ACTIVE', properties: null,
    } as never).onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
  }

  const vs = VALUE_SET;
  await seedDb.insertInto('value_sets').values({
    id: vs.id, url: vs.url, version: null, name: vs.name, title: vs.title, status: 'active',
    experimental: false, description: vs.description, compose: JSON.stringify(vs.compose) as never,
    immutable: false, category: null, publisher_id: PUBLISHER_ID, expanded_at: null,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

  const resource = valueSetToFhirResource({
    id: vs.id, url: vs.url, status: 'active', experimental: false, version: null,
    name: vs.name, title: vs.title, description: vs.description, compose: vs.compose,
  });
  await seedDb.insertInto('fhir.resource_history').values({
    resource_type: 'ValueSet', id: vs.id, version: 1, op: 'upsert', resource: JSON.stringify(resource),
  } as never).onConflict((oc) => oc.columns(['resource_type', 'id', 'version']).doNothing()).execute();
  await seedDb.insertInto('fhir.fhir_current').values({
    resource_type: 'ValueSet', id: vs.id, version: 1, version_id: '1',
  } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();

  await seedDb.insertInto('terminology_systems').values({
    url: vs.url, version: null, kind: 'ValueSet', resource_id: vs.id,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
}

/** The system Lab Technician role, if the install has one. A custom role under the slug is not it. */
async function technicianRoleId(seedDb: Kysely<any>): Promise<string | null> {
  const row = await seedDb.selectFrom('roles').select('id')
    .where('slug', '=', TECHNICIAN_SLUG).where('is_system', '=', true).executeTakeFirst() as { id: string } | undefined;
  return row?.id ?? null;
}

async function grantReject(seedDb: Kysely<any>): Promise<void> {
  // None yet on a fresh install: the boot seed then creates the role from its preset, which holds lab.reject.
  const roleId = await technicianRoleId(seedDb);
  if (!roleId) return;
  await seedDb.insertInto('role_capabilities').values({ role_id: roleId, capability: REJECT_KEY } as never)
    .onConflict((oc) => oc.columns(['role_id', 'capability']).doNothing()).execute();
}

/** Says why the Lab order was left alone, so an operator who edited it knows to remove the field by hand. */
function leftAlone(reason: string): void {
  console.warn(`migration 140: the Lab order form keeps its Order rejection field: ${reason}`);
}

async function dropRejectionField(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  if (rows.length === 0) return; // none seeded yet: the seed ships the form without the field
  if (rows.length > 1) {
    leftAlone(`${rows.length} forms are named "Lab order", and this migration will not guess which one is the shipped form.`);
    return;
  }
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    leftAlone('the form has no fields.');
    return;
  }

  // Already rewritten: a second run changes nothing and says nothing.
  if (stableStringify(fields) === stableStringify(LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT)) return;

  // Only rewrites a row that exactly matches 138's shape. Anything else is an edit by the lab, and
  // is left alone.
  if (stableStringify(fields) !== stableStringify(LAB_ORDER_PREV_FIELDS_SNAPSHOT)) {
    if (fields.some((f) => (f as Record<string, unknown> | null)?.id === 'fld-ord-rejection')) {
      leftAlone('the form was edited after it shipped. Remove the Order rejection field in the form builder.');
    }
    return;
  }

  const marker: Migration140Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: LAB_ORDER_NO_REJECTION_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function restoreRejectionField(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration140Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await seedTaskCodes(seedDb);
  await grantReject(seedDb);
  await dropRejectionField(seedDb);
}

// Removes what up() writes, by the exact ids and codes it writes, as 137's down() does. The seeded
// concepts go only when coding_systems holds the system's url under 140's id, so up() created it. A
// concept a lab added later stays. The technician loses lab.reject: a system technician role that
// held it before 140 cannot be told apart from one up() granted, and loses it too. Reception, Lab
// Manager and custom roles keep theirs.
export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await restoreRejectionField(seedDb);

  const roleId = await technicianRoleId(seedDb);
  if (roleId) {
    await seedDb.deleteFrom('role_capabilities').where('role_id', '=', roleId).where('capability', '=', REJECT_KEY).execute();
  }

  const vs = VALUE_SET;
  await seedDb.deleteFrom('terminology_systems').where('url', '=', vs.url).where('resource_id', '=', vs.id).execute();
  await seedDb.deleteFrom('fhir.fhir_current').where('resource_type', '=', 'ValueSet').where('id', '=', vs.id).execute();
  await seedDb.deleteFrom('fhir.resource_history').where('resource_type', '=', 'ValueSet').where('id', '=', vs.id).execute();
  await seedDb.deleteFrom('value_sets').where('id', '=', vs.id).execute();

  const held = await seedDb.selectFrom('coding_systems').select(['id', 'url'])
    .where('id', '=', SYSTEM.id).executeTakeFirst() as { id: string; url: string | null } | undefined;
  if (held?.url === SYSTEM.url) {
    for (const c of TASK_CODES) {
      await seedDb.deleteFrom('terminology_concepts').where('system', '=', LAB_TASK_SYSTEM).where('code', '=', c.code).execute();
    }
  }
  await seedDb.deleteFrom('coding_systems').where('id', '=', SYSTEM.id).execute();
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 138, not imported:
 *  importing a private helper across migration files would couple two frozen snapshots. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}
