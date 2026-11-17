import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as api from '@/api';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
import { MapToFhirSheet } from './MapToFhirSheet';
import { TEST_TARGET, MARKERS, ROWS_A, ROWS_B, asItems } from './test-fixtures';

vi.mock('@/components/ui/select', () => import('./test-select-mock'));
vi.mock('@/api', async (orig) => ({
  ...(await orig<typeof api>()),
  fetchMapTargets: vi.fn(),
  suggestMapping: vi.fn(),
  testMapping: vi.fn(),
  fetchMapCodeLists: vi.fn(),
  fetchWorkflowRuns: vi.fn(),
  fetchWorkflowRun: vi.fn(),
  findValueSetByUrl: vi.fn(),
  storedValueSetCodes: vi.fn(),
}));

const m = <T,>(f: T) => f as unknown as ReturnType<typeof vi.fn>;

function mkNode(config: Record<string, unknown> = {}) {
  return { id: 'map1', type: 'action', position: { x: 0, y: 0 }, data: { label: 'Map', action: 'map-to-fhir', templateId: 'map-to-fhir', config } } as never;
}

function setRun(rows: Record<string, unknown>[] | null) {
  useWorkflowStore.setState({
    workflowId: null,
    edges: [{ id: 'e1', source: 'up1', target: 'map1' }] as never,
    nodeRunInput: {},
    nodeRunOutput: rows ? { up1: asItems(rows) } : {},
  });
}

function renderSheet(config: Record<string, unknown> = {}) {
  const update = vi.fn();
  const utils = render(<MapToFhirSheet open onOpenChange={() => {}} node={mkNode(config)} update={update} />);
  return { update, ...utils };
}

function openMenuAndClick(label: string) {
  const trigger = screen.getByRole('button', { name: 'Mapping actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText(label)) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByText(label));
}

const sourceSelect = (label: string) => screen.getByRole('combobox', { name: `From your data: ${label}` }) as HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
  m(api.fetchMapTargets).mockResolvedValue([TEST_TARGET]);
  m(api.suggestMapping).mockResolvedValue([]);
  m(api.testMapping).mockResolvedValue([]);
  m(api.fetchMapCodeLists).mockResolvedValue([]);
});

describe('MapToFhirSheet', () => {
  it('shows StripedEmpty, not rows, when there is no sample', async () => {
    setRun(null);
    renderSheet();
    expect(await screen.findByText(/There is no sample yet/)).toBeInTheDocument();
    expect(screen.queryByTestId('map-row-Patient.identifier.value')).not.toBeInTheDocument();
  });

  it('lists one row per target field, required ones starred, from the last run', async () => {
    setRun(ROWS_A);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    for (const f of TEST_TARGET.fields) expect(screen.getByTestId(`map-row-${f.path}`)).toBeInTheDocument();
    expect(within(screen.getByTestId('map-row-Patient.identifier.value')).getByLabelText('Required')).toBeInTheDocument();
    expect(within(screen.getByTestId('map-row-Patient.gender')).queryByLabelText('Required')).toBeNull();
    // The example is the first sample's value, shown only on screen.
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    expect(within(screen.getByTestId('map-row-Patient.identifier.value')).getByText('QZX-1')).toBeInTheDocument();
  });

  it('saves the mapping, and the saved config holds no sample value', async () => {
    setRun(ROWS_A);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'test_a' } });
    fireEvent.change(sourceSelect('Sex'), { target: { value: '__fixed' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Fixed value: Sex' }), { target: { value: 'typed-by-person' } });
    openMenuAndClick('Save');

    expect(update).toHaveBeenCalledOnce();
    const config = update.mock.calls[0][0].config;
    expect(config.targetId).toBe('test-target');
    expect(config.mappings).toHaveLength(1);
    expect(config.mappings[0]).toMatchObject({
      targetId: 'test-target',
      fieldNames: ['pat_no', 'sex', 'test_a', 'test_b'],
      rows: [
        { targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } },
        { targetPath: 'Patient.gender', from: { fixed: 'typed-by-person' } },
        { targetPath: 'Observation.code', from: { field: 'test_a' } },
      ],
    });
    const text = JSON.stringify(config);
    for (const v of MARKERS) expect(text).not.toContain(v);
  });

  it('refuses Save while a required field has no source', async () => {
    setRun(ROWS_A);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    openMenuAndClick('Save');
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Test is required');
  });

  it('opens on a shape with a saved mapping and shows its rows', async () => {
    setRun(ROWS_B);
    const config = {
      targetId: 'test-target',
      mappings: [
        {
          shapeHash: (await import('@openldr/forms/pure')).shapeOf(ROWS_B[0]).hash,
          fieldNames: ['ident', 'result'],
          targetId: 'test-target',
          rows: [{ targetPath: 'Patient.identifier.value', from: { field: 'ident' } }],
        },
      ],
    };
    renderSheet(config);
    await screen.findByTestId('map-row-Patient.identifier.value');
    await waitFor(() => expect(sourceSelect('Patient ID').value).toBe('ident'));
    expect(sourceSelect('Sex').value).toBe('__none');
  });
});
