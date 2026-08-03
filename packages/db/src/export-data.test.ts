import { describe, it, expect } from 'vitest';
import { EXTERNAL_TABLE_COLUMNS } from './schema/external';

describe('EXTERNAL_TABLE_COLUMNS', () => {
  // Exhaustive on purpose: EXTERNAL_TABLE_COLUMNS feeds the Data Exposure policy
  // (dashboards/column-policy-store) and the widget builder's column/join surfaces, so a table
  // arriving here silently widens what an operator can be shown. Adding one must be deliberate.
  it('covers the 7 canonical fact tables plus the terminology dimension', () => {
    expect(Object.keys(EXTERNAL_TABLE_COLUMNS).sort()).toEqual(
      ['diagnostic_reports', 'facilities', 'lab_requests', 'lab_results', 'patients', 'questionnaire_responses', 'specimens', 'terminology_codes'],
    );
  });
  it('every table includes id + provenance columns', () => {
    for (const cols of Object.values(EXTERNAL_TABLE_COLUMNS)) {
      expect(cols).toContain('id');
      expect(cols).toContain('source_system');
      expect(cols).toContain('batch_id');
    }
  });
});
