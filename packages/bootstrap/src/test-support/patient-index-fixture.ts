import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createHash } from 'node:crypto';
import { DataType } from 'pg-mem';
import { makeMigratedExternalDbWithMem } from '@openldr/db/testing-external';
import {
  createFhirStore, createTerminologyStore, createTerminologyAdminStore,
  patientMatchKey, type ExternalSchema, type ValueSetProjection,
} from '@openldr/db';
import { createPatientIdentifierSystems } from '../patient-identifier-systems';

// Shared by the patient index tests: a migrated internal db with the real terminology admin store,
// a migrated warehouse, and seed helpers that write warehouse rows directly.

export async function buildPatientIndexFixture() {
  const internalDb = await makeMigratedDb();
  const { db: memDb, mem } = await makeMigratedExternalDbWithMem();
  // pg-mem has no md5(). The masked list orders by md5(id) (patient-index.ts, neutralOrder), so the
  // fake gets the same function Postgres and MySQL have.
  mem.public.registerFunction({
    name: 'md5', args: [DataType.text], returns: DataType.text,
    implementation: (v: string) => createHash('md5').update(v).digest('hex'),
  });
  const externalDb = memDb as unknown as Kysely<ExternalSchema>;
  const fhirStore = createFhirStore(internalDb);
  const store = createTerminologyStore(internalDb, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(resource) {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url, version, kind, resourceId) { await store.saveSystem(url, version, kind, resourceId); },
    async deleteValueSetResource(url, id) {
      await fhirStore.delete('ValueSet', id);
      await internalDb.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const admin = createTerminologyAdminStore(internalDb, projection);
  const systems = createPatientIdentifierSystems({ internalDb, externalDb, admin });
  return { internalDb, externalDb, admin, systems };
}

export async function seedPatient(db: Kysely<ExternalSchema>, p: {
  id: string; surname?: string | null; firstname?: string | null; dob?: string | null; sex?: string | null;
  guid?: string | null; phone?: string | null; email?: string | null; org?: string | null;
  active?: boolean; replacedBy?: string | null;
}) {
  await db.insertInto('patients').values({
    id: p.id, patient_guid: p.guid ?? null, surname: p.surname ?? null, firstname: p.firstname ?? null,
    date_of_birth: p.dob ?? null, sex: p.sex ?? null, national_id: null, phone: p.phone ?? null,
    email: p.email ?? null, managing_organization: p.org ?? null, active: p.active ?? true,
    match_key: patientMatchKey(p.surname ?? null, p.firstname ?? null, p.dob ?? null),
    replaced_by_id: p.replacedBy ?? null, source_system: null, plugin_id: null, plugin_version: null, batch_id: null,
  }).execute();
}

export async function seedIdentifier(db: Kysely<ExternalSchema>, patientId: string, system: string | null, value: string, typeText: string | null = null) {
  await db.insertInto('patient_identifiers').values({
    id: `${patientId}|${system ?? ''}|${value}`, patient_id: patientId, system, value,
    type_code: null, type_text: typeText, use: null,
    source_system: null, plugin_id: null, plugin_version: null, batch_id: null,
  }).execute();
}

export async function seedRequest(db: Kysely<ExternalSchema>, r: {
  id: string; patientId: string; authoredAt?: string | null; panel?: string | null; requester?: string | null; status?: string | null;
}) {
  await db.insertInto('lab_requests').values({
    id: r.id, patient_id: r.patientId, authored_at: r.authoredAt ?? null, panel_code: r.panel ?? null,
    panel_desc: r.panel ?? null, requester_display: r.requester ?? null, status: r.status ?? null,
  } as never).execute();
}

export async function seedResult(db: Kysely<ExternalSchema>, id: string, requestId: string, status: string | null = 'final') {
  await db.insertInto('lab_results').values({ id, request_id: requestId, status } as never).execute();
}
