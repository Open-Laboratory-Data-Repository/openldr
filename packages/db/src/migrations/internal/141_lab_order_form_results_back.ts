import { type Kysely } from 'kysely';

// Lab plugin step 1: CE works alone again (docs/superpowers/plans/2026-11-23-lab-plugin-step1-ce-cleanup.md,
// rulings 3 and 9). The lab module moves into a plugin, so CE takes back two things the lab slices
// took from it. Two changes.
//
// 1. The Lab order form enters results and rejections again. 138 dropped the Results field
//    (fld-ord-results) and 140 dropped the Order rejection field (fld-ord-rejection). This puts both
//    back, with the field list and order numbers the form had before 138. Same exact-match, marker
//    and down() discipline as 138 and 140: only a row still carrying 140's shape is rewritten. A
//    form the lab edited after 140 is left alone, with a warning, so an operator knows to add the
//    fields by hand.
//
// 2. The Reception role becomes an ordinary role. Slice 2's preset made it a system role, so an
//    admin could not delete it. This clears is_system on slug `reception` and keeps its keys and its
//    users. down() makes it a system role again only when up() changed it: up() records the role id
//    in app_settings under RECEPTION_MARKER_KEY, and down() reads it back.
//
// The starter packs need nothing here. Boot rewrites the seeded packs from the bundled ones, as it
// did for 138 and 140, and the bundled packs move to version 8 with this release.
//
// Values are inlined, not imported: a migration is a frozen record of one release.

/** The Lab order this release ships: the shape before 138, copied verbatim from 138, not imported.
 *  Exported so packages/forms/src/samples/forms.test.ts can pin the CURRENT sample against it. */
export const LAB_ORDER_RESULTS_BACK_FIELDS_SNAPSHOT: readonly unknown[] = [
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
      "id": "fld-ord-results",
      "fhirPath": null,
      "displayLabel": "Results",
      "description": null,
      "fieldType": "testDetails",
      "required": false,
      "enabled": true,
      "order": 2,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "referenceDependsOn": "tests"
    },
    {
      "id": "fld-ord-priority",
      "fhirPath": "ServiceRequest.priority",
      "displayLabel": "Priority",
      "description": null,
      "fieldType": "select",
      "required": true,
      "enabled": true,
      "order": 3,
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
      "order": 4,
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
      "order": 5,
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
      "order": 6,
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
      "order": 7,
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
      "order": 8,
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
      "order": 9,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "valueSetUrl": "urn:openldr:valueset:order-reject-reason"
    }
  ];

/** 140's shipped Lab order shape: the shape above without the two fields, numbered with no gap. */
export const LAB_ORDER_PREV_FIELDS_SNAPSHOT: readonly unknown[] =
  (LAB_ORDER_RESULTS_BACK_FIELDS_SNAPSHOT as Record<string, unknown>[])
    .filter((f) => f.id !== 'fld-ord-results' && f.id !== 'fld-ord-rejection')
    .map((f, order) => ({ ...f, order }));

/** Mirrors 138's and 140's MARKER_KEY discipline. */
const MARKER_KEY = '__migration141';

interface Migration141Marker {
  prevFields: readonly unknown[];
}

/** The app_settings row that holds the id of the Reception role up() made ordinary. */
export const RECEPTION_MARKER_KEY = 'migration141.reception_role_id';
const RECEPTION_SLUG = 'reception';

/** Says why the Lab order was left alone, so an operator who edited it knows to add the fields by hand. */
function leftAlone(reason: string): void {
  console.warn(`migration 141: the Lab order form keeps its fields as they are: ${reason}`);
}

async function restoreFields(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  if (rows.length === 0) return; // none seeded yet: the seed ships the form with both fields
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
  if (stableStringify(fields) === stableStringify(LAB_ORDER_RESULTS_BACK_FIELDS_SNAPSHOT)) return;

  // Only rewrites a row that exactly matches 140's shape. Anything else is an edit by the lab, and
  // is left alone.
  if (stableStringify(fields) !== stableStringify(LAB_ORDER_PREV_FIELDS_SNAPSHOT)) {
    leftAlone('the form was edited after it shipped. Add the Results and Order rejection fields in the form builder if the lab wants them.');
    return;
  }

  const marker: Migration141Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: LAB_ORDER_RESULTS_BACK_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function undoRestoreFields(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration141Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

async function makeReceptionOrdinary(seedDb: Kysely<any>): Promise<void> {
  // A Reception role that is already ordinary was made by the lab, or by a first run of up(). Either
  // way there is nothing to change and nothing to record.
  const role = await seedDb.selectFrom('roles').select('id')
    .where('slug', '=', RECEPTION_SLUG).where('is_system', '=', true).executeTakeFirst() as { id: string } | undefined;
  if (!role) return;
  await seedDb.updateTable('roles').set({ is_system: false } as never).where('id', '=', role.id).execute();
  await seedDb.insertInto('app_settings').values({ key: RECEPTION_MARKER_KEY, value: role.id, updated_by: 'migration 141' } as never)
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: role.id } as never)).execute();
}

async function undoReceptionOrdinary(seedDb: Kysely<any>): Promise<void> {
  const marker = await seedDb.selectFrom('app_settings').select('value')
    .where('key', '=', RECEPTION_MARKER_KEY).executeTakeFirst() as { value: string } | undefined;
  if (!marker) return; // up() changed no role
  // Only the role up() changed, and only while it still holds the slug. A Reception role made after
  // that one was deleted is the lab's, and stays ordinary.
  await seedDb.updateTable('roles').set({ is_system: true } as never)
    .where('id', '=', marker.value).where('slug', '=', RECEPTION_SLUG).execute();
  await seedDb.deleteFrom('app_settings').where('key', '=', RECEPTION_MARKER_KEY).execute();
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await restoreFields(seedDb);
  await makeReceptionOrdinary(seedDb);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await undoReceptionOrdinary(seedDb);
  await undoRestoreFields(seedDb);
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 140, not imported:
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
