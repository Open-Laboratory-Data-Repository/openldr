import { describe, it, expect } from 'vitest';
import { designBoundColumns } from './index';
import { simpleTableDesign } from '@openldr/reporting';

// REGRESSION: the SQL runners build a result's column list from the FIRST ROW
// (`rows[0] ? Object.keys(rows[0]) : []`). A report whose query legitimately matches nothing
// therefore reported ZERO columns, which downstream is indistinguishable from "this report has no
// columns" — the DHIS2 mapping screen's Org-unit/Period pickers showed nothing selectable and no
// mapping could be authored against `AMR Resistance by Facility`, the report that exists
// specifically to feed the DHIS2 aggregate push.
describe('designBoundColumns', () => {
  const design = simpleTableDesign({
    id: 'rt-amr-facility-summary',
    name: 'AMR Resistance by Facility',
    queryId: 'q-amr-facility-summary',
    columns: [
      { key: 'facility', label: 'Facility' },
      { key: 'tested', label: 'Tested' },
      { key: 'resistant', label: 'Resistant' },
    ],
    parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange', required: true }],
  });

  it('recovers the declared columns of the table bound to the query', () => {
    expect(designBoundColumns(design, 'q-amr-facility-summary')).toEqual([
      { key: 'facility', label: 'Facility' },
      { key: 'tested', label: 'Tested' },
      { key: 'resistant', label: 'Resistant' },
    ]);
  });

  it('returns the org-unit column the DHIS2 mapping needs, for a report that matched no rows', () => {
    // The exact failure: 0 rows -> 0 columns -> "Org-unit column" picker had nothing to offer.
    const recovered = designBoundColumns(design, 'q-amr-facility-summary');
    expect(recovered.map((c) => c.key)).toContain('facility');
  });

  it('does not borrow columns from a table bound to a DIFFERENT query', () => {
    expect(designBoundColumns(design, 'q-some-other-query')).toEqual([]);
  });

  it('returns empty for a design with no table elements, rather than throwing', () => {
    const bare = { id: 'd', name: 'd', paper: 'A4', orientation: 'portrait', parameters: [], pages: [], pageNumbers: true } as never;
    expect(designBoundColumns(bare, 'q-anything')).toEqual([]);
  });
});
