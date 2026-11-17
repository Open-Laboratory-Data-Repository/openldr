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
  if (!screen.queryByRole('menuitem', { name: label })) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
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

  it('shows a suggestion grey with Accept, and accepting it fills the row', async () => {
    setRun(ROWS_A);
    m(api.suggestMapping).mockResolvedValue([{ targetPath: 'Patient.identifier.value', field: 'pat_no', score: 0.9 }]);
    renderSheet();
    const hint = await screen.findByTestId('map-suggestion-Patient.identifier.value');
    expect(hint).toHaveTextContent('Suggested: pat_no');
    expect(m(api.suggestMapping)).toHaveBeenCalledWith({ targetId: 'test-target', fieldNames: ['pat_no', 'sex', 'test_a', 'test_b'], locale: 'en' });
    expect(sourceSelect('Patient ID').value).toBe('__none');
    fireEvent.click(screen.getByRole('button', { name: 'Accept: Patient ID' }));
    expect(sourceSelect('Patient ID').value).toBe('pat_no');
    expect(screen.queryByTestId('map-suggestion-Patient.identifier.value')).toBeNull();
  });

  it('does not save or test a suggestion that was not accepted', async () => {
    setRun(ROWS_A);
    m(api.suggestMapping).mockResolvedValue([{ targetPath: 'Patient.gender', field: 'sex', score: 0.9 }]);
    m(api.testMapping).mockResolvedValue([
      { ok: true, kind: 'mapped', resourceTypes: ['Patient', 'Observation'], resources: [] },
      { ok: false, reason: 'Test is required and has no value', field: 'Observation.code' },
    ]);
    const { update } = renderSheet();
    await screen.findByTestId('map-suggestion-Patient.gender');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'test_a' } });

    openMenuAndClick('Test');
    await screen.findByTestId('map-test-results');
    const sent = m(api.testMapping).mock.calls[0][0];
    expect(sent.items).toEqual(ROWS_A);
    const sentRows = sent.config.mappings[0].rows.map((r: { targetPath: string }) => r.targetPath);
    expect(sentRows).toEqual(['Patient.identifier.value', 'Observation.code']);
    expect(screen.getByText('Patient, Observation passes')).toBeInTheDocument();
    expect(screen.getByText('Test is required and has no value')).toBeInTheDocument();

    openMenuAndClick('Save');
    const rows = update.mock.calls[0][0].config.mappings[0].rows.map((r: { targetPath: string }) => r.targetPath);
    expect(rows).not.toContain('Patient.gender');
  });

  it('saves a repeating field with two sources as fields', async () => {
    setRun(ROWS_A);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'test_a' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Add another column: Test' }), { target: { value: 'test_b' } });
    openMenuAndClick('Save');
    const row = update.mock.calls[0][0].config.mappings[0].rows.find((r: { targetPath: string }) => r.targetPath === 'Observation.code');
    expect(row.from).toEqual({ fields: ['test_a', 'test_b'] });
  });

  it('gives a shape select for two shapes, naming counts only, and saving one keeps the other', async () => {
    setRun([...ROWS_A, ...ROWS_B]);
    const { shapeOf } = await import('@openldr/forms/pure');
    const hashA = shapeOf(ROWS_A[0]).hash;
    const hashB = shapeOf(ROWS_B[0]).hash;
    const kept = { shapeHash: hashA, fieldNames: ['pat_no', 'sex', 'test_a', 'test_b'], targetId: 'test-target', rows: [] };
    const { update } = renderSheet({ targetId: 'test-target', mappings: [kept] });
    const shape = (await screen.findByRole('combobox', { name: 'Sample shape' })) as HTMLSelectElement;
    const labels = [...shape.options].map((o) => o.textContent);
    expect(labels).toContain('4 fields, 2 rows');
    expect(labels).toContain('2 fields, 1 rows');
    for (const v of MARKERS) expect(labels.join(' ')).not.toContain(v);

    fireEvent.change(shape, { target: { value: hashB } });
    await waitFor(() => expect((sourceSelect('Patient ID').querySelectorAll('option'))).toHaveLength(5));
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'ident' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'result' } });
    openMenuAndClick('Save');
    const mappings = update.mock.calls[0][0].config.mappings;
    expect(mappings.map((x: { shapeHash: string }) => x.shapeHash)).toEqual([hashA, hashB]);
  });

  it('adds a FHIR path row, never starred, offering only paths one cell can fill', async () => {
    setRun(ROWS_A);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    openMenuAndClick('Add a FHIR path');
    const pathSelect = screen.getByRole('combobox', { name: 'FHIR path' }) as HTMLSelectElement;
    const offered = [...pathSelect.options].map((o) => o.value).filter(Boolean);
    const { canWriteFromCell } = await import('@openldr/forms/pure');
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((x) => canWriteFromCell(x))).toBe(true);
    expect(offered).not.toContain('Patient.identifier.value');
    expect(offered).toContain('Patient.birthDate');
    fireEvent.change(pathSelect, { target: { value: 'Patient.birthDate' } });
    const row = screen.getByTestId('map-row-Patient.birthDate');
    expect(within(row).queryByLabelText('Required')).toBeNull();
  });

  it('saves a values rule the person typed, and a code list picked from the list', async () => {
    setRun(ROWS_A);
    m(api.fetchMapCodeLists).mockResolvedValue([
      { url: 'urn:test:own-map', name: '', local: true },
      { url: 'urn:test:map', name: 'Local tests', local: false },
    ]);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'sex' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Sex' }), { target: { value: 'values' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'From 1: Sex' }), { target: { value: 'm' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'To 1: Sex' }), { target: { value: 'male' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'test_a' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Test' }), { target: { value: 'codeList' } });
    const list = (await screen.findByRole('combobox', { name: 'Code list: Test' })) as HTMLSelectElement;
    const shown = [...list.options].map((o) => o.textContent);
    expect(shown).toEqual(['-', "This lab's own code list", 'Local tests']);
    expect(shown.join(' ')).not.toContain('urn:');
    fireEvent.change(list, { target: { value: 'urn:test:map' } });
    openMenuAndClick('Save');
    const rows = update.mock.calls[0][0].config.mappings[0].rows;
    expect(rows.find((r: { targetPath: string }) => r.targetPath === 'Patient.gender').rule).toEqual({ kind: 'values', map: { m: 'male' } });
    expect(rows.find((r: { targetPath: string }) => r.targetPath === 'Observation.code').rule).toEqual({ kind: 'codeList', conceptMapUrl: 'urn:test:map' });
  });

  it('refuses Save while a chosen rule is not finished', async () => {
    setRun(ROWS_A);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'test_a' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Patient ID' }), { target: { value: 'date' } });
    openMenuAndClick('Save');
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Finish the rule on Patient ID.');
  });
});

describe('MapToFhirSheet Listen', () => {
  it('reads the feeding node output from a new run, and stops when the sheet closes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useWorkflowStore.setState({ workflowId: 'wf1', edges: [{ id: 'e1', source: 'up1', target: 'map1' }] as never, nodeRunInput: {}, nodeRunOutput: {} });
      m(api.fetchWorkflowRuns).mockResolvedValue([]);
      const update = vi.fn();
      const ui = (open: boolean) => <MapToFhirSheet open={open} onOpenChange={() => {}} node={mkNode()} update={update} />;
      const { rerender } = render(ui(true));
      await screen.findByText(/There is no sample yet/);
      openMenuAndClick('Listen');
      expect(await screen.findByText('Listening for a new run')).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(2100);
      expect(m(api.fetchWorkflowRuns)).toHaveBeenCalledTimes(1);

      rerender(ui(false));
      const calls = m(api.fetchWorkflowRuns).mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000);
      expect(m(api.fetchWorkflowRuns).mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fills the sample from the first new run that has the feeding node output', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useWorkflowStore.setState({ workflowId: 'wf1', edges: [{ id: 'e1', source: 'up1', target: 'map1' }] as never, nodeRunInput: {}, nodeRunOutput: {} });
      const later = new Date(Date.now() + 60000).toISOString();
      m(api.fetchWorkflowRuns).mockResolvedValue([{ id: 'r1', startedAt: later }]);
      m(api.fetchWorkflowRun).mockResolvedValue({ id: 'r1', startedAt: later, result: { results: [{ nodeId: 'up1', output: asItems(ROWS_A) }] } });
      renderSheet();
      await screen.findByText(/There is no sample yet/);
      openMenuAndClick('Listen');
      await vi.advanceTimersByTimeAsync(2100);
      expect(await screen.findByTestId('map-row-Patient.identifier.value')).toBeInTheDocument();
      expect(m(api.fetchWorkflowRun)).toHaveBeenCalledWith('r1');
      // The sample lives in the sheet only: not in the store's nodes, not in browser storage.
      const stored = JSON.stringify(useWorkflowStore.getState().nodes) + JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
      for (const v of MARKERS) expect(stored).not.toContain(v);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a hint instead of Listen for an unsaved workflow', async () => {
    setRun(null);
    renderSheet();
    expect(await screen.findByText('Save the workflow to listen for new runs.')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Mapping actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Use last run' })) fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: 'Use last run' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Listen' })).toBeNull();
  });
});
