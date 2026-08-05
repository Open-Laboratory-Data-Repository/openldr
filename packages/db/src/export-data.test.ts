import { describe, it, expect } from 'vitest';
import { EXTERNAL_TABLE_COLUMNS } from './schema/external';

describe('EXTERNAL_TABLE_COLUMNS', () => {
  // Exhaustive on purpose: EXTERNAL_TABLE_COLUMNS feeds the Data Exposure policy
  // (dashboards/column-policy-store) and the widget builder's column/join surfaces, so a table
  // arriving here silently widens what an operator can be shown. Adding one must be deliberate.
  //
  // facility_map is included deliberately: it is a curated dimension of resolved facility
  // names and admin geography, rebuilt by publishFacilityMap. It carries no patient data, and
  // it is exposed so reports, the query builder and custom SQL can join a canonical facility
  // name to diagnostic_reports.performer.
  it('covers the 7 canonical fact tables, the terminology dimension, and the facility_map dimension', () => {
    expect(Object.keys(EXTERNAL_TABLE_COLUMNS).sort()).toEqual(
      ['diagnostic_reports', 'facilities', 'facility_map', 'lab_requests', 'lab_results', 'patients', 'questionnaire_responses', 'specimens', 'terminology_codes'],
    );
  });
  it('every table includes id + provenance columns', () => {
    // facility_map is a rebuilt projection, not an ingest fact table: there is no batch that
    // produced it, so it has no batch_id and is excepted from that requirement here. It still
    // carries id and source_system, but source_system there means the *feed identity* the
    // observed facility code came from -- a different meaning from the ingest provenance the
    // other tables carry. Name it explicitly rather than exempting "any table without
    // batch_id", so the next table that forgets its provenance columns still fails this test.
    for (const [table, cols] of Object.entries(EXTERNAL_TABLE_COLUMNS)) {
      expect(cols).toContain('id');
      expect(cols).toContain('source_system');
      if (table === 'facility_map') continue;
      expect(cols).toContain('batch_id');
    }
  });
});
