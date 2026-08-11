import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getFacilityHistory: vi.fn(), expandValueSet: vi.fn() };
});

import { getFacilityHistory, expandValueSet, type FacilityHistoryEntry } from '@/api';
import { FacilityHistory } from './FacilityHistory';

const getFacilityHistoryMock = getFacilityHistory as ReturnType<typeof vi.fn>;
const expandValueSetMock = expandValueSet as ReturnType<typeof vi.fn>;

const STATUS_CODES = {
  codes: [
    { system: 'http://hl7.org/fhir/location-status', code: 'active', display: 'Active' },
    { system: 'http://hl7.org/fhir/location-status', code: 'suspended', display: 'Suspended' },
  ],
  total: 2,
};
const LEVEL_CODES = {
  codes: [
    { system: 'urn:openldr:cs:facility-type', code: 'dispensary', display: 'Dispensary' },
    { system: 'urn:openldr:cs:facility-type', code: 'health-center', display: 'Health Center' },
  ],
  total: 2,
};

function show(props: Partial<Parameters<typeof FacilityHistory>[0]> = {}) {
  return render(
    <FacilityHistory
      open
      onOpenChange={vi.fn()}
      facilityId="fac-1"
      facilityName="Dodoma RRH"
      {...props}
    />,
  );
}

describe('FacilityHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFacilityHistoryMock.mockResolvedValue({ rows: [] });
    // vs-location-status is requested first by the component (status before level) — mockImplementation
    // routes on the id so both hooks get their own real fixture regardless of call order.
    expandValueSetMock.mockImplementation((id: string) =>
      Promise.resolve(id === 'vs-location-status' ? STATUS_CODES : LEVEL_CODES));
  });

  it('fetches history for the given facility and renders rows newest-first with actor and action', async () => {
    const rows: FacilityHistoryEntry[] = [
      {
        occurredAt: '2026-08-10T09:00:00Z', actorName: 'jane', action: 'facility.update',
        before: { name: 'Dodoma RRH', phone: '+255700000000' },
        after: { name: 'Dodoma RRH', phone: '+255711111111' },
      },
      {
        occurredAt: '2026-08-01T09:00:00Z', actorName: 'jane', action: 'facility.create',
        before: null,
        after: { name: 'Dodoma RRH', phone: '+255700000000' },
      },
    ];
    getFacilityHistoryMock.mockResolvedValue({ rows });
    show();

    await waitFor(() => expect(getFacilityHistory).toHaveBeenCalledWith('fac-1'));
    expect(await screen.findByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    // Newest first: "Updated" (2026-08-10) must precede "Created" (2026-08-01) in the DOM.
    const items = screen.getAllByText(/^(Updated|Created)$/);
    expect(items.map((el) => el.textContent)).toEqual(['Updated', 'Created']);
    expect(screen.getAllByText('jane')).toHaveLength(2);
  });

  it('renders a before→after diff for a plain changed field', async () => {
    getFacilityHistoryMock.mockResolvedValue({
      rows: [{
        occurredAt: '2026-08-10T09:00:00Z', actorName: 'jane', action: 'facility.update',
        before: { phone: '+255700000000' },
        after: { phone: '+255711111111' },
      }],
    });
    show();
    expect(await screen.findByText('phone: +255700000000 → +255711111111')).toBeInTheDocument();
  });

  // Step 5 target: status/level must render their TERMINOLOGY DISPLAY LABEL in the diff, not the
  // stored code — verified against the real rendered copy the component produces (not a guess at
  // what it *should* say), and mutation-proved in the report by reverting the lookup and watching
  // this assertion go red.
  it('renders status and level diffs using their terminology display labels, not the stored codes', async () => {
    getFacilityHistoryMock.mockResolvedValue({
      rows: [{
        occurredAt: '2026-08-10T09:00:00Z', actorName: 'jane', action: 'facility.update',
        before: { status: 'active', level: 'dispensary' },
        after: { status: 'suspended', level: 'health-center' },
      }],
    });
    show();
    expect(await screen.findByText('status: Active → Suspended')).toBeInTheDocument();
    expect(screen.getByText('level: Dispensary → Health Center')).toBeInTheDocument();
    // The raw codes must NOT appear anywhere in the diff — proves the lookup actually ran rather
    // than merely not crashing.
    expect(screen.queryByText(/active → suspended/)).not.toBeInTheDocument();
    expect(screen.queryByText(/dispensary → health-center/)).not.toBeInTheDocument();
  });

  it('renders every field on a create as new (before em-dash)', async () => {
    getFacilityHistoryMock.mockResolvedValue({
      rows: [{
        occurredAt: '2026-08-10T09:00:00Z', actorName: 'jane', action: 'facility.create',
        before: null,
        after: { name: 'Dodoma RRH' },
      }],
    });
    show();
    expect(await screen.findByText('name: — → Dodoma RRH')).toBeInTheDocument();
  });

  it('renders every field on a delete as removed (after em-dash)', async () => {
    getFacilityHistoryMock.mockResolvedValue({
      rows: [{
        occurredAt: '2026-08-10T09:00:00Z', actorName: 'jane', action: 'facility.delete',
        before: { name: 'Dodoma RRH' },
        after: null,
      }],
    });
    show();
    expect(await screen.findByText('name: Dodoma RRH → —')).toBeInTheDocument();
  });

  it('labels a per-row import event distinctly from a manual update', async () => {
    getFacilityHistoryMock.mockResolvedValue({
      rows: [{
        occurredAt: '2026-08-10T09:00:00Z', actorName: 'facility-import', action: 'facility.import.row',
        before: { source: 'manual' },
        after: { source: 'import' },
      }],
    });
    show();
    expect(await screen.findByText('Imported')).toBeInTheDocument();
    // The exact defect Task 7 exists to preserve: `source` genuinely moving manual -> import is a
    // REAL provenance change and must render as one, not be suppressed as noise.
    expect(screen.getByText('source: manual → import')).toBeInTheDocument();
  });

  it('shows an empty state when the facility has no recorded history', async () => {
    getFacilityHistoryMock.mockResolvedValue({ rows: [] });
    show();
    await waitFor(() => expect(getFacilityHistory).toHaveBeenCalled());
    expect(await screen.findByText(/no recorded history/i)).toBeInTheDocument();
  });

  it('does not fetch while closed, and fetches once opened', async () => {
    const { rerender } = render(
      <FacilityHistory open={false} onOpenChange={vi.fn()} facilityId="fac-1" facilityName="Dodoma RRH" />,
    );
    expect(getFacilityHistory).not.toHaveBeenCalled();
    rerender(<FacilityHistory open onOpenChange={vi.fn()} facilityId="fac-1" facilityName="Dodoma RRH" />);
    await waitFor(() => expect(getFacilityHistory).toHaveBeenCalledWith('fac-1'));
  });

  it('shows the facility name in the sheet title', async () => {
    show();
    expect(await screen.findByText(/Dodoma RRH/)).toBeInTheDocument();
  });

  it('surfaces a fetch error instead of an endless spinner', async () => {
    getFacilityHistoryMock.mockRejectedValue(new Error('network down'));
    show();
    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
  });
});
