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
  //
  // ingest_events is included deliberately too: it is the durable per-arrival ledger (migration
  // 016), keyed on (resource_type, resource_id, version) rather than a synthetic id, and carries
  // no ProvenanceColumns -- see IngestEventsTable's doc comment in schema/external.ts for why.
  it('covers the 7 canonical fact tables, the terminology dimension, the facility_map dimension, and the ingest_events ledger', () => {
    expect(Object.keys(EXTERNAL_TABLE_COLUMNS).sort()).toEqual(
      ['diagnostic_reports', 'facilities', 'facility_map', 'ingest_events', 'lab_requests', 'lab_results', 'patients', 'questionnaire_responses', 'specimens', 'terminology_codes'],
    );
  });
  it('every table includes id + provenance columns', () => {
    // facility_map is a rebuilt projection, not an ingest fact table: there is no batch that
    // produced it, so it has no batch_id and is excepted from that requirement here. It still
    // carries id and source_system, but source_system there means the *feed identity* the
    // observed facility code came from -- a different meaning from the ingest provenance the
    // other tables carry. Name it explicitly rather than exempting "any table without
    // batch_id", so the next table that forgets its provenance columns still fails this test.
    //
    // ingest_events has no synthetic id and no provenance columns at all: its primary key is the
    // three-part natural key (resource_type, resource_id, version), and it deliberately does not
    // extend ProvenanceColumns (see the migration's doc comment). Named explicitly, same reasoning
    // as facility_map above.
    for (const [table, cols] of Object.entries(EXTERNAL_TABLE_COLUMNS)) {
      if (table === 'ingest_events') continue;
      expect(cols).toContain('id');
      expect(cols).toContain('source_system');
      if (table === 'facility_map') continue;
      expect(cols).toContain('batch_id');
    }
  });
  it('carries all three parts of facility_map\'s natural key', () => {
    // The dimension is keyed on the raw observed wire tuple (feed, namespace, code). Dropping any
    // part from this list would hide it from the Data Exposure policy and any consumer that reads
    // the column set rather than the table.
    for (const col of ['source_system', 'performer_system', 'source_code']) {
      expect(EXTERNAL_TABLE_COLUMNS.facility_map).toContain(col);
    }
  });
});
