import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconciliationSummary, willWrite } from './ReconciliationSummary';
import type { FacilityImportResult } from '@/api';

// No `@/api` mock: this component fetches nothing any more. It reports; the deciding, and the
// fetching that serves it, moved to Mapping with `ValueMapPanel`.

/** Mirrors `ImportFacilitiesSheet.test.tsx`'s own `baseResult`: every field defaulted to "clean,
 *  nothing to reconcile", so a test overrides only what it is about. */
function baseResult(overrides: Partial<FacilityImportResult> = {}): FacilityImportResult {
  return {
    parsed: 0, skipped: 0, unknownColumns: [], duplicateColumns: [], columnMapErrors: [],
    quarantined: [], invalid: [], duplicates: 0, blocked: false, blockedReason: null,
    create: 0, changed: 0, unchanged: 0, conflict: null, absent: null, deleted: 0,
    samples: { create: [], changed: [], conflict: [], absent: [], deleted: [] },
    written: { created: 0, updated: 0, retired: 0 }, runId: null, knownNationalSystem: true,
    meta: null, countMismatch: [], releaseVersion: null,
    unmapped: { level: [], status: [], country: [] }, notValidated: [],
    ...overrides,
  };
}

const props = {
  unknownColumnsOverridden: false,
  showConflictChoice: false, overCap: false, reupload: null,
  nationalSystem: 'urn:zm:mfl', onValueMappingsSaved: vi.fn(),
};

describe('ReconciliationSummary', () => {
  it('renders a result without throwing', () => {
    render(<ReconciliationSummary {...props} result={baseResult({ parsed: 10, create: 3, changed: 2 })} />);
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('reports a column-map refusal', () => {
    render(
      <ReconciliationSummary
        {...props}
        result={baseResult({
          blocked: true, blockedReason: 'column-map',
          columnMapErrors: [{ reason: 'duplicate_target', subject: 'Zone', target: 'zone', other: 'Province' }],
        })}
      />,
    );
    expect(screen.getByText(/Zone/)).toBeInTheDocument();
  });

  // ⛔ THE MEASURABLE END STATE of this slice. Review reports; it decides nothing. The only
  // interactive thing left is the value-mapping panel, which Task 4 moves to Mapping too; once it
  // has, this assertion tightens to "no control at all".
  it('renders no control at all: Review reports, it does not decide', () => {
    render(<ReconciliationSummary {...props} result={baseResult({
      parsed: 10, create: 3, deleted: 4, absent: 5,
      unknownColumns: ['Catchment'], quarantined: [{ line: 2, raw: 'x', reason: 'too_few_fields' }],
      invalid: [{ line: 3, field: 'latitude', raw: 'abc' }],
      unmapped: { level: ['Health Centre'], status: [], country: [] },
    } as never)} />);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('still REPORTS the unmapped values, and says where to fix them', () => {
    render(<ReconciliationSummary {...props} result={baseResult({
      parsed: 3, create: 3, unmapped: { level: ['Health Centre'], status: [], country: [] },
    } as never)} />);
    expect(screen.getByText(/health centre/i)).toBeInTheDocument();
    expect(screen.getByText(/map them on the mapping step/i)).toBeInTheDocument();
  });
});

describe('willWrite', () => {
  // ⛔ `create + changed`, never `parsed - duplicates`. An `unchanged` row is accepted and writes
  // nothing; a `conflict` row is accepted and is skipped. See the constant's own comment.
  it('counts only the rows an apply would actually write', () => {
    expect(willWrite(baseResult({ parsed: 100, create: 3, changed: 2, unchanged: 90, conflict: 5 }))).toBe(5);
  });
});
