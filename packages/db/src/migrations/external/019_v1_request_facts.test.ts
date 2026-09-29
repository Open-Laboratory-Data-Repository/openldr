import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { sql } from 'kysely';

describe('019_v1_request_facts', () => {
  it('round-trips the new lab_requests facts', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_requests (id, request_id, obr_set_id, analysis_at, point_of_care, request_type,
        registered_by, tested_by, requester_practitioner, age_years, age_days, clinical_info, analyzer_code,
        rejection_code, rejection_reason)
      values ('sr-1', 'TDS0012345', 2, '2018-06-01T10:00:00+03:00', 'KCMC~Medical Ward 2', 'D',
        'AB', 'CD', 'Dr Mushi', 34, 12418, 'fever', 'ALINK', 'R01', 'Haemolysed')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select obr_set_id, age_years, age_days, point_of_care, rejection_reason
      from lab_requests where id = 'sr-1'`.execute(db);
    expect(rows.rows).toEqual([{ obr_set_id: 2, age_years: 34, age_days: 12418, point_of_care: 'KCMC~Medical Ward 2', rejection_reason: 'Haemolysed' }]);
  });

  it('adds section_code and authorised_by to diagnostic_reports', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into diagnostic_reports (id, section_code, authorised_by) values ('dr-1', 'HM', 'Dr Kimaro')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select section_code, authorised_by from diagnostic_reports`.execute(db);
    expect(rows.rows).toEqual([{ section_code: 'HM', authorised_by: 'Dr Kimaro' }]);
  });

  it('creates lab_request_attributes with typed value columns', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_request_attributes (id, lab_request_id, system, code, value_text, value_number, value_datetime, value_boolean)
      values ('a-1', 'sr-1', 'urn:openldr:cs:request-attribute', 'cost-units', null, 12.5, null, null),
             ('a-2', 'sr-1', 'urn:openldr:cs:request-attribute', 'newborn', null, null, null, true)`.execute(db);
    const rows = await sql<Record<string, unknown>>`select code, value_number, value_boolean from lab_request_attributes order by code`.execute(db);
    expect(rows.rows).toEqual([
      { code: 'cost-units', value_number: 12.5, value_boolean: null },
      { code: 'newborn', value_number: null, value_boolean: true },
    ]);
  });

  it('leaves every new column NULL when a request carries none of them', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_requests (id, request_id) values ('sr-2', 'TDS0012346')`.execute(db);
    const rows = await sql<Record<string, unknown>>`select analysis_at, obr_set_id, analyzer_code from lab_requests where id = 'sr-2'`.execute(db);
    expect(rows.rows).toEqual([{ analysis_at: null, obr_set_id: null, analyzer_code: null }]);
  });
});
