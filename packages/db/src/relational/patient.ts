import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { PatientsTable, PatientIdentifiersTable } from '../schema/external';
import { provColumns, firstIdentifier, str, reference } from './extract';
import { boundedRowId } from './row-id';

const SEX: Record<string, string> = { male: 'M', female: 'F', other: 'O', unknown: 'U' };

export function projectPatient(r: Record<string, unknown>, prov: Provenance): Insertable<PatientsTable> {
  const idn = firstIdentifier(r);
  const name = (r['name'] as Record<string, unknown>[] | undefined)?.[0];
  const telecom = (r['telecom'] as Record<string, unknown>[] | undefined) ?? [];
  const gender = str(r['gender']);
  return {
    id: String(r['id']),
    patient_guid: idn.value,
    surname: str(name?.['family']),
    firstname: str((name?.['given'] as string[] | undefined)?.[0]),
    date_of_birth: str(r['birthDate']),
    sex: gender ? (SEX[gender] ?? 'U') : null,
    national_id: null,
    phone: str(telecom.find((t) => t['system'] === 'phone')?.['value']),
    email: str(telecom.find((t) => t['system'] === 'email')?.['value']),
    managing_organization: reference(r['managingOrganization']),
    active: r['active'] === undefined || r['active'] === null ? true : Boolean(r['active']),
    replaced_by_id: (() => {
      const links = (r['link'] as Record<string, unknown>[] | undefined) ?? [];
      const rep = links.find((l) => l['type'] === 'replaced-by');
      const ref = (rep?.['other'] as Record<string, unknown> | undefined)?.['reference'];
      return typeof ref === 'string' && ref.startsWith('Patient/') ? ref.slice('Patient/'.length) : null;
    })(),
    ...provColumns(prov),
  };
}

/** One row per `Patient.identifier` with a value (patient index spec, section 1). A repeated
 *  (system, value) keeps one row: the id is derived from (patient, system, value), so two rows would
 *  collide on insert (Postgres and SQL Server reject the duplicate key; pg-mem does not). */
export function projectPatientIdentifiers(
  r: Record<string, unknown>, prov: Provenance,
): Insertable<PatientIdentifiersTable>[] {
  const patientId = String(r['id']);
  const identifiers = (r['identifier'] as Record<string, unknown>[] | undefined) ?? [];
  const byId = new Map<string, Insertable<PatientIdentifiersTable>>();
  for (const idn of identifiers) {
    const value = str(idn['value']);
    if (!value) continue;
    const system = str(idn['system']) || null;
    const type = idn['type'] as Record<string, unknown> | undefined;
    const coding = (type?.['coding'] as Record<string, unknown>[] | undefined)?.[0];
    const id = boundedRowId([patientId, system ?? '', value], 'pid');
    byId.set(id, {
      id,
      patient_id: patientId,
      system,
      value,
      type_code: str(coding?.['code']),
      type_text: str(type?.['text']) ?? str(coding?.['display']),
      use: str(idn['use']),
      ...provColumns(prov),
    });
  }
  return [...byId.values()];
}
