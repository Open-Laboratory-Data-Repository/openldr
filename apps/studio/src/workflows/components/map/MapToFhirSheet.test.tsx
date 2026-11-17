import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as api from '@/api';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
import { MapToFhirSheet } from './MapToFhirSheet';
import { labResultTarget, SavedMappingSchema, seededStarterPacks } from '@openldr/forms/pure';
import { TEST_TARGET, MARKERS, ROWS_A, ROWS_B, ROWS_FORM, FORM_EXAMPLES, asItems } from './test-fixtures';

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
  expandValueSetByUrl: vi.fn(),
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
  m(api.expandValueSetByUrl).mockResolvedValue([]);
});

describe('MapToFhirSheet', () => {
  it('shows StripedEmpty, not rows, when there is no sample', async () => {
    setRun(null);
    renderSheet();
    const text = await screen.findByText(/Save the workflow first/);
    // The text keeps the side padding the other states have, so it does not touch the edges.
    expect(text.parentElement!.className).toContain('px-6');
    expect(screen.queryByTestId('map-row-Patient.identifier.value')).not.toBeInTheDocument();
  });

  it('shows the saved mapping with no sample: the widest by default, a select for another, and Save keeps it', async () => {
    setRun(null);
    const narrow = { shapeHash: 'n', fieldNames: ['pat_no'], targetId: 'test-target', rows: [{ targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } }] };
    const wide = {
      shapeHash: 'w', fieldNames: ['pat_no', 'test_a', 'zz_ward'], targetId: 'test-target',
      rows: [{ targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } }, { targetPath: 'Observation.code', from: { field: 'test_a' } }],
    };
    const other = { shapeHash: 'o', fieldNames: ['x'], targetId: 'other-target', rows: [] };
    const { update } = renderSheet({ targetId: 'test-target', mappings: [narrow, wide, other] });
    await waitFor(() => expect(sourceSelect('Test').value).toBe('test_a'));
    expect(screen.getByTestId('map-no-sample')).toHaveTextContent('Save the workflow first');
    // With no sample loaded, no column is marked as missing from one, and no example shows.
    const names = [...sourceSelect('Sex').options].map((o) => o.textContent);
    expect(names).toContain('zz_ward');
    expect(names.some((x) => x?.includes('not in this sample'))).toBe(false);
    const pick = screen.getByRole('combobox', { name: 'Saved mapping' }) as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent).filter((x) => x !== '-')).toEqual(['pat_no, test_a, zz_ward', 'pat_no']);
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'zz_ward' } });
    openMenuAndClick('Save');
    const mappings = update.mock.calls[0][0].config.mappings;
    expect(mappings.find((x: { shapeHash: string }) => x.shapeHash === 'w').rows).toHaveLength(3);
    // The narrower one has all its columns in the wider one, so Save removes it, as with a sample.
    expect(mappings.map((x: { shapeHash: string }) => x.shapeHash)).toEqual(['w']);
  });

  it('opens another saved mapping from the select when there is no sample', async () => {
    setRun(null);
    const a = { shapeHash: 'a', fieldNames: ['pat_no', 'test_a'], targetId: 'test-target', rows: [{ targetPath: 'Observation.code', from: { field: 'test_a' } }] };
    const b = { shapeHash: 'b', fieldNames: ['ident'], targetId: 'test-target', rows: [{ targetPath: 'Patient.identifier.value', from: { field: 'ident' } }] };
    renderSheet({ targetId: 'test-target', mappings: [a, b] });
    await waitFor(() => expect(sourceSelect('Test').value).toBe('test_a'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Saved mapping' }), { target: { value: 'b' } });
    await waitFor(() => expect(sourceSelect('Patient ID').value).toBe('ident'));
    expect(sourceSelect('Test').value).toBe('__none');
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
    expect(screen.getByText('Test: is required and has no value')).toBeInTheDocument();

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
    fireEvent.click(screen.getByRole('button', { name: 'Add another column: Test' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'test_b' }));
    openMenuAndClick('Save');
    const row = update.mock.calls[0][0].config.mappings[0].rows.find((r: { targetPath: string }) => r.targetPath === 'Observation.code');
    expect(row.from).toEqual({ fields: ['test_a', 'test_b'] });
  });

  it('makes one set of columns from rows of two forms, with no shape select', async () => {
    setRun([...ROWS_A, ...ROWS_B]);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    expect(screen.queryByRole('combobox', { name: 'Sample shape' })).toBeNull();
    expect(screen.getByTestId('map-status')).toHaveTextContent('3 sample rows');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'ident' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'test_a' } });
    openMenuAndClick('Save');
    const mappings = update.mock.calls[0][0].config.mappings;
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fieldNames).toEqual(['ident', 'pat_no', 'result', 'sex', 'test_a', 'test_b']);
  });

  it('offers a column first filled at row 25 of 30', async () => {
    setRun(Array.from({ length: 30 }, (_, i) => (i === 24 ? { pat_no: `QZX-${i}`, late: 'QZX-L' } : { pat_no: `QZX-${i}` })));
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    expect([...sourceSelect('Sex').options].map((o) => o.value)).toContain('late');
    expect(screen.getByTestId('map-status')).toHaveTextContent('20 sample rows');
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
    expect(offered).not.toContain('Patient.birthDate');
    expect(offered).toContain('Patient.active');
    fireEvent.change(pathSelect, { target: { value: 'Patient.active' } });
    const row = screen.getByTestId('map-row-Patient.active');
    expect(within(row).queryByLabelText('Required')).toBeNull();
  });

  it('leaves a record id and a link the target makes out of Add a FHIR path', async () => {
    setRun(ROWS_A);
    m(api.fetchMapTargets).mockResolvedValue([{ ...TEST_TARGET, links: [{ from: 'Observation', path: 'Observation.subject', to: 'Patient' }] }]);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    openMenuAndClick('Add a FHIR path');
    const offered = () => [...(screen.getByRole('combobox', { name: 'FHIR path' }) as HTMLSelectElement).options].map((o) => o.value);
    expect(offered()).not.toContain('Patient.id');
    fireEvent.change(screen.getByRole('combobox', { name: 'Record' }), { target: { value: 'Observation' } });
    expect(offered()).not.toContain('Observation.id');
    expect(offered()).not.toContain('Observation.subject');
    expect(offered()).toContain('Observation.issued');
  });

  it('saves a values rule the person typed, and a code list picked from the list', async () => {
    setRun(ROWS_A);
    m(api.fetchMapCodeLists).mockResolvedValue([
      { url: 'urn:test:own-map', name: '', local: true, sourceSystems: [] },
      { url: 'urn:test:map', name: 'Local tests', local: false, sourceSystems: [] },
    ]);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'sex' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Sex' }), { target: { value: 'values' } });
    fireEvent.change(await screen.findByRole('textbox', { name: 'From 1: Sex' }), { target: { value: 'm' } });
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

  it('asks for a source system from a list on the lab\'s own code list, and refuses Save while it is empty', async () => {
    setRun(ROWS_A);
    m(api.fetchMapCodeLists).mockResolvedValue([
      { url: 'urn:test:own-map', name: '', local: true, sourceSystems: ['urn:test:src-1', 'urn:test:src-2'] },
      { url: 'urn:test:map', name: 'Local tests', local: false, sourceSystems: [] },
    ]);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'test_a' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Test' }), { target: { value: 'codeList' } });
    // Another list keeps the optional text input.
    fireEvent.change(await screen.findByRole('combobox', { name: 'Code list: Test' }), { target: { value: 'urn:test:map' } });
    expect(screen.getByRole('textbox', { name: 'Source system: Test' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Code list: Test' }), { target: { value: 'urn:test:own-map' } });
    const systems = screen.getByRole('combobox', { name: 'Source system: Test' }) as HTMLSelectElement;
    expect([...systems.options].map((o) => o.value)).toEqual(['', 'urn:test:src-1', 'urn:test:src-2']);
    openMenuAndClick('Save');
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent("Pick the source system for Test. The lab's own code list needs one.");
    fireEvent.change(systems, { target: { value: 'urn:test:src-2' } });
    openMenuAndClick('Save');
    const rows = update.mock.calls[0][0].config.mappings[0].rows;
    expect(rows.find((r: { targetPath: string }) => r.targetPath === 'Observation.code').rule).toEqual({ kind: 'codeList', conceptMapUrl: 'urn:test:own-map', sourceSystem: 'urn:test:src-2' });
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
      await screen.findByText(/Choose Listen, then send a message/);
      openMenuAndClick('Listen');
      expect(await screen.findByText('Listening for a new run')).toBeInTheDocument();
      expect(screen.getByTestId('map-status')).toHaveTextContent('Listening for a message...');
      await vi.advanceTimersByTimeAsync(2100);
      // One call for the baseline at the press, one for the first poll.
      expect(m(api.fetchWorkflowRuns)).toHaveBeenCalledTimes(2);

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
      m(api.fetchWorkflowRuns).mockResolvedValueOnce([]).mockResolvedValue([{ id: 'r1', startedAt: later }]);
      m(api.fetchWorkflowRun).mockResolvedValue({ id: 'r1', startedAt: later, result: { results: [{ nodeId: 'up1', output: asItems(ROWS_A) }] } });
      renderSheet();
      await screen.findByText(/Choose Listen, then send a message/);
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
    if (!screen.queryByRole('menuitem', { name: "Use this editor's last run" })) fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: "Use this editor's last run" })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Listen' })).toBeNull();
  });
});

describe('MapToFhirSheet latest stored run', () => {
  const saved = () =>
    useWorkflowStore.setState({ workflowId: 'wf1', edges: [{ id: 'e1', source: 'up1', target: 'map1' }] as never, nodeRunInput: {}, nodeRunOutput: {} });
  const run = (id: string, startedAt: string, output: unknown) => ({ id, startedAt, result: { results: [{ nodeId: 'up1', output }] } });

  it('reads rows under body from a webhook envelope through the source path', async () => {
    saved();
    const r = run('r1', '2026-01-02T00:00:00Z', [{ json: { headers: { h: 'x' }, query: {}, body: ROWS_A } }]);
    m(api.fetchWorkflowRuns).mockResolvedValue([r]);
    m(api.fetchWorkflowRun).mockResolvedValue(r);
    renderSheet({ sourcePath: 'body' });
    await screen.findByText(/Choose Listen, then send a message/);
    openMenuAndClick('Use the latest stored run');
    expect(await screen.findByTestId('map-row-Patient.identifier.value')).toBeInTheDocument();
    expect(m(api.fetchWorkflowRuns)).toHaveBeenCalledWith('wf1', { limit: 10 });
    expect([...sourceSelect('Patient ID').options].map((o) => o.value)).toEqual(['', '__none', '__fixed', 'pat_no', 'sex', 'test_a', 'test_b']);
  });

  it('falls back to an older run when the newest has no rows', async () => {
    saved();
    const newest = run('new', '2026-01-03T00:00:00Z', [{ json: { resourceType: 'Patient', id: 'p1' } }]);
    const older = run('old', '2026-01-01T00:00:00Z', asItems(ROWS_B));
    m(api.fetchWorkflowRuns).mockResolvedValue([older, newest]);
    m(api.fetchWorkflowRun).mockImplementation(async (id: string) => (id === 'new' ? newest : older));
    renderSheet();
    await screen.findByText(/Choose Listen, then send a message/);
    openMenuAndClick('Use the latest stored run');
    await screen.findByTestId('map-row-Patient.identifier.value');
    expect(m(api.fetchWorkflowRun).mock.calls.map((c) => c[0])).toEqual(['new', 'old']);
    expect([...sourceSelect('Patient ID').options].map((o) => o.value)).toContain('ident');
  });

  it('says so in one line when no stored run has rows', async () => {
    saved();
    m(api.fetchWorkflowRuns).mockResolvedValue([run('r1', '2026-01-01T00:00:00Z', [])]);
    m(api.fetchWorkflowRun).mockResolvedValue(run('r1', '2026-01-01T00:00:00Z', []));
    renderSheet();
    await screen.findByText(/Choose Listen, then send a message/);
    openMenuAndClick('Use the latest stored run');
    expect(await screen.findByText('None of the 10 newest runs has rows for this node.')).toBeInTheDocument();
  });
});

describe('MapToFhirSheet rule suggestions, status and results', () => {
  beforeEach(() => {
    m(api.findValueSetByUrl).mockImplementation(async (url: string) => (url.includes('administrative-gender') ? { id: 'vs1', url } : null));
    m(api.storedValueSetCodes).mockResolvedValue([{ system: 'urn:test:sys', code: 'male', display: null }, { system: 'urn:test:sys', code: 'female', display: null }]);
  });

  async function mapForm() {
    setRun(ROWS_FORM);
    const ui = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pid' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 't' } });
    fireEvent.change(sourceSelect('Result (number)'), { target: { value: 'res' } });
    fireEvent.change(sourceSelect('Date of birth'), { target: { value: 'dob' } });
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'sx' } });
    return ui;
  }

  it('suggests a rule from the form of the values, and saves only the accepted rule', async () => {
    const { update } = await mapForm();
    expect(await screen.findByTestId('map-rule-suggestion-Observation.valueQuantity.value')).toHaveTextContent('Suggested rule: number, decimal comma');
    expect(screen.getByTestId('map-rule-suggestion-Patient.birthDate')).toHaveTextContent('Suggested rule: date, dd/MM/yyyy');
    expect(await screen.findByTestId('map-rule-suggestion-Patient.gender')).toHaveTextContent('Suggested rule: values. Fill in what each value means.');
    expect(screen.queryByTestId('map-rule-suggestion-Patient.identifier.value')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Accept: Rule: Result (number)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept: Rule: Date of birth' }));
    openMenuAndClick('Save');
    const config = update.mock.calls[0][0].config;
    const rows = config.mappings[0].rows;
    const byPath = (k: string) => rows.find((r: { targetPath: string }) => r.targetPath === k);
    expect(byPath('Observation.valueQuantity.value').rule).toEqual({ kind: 'number', decimal: ',' });
    expect(byPath('Patient.birthDate').rule).toEqual({ kind: 'date', format: 'dd/MM/yyyy' });
    expect(byPath('Patient.gender').rule).toBeUndefined();
    const text = JSON.stringify(config);
    for (const v of [...MARKERS, ...FORM_EXAMPLES]) expect(text).not.toContain(v);
  });

  it('says when day and month cannot be told apart', async () => {
    setRun([{ pid: 'QZX-1', t: 'QZX-2', dob: '03/04/2025' }]);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Date of birth'), { target: { value: 'dob' } });
    expect(screen.getByTestId('map-rule-suggestion-Patient.birthDate')).toHaveTextContent('day first; change it if your file has the month first');
  });

  it('opens an accepted values rule with one line per distinct sample value, and saves only the lines with a To', async () => {
    setRun([...ROWS_FORM, { pid: 'QZX-7', t: 'QZX-8', sx: 'QZX-2' }]);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pid' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 't' } });
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'sx' } });
    await screen.findByTestId('map-rule-suggestion-Patient.gender');
    fireEvent.click(screen.getByRole('button', { name: 'Accept: Rule: Sex' }));
    expect((await screen.findByRole('textbox', { name: 'From 1: Sex' }) as HTMLInputElement).value).toBe('QZX-2');
    expect((screen.getByRole('textbox', { name: 'From 2: Sex' }) as HTMLInputElement).value).toBe('QZX-5');
    expect(screen.queryByRole('textbox', { name: 'From 3: Sex' })).toBeNull();
    // The field has a value set, so To picks from its codes, and starts empty.
    const to1 = (await screen.findByRole('combobox', { name: 'To 1: Sex' })) as HTMLSelectElement;
    expect(to1.value).toBe('');
    fireEvent.change(to1, { target: { value: 'urn:test:sys|female' } });
    openMenuAndClick('Save');
    const config = update.mock.calls[0][0].config;
    const gender = config.mappings[0].rows.find((r: { targetPath: string }) => r.targetPath === 'Patient.gender');
    // The code is saved with its system, so a coded field keeps it.
    expect(gender.rule).toEqual({ kind: 'values', map: { 'QZX-2': { system: 'urn:test:sys', code: 'female' } } });
    expect(JSON.stringify(config)).not.toContain('QZX-5');
  });

  it('does not send an unaccepted rule to Test', async () => {
    m(api.testMapping).mockResolvedValue([{ ok: false, reason: 'Observation.valueQuantity.value needs a number', field: 'Observation.valueQuantity.value' }, { ok: true, kind: 'mapped', resourceTypes: ['Patient'], resources: [] }]);
    await mapForm();
    await screen.findByTestId('map-rule-suggestion-Patient.gender');
    fireEvent.click(screen.getByRole('button', { name: 'Accept: Rule: Sex' }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Sex' }), { target: { value: 'none' } });
    openMenuAndClick('Test');
    const footer = await screen.findByTestId('map-test-footer');
    const sent = m(api.testMapping).mock.calls[0][0].config.mappings[0].rows;
    expect(sent.every((r: { rule?: unknown }) => r.rule === undefined)).toBe(true);
    // A reason reads in the sheet's labels. The result block sits below the scrolling rows, outside
    // them, so it stays in view without position: sticky. Only a browser can confirm the layout.
    expect(within(footer).getByText('Result (number): needs a number')).toBeInTheDocument();
    const scroll = screen.getByTestId('map-scroll');
    expect(scroll).toContainElement(screen.getByTestId('map-row-Patient.gender'));
    expect(scroll).not.toContainElement(footer);
    expect(footer.parentElement).toBe(scroll.parentElement);
    expect(footer.className).not.toContain('sticky');
    expect(scroll.className).toContain('overflow-y-auto');
    expect(screen.getByTestId('map-status')).toHaveTextContent('1 of 2 rows passes');
  });

  it('counts the sample rows of the group on screen', async () => {
    setRun(ROWS_A);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    expect(screen.getByTestId('map-status')).toHaveTextContent('2 sample rows');
  });

  it('uses the singular for one sample row', async () => {
    setRun(ROWS_B);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    expect(screen.getByTestId('map-status')).toHaveTextContent('1 sample row');
  });
});

describe('MapToFhirSheet fix round 1', () => {
  const saved = () =>
    useWorkflowStore.setState({ workflowId: 'wf1', edges: [{ id: 'e1', source: 'up1', target: 'map1' }] as never, nodeRunInput: {}, nodeRunOutput: {} });

  it('keeps listening past a new run with no rows, and takes the next one that has rows', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      saved();
      const old = { id: 'old', startedAt: '2026-01-01T00:00:00Z' };
      const empty = { id: 'empty', startedAt: '2026-01-02T00:00:00Z', result: { results: [{ nodeId: 'up1', output: [{ json: { resourceType: 'Patient', id: 'p' } }] }] } };
      const full = { id: 'full', startedAt: '2026-01-03T00:00:00Z', result: { results: [{ nodeId: 'up1', output: asItems(ROWS_A) }] } };
      m(api.fetchWorkflowRuns)
        .mockResolvedValueOnce([old])
        .mockResolvedValueOnce([empty, old])
        .mockResolvedValue([full, empty, old]);
      m(api.fetchWorkflowRun).mockImplementation(async (id: string) => (id === 'empty' ? empty : full));
      renderSheet();
      await screen.findByText(/Choose Listen, then send a message/);
      openMenuAndClick('Listen');
      await vi.advanceTimersByTimeAsync(2100);
      expect(screen.getByText('Listening for a new run')).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(2100);
      expect(await screen.findByTestId('map-row-Patient.identifier.value')).toBeInTheDocument();
      // The run there at the press is never read.
      expect(m(api.fetchWorkflowRun).mock.calls.map((c) => c[0])).toEqual(['empty', 'full']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists every column of rows that lack some, and takes the example from the first row with a value', async () => {
    setRun([{ pat_no: 'QZX-1', test_a: 'QZX-3' }, { pat_no: 'QZX-5', sex: 'QZX-6', test_a: 'QZX-4' }, { sex: 'QZX-2', test_a: 'QZX-3' }]);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    expect(screen.queryByRole('combobox', { name: 'Sample shape' })).toBeNull();
    expect(screen.getByTestId('map-status')).toHaveTextContent('3 sample rows');
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'sex' } });
    expect(within(screen.getByTestId('map-row-Patient.gender')).getByText('QZX-6')).toBeInTheDocument();
  });

  it('replaces the saved mapping with the same field set on Save, whatever its hash', async () => {
    setRun(ROWS_B);
    const old = { shapeHash: 'from-another-sample', fieldNames: ['result', 'ident'], targetId: 'test-target', rows: [{ targetPath: 'Patient.identifier.value', from: { field: 'ident' } }] };
    const { update } = renderSheet({ targetId: 'test-target', mappings: [old] });
    await waitFor(() => expect(sourceSelect('Patient ID').value).toBe('ident'));
    fireEvent.change(sourceSelect('Test'), { target: { value: 'result' } });
    openMenuAndClick('Save');
    const mappings = update.mock.calls[0][0].config.mappings;
    expect(mappings).toHaveLength(1);
    expect(mappings[0].rows).toHaveLength(2);
  });

  it('removes a narrower saved mapping when it saves a wider one, and says so first', async () => {
    setRun(ROWS_A);
    const narrow = { shapeHash: 'n', fieldNames: ['pat_no', 'test_a'], targetId: 'test-target', rows: [] };
    const other = { shapeHash: 'o', fieldNames: ['pat_no', 'zz'], targetId: 'test-target', rows: [] };
    const { update } = renderSheet({ targetId: 'test-target', mappings: [narrow, other] });
    await screen.findByTestId('map-row-Patient.identifier.value');
    expect(screen.getByTestId('map-replaces-narrower')).toHaveTextContent('Saving replaces 1 saved mapping whose columns are all in this one.');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'test_a' } });
    openMenuAndClick('Save');
    const names = update.mock.calls[0][0].config.mappings.map((x: { fieldNames: string[] }) => x.fieldNames);
    // The overlapping one that is not contained stays.
    expect(names).toEqual([['pat_no', 'zz'], ['pat_no', 'sex', 'test_a', 'test_b']]);
  });

  it('opens a narrower group on the wider saved mapping, and Save keeps one mapping with the wider names', async () => {
    setRun([{ ident: 'QZX-1' }]);
    const wide = { shapeHash: 'w', fieldNames: ['ident', 'result'], targetId: 'test-target', rows: [{ targetPath: 'Patient.identifier.value', from: { field: 'ident' } }] };
    const { update } = renderSheet({ targetId: 'test-target', mappings: [wide] });
    await waitFor(() => expect(sourceSelect('Patient ID').value).toBe('ident'));
    expect(screen.queryByTestId('map-replaces-narrower')).toBeNull();
    fireEvent.change(sourceSelect('Test'), { target: { value: '__fixed' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Fixed value: Test' }), { target: { value: 'typed' } });
    openMenuAndClick('Save');
    const mappings = update.mock.calls[0][0].config.mappings;
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({ shapeHash: 'w', fieldNames: ['ident', 'result'] });
  });

  it('keeps two saved mappings that overlap without one holding the other', async () => {
    setRun([{ a: 'QZX-1', b: 'QZX-2' }]);
    const other = { shapeHash: 'o', fieldNames: ['b', 'c'], targetId: 'test-target', rows: [] };
    const { update } = renderSheet({ targetId: 'test-target', mappings: [other] });
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'a' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'b' } });
    openMenuAndClick('Save');
    const names = update.mock.calls[0][0].config.mappings.map((x: { fieldNames: string[] }) => x.fieldNames);
    expect(names).toEqual([['b', 'c'], ['a', 'b']]);
  });

  it('does not offer a column with an empty name', async () => {
    setRun([{ '': 'QZX-1', pat_no: 'QZX-2' }]);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    const values = [...sourceSelect('Patient ID').options].map((o) => o.value);
    expect(values).toEqual(['', '__none', '__fixed', 'pat_no']);
  });

  it('refuses Save while a values rule has no line with both sides filled', async () => {
    setRun(ROWS_A);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'test_a' } });
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'sex' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Sex' }), { target: { value: 'values' } });
    fireEvent.change(await screen.findByRole('textbox', { name: 'From 1: Sex' }), { target: { value: 'm' } });
    openMenuAndClick('Save');
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Finish the rule on Sex.');
  });

  it('says the rows are under body when a webhook feeds the node and the source path is blank', async () => {
    setRun(ROWS_A);
    useWorkflowStore.setState({ nodes: [{ id: 'up1', type: 'webhook', position: { x: 0, y: 0 }, data: { label: 'Hook' } }] as never });
    const first = renderSheet();
    expect(await screen.findByText(/the rows are under body/)).toBeInTheDocument();
    first.unmount();
    renderSheet({ sourcePath: 'body' });
    await screen.findByText(/Pick the column that fills/);
    expect(screen.queryByText(/the rows are under body/)).toBeNull();
  });

  it('keys value set codes by system and code, and saves the code', async () => {
    setRun(ROWS_A);
    m(api.fetchMapTargets).mockResolvedValue([
      { ...TEST_TARGET, fields: TEST_TARGET.fields.map((f) => (f.path === 'Patient.gender' ? { ...f, valueSet: 'urn:test:vs' } : f)) },
    ]);
    m(api.findValueSetByUrl).mockResolvedValue({ id: 'vs1', url: 'urn:test:vs' });
    m(api.storedValueSetCodes).mockResolvedValue([
      { system: 'urn:test:a', code: 'male', display: 'A' },
      { system: 'urn:test:b', code: 'male', display: 'B' },
    ]);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 'test_a' } });
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'sex' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Sex' }), { target: { value: 'values' } });
    // The codes load first, so the inputs show after the loader. The lines open on the sample's values.
    const from1 = (await screen.findByRole('textbox', { name: 'From 1: Sex' })) as HTMLInputElement;
    expect(from1.value).toBe('QZX-2');
    fireEvent.change(from1, { target: { value: 'm' } });
    const to = (await screen.findByRole('combobox', { name: 'To 1: Sex' })) as HTMLSelectElement;
    expect([...to.options].map((o) => o.value)).toEqual(['', 'urn:test:a|male', 'urn:test:b|male']);
    fireEvent.change(to, { target: { value: 'urn:test:b|male' } });
    openMenuAndClick('Save');
    const row = update.mock.calls[0][0].config.mappings[0].rows.find((r: { targetPath: string }) => r.targetPath === 'Patient.gender');
    expect(row.rule).toEqual({ kind: 'values', map: { m: { system: 'urn:test:b', code: 'male' } } });
  });
});

describe('MapToFhirSheet fix round 2', () => {
  it('shows a saved column that is not in this sample, marked, and Save keeps it', async () => {
    setRun([{ ident: 'QZX-1' }]);
    const wide = {
      shapeHash: 'w', fieldNames: ['ident', 'result'], targetId: 'test-target',
      rows: [{ targetPath: 'Patient.identifier.value', from: { field: 'ident' } }, { targetPath: 'Observation.code', from: { field: 'result' } }],
    };
    const { update } = renderSheet({ targetId: 'test-target', mappings: [wide] });
    await waitFor(() => expect(sourceSelect('Test').value).toBe('result'));
    const option = [...sourceSelect('Test').options].find((o) => o.value === 'result');
    expect(option?.textContent).toBe('result (not in this sample)');
    expect(within(screen.getByTestId('map-row-Observation.code')).queryByText(/Example/)).toBeNull();
    openMenuAndClick('Save');
    const saved = update.mock.calls[0][0].config.mappings[0];
    expect(saved.fieldNames).toEqual(['ident', 'result']);
    expect(saved.rows.find((r: { targetPath: string }) => r.targetPath === 'Observation.code').from).toEqual({ field: 'result' });
  });

  it('warns when more than one saved mapping fits some rows', async () => {
    setRun([{ a: 'QZX-1' }]);
    const ab = { shapeHash: 'ab', fieldNames: ['a', 'b'], targetId: 'test-target', rows: [] };
    const ac = { shapeHash: 'ac', fieldNames: ['a', 'c'], targetId: 'test-target', rows: [] };
    renderSheet({ targetId: 'test-target', mappings: [ab, ac] });
    expect(await screen.findByTestId('map-ambiguous')).toHaveTextContent('More than one saved mapping fits some of these rows, so the node will hold them.');
  });

  it('does not warn when only one mapping fits', async () => {
    setRun([{ a: 'QZX-1', b: 'QZX-2' }]);
    const ab = { shapeHash: 'ab', fieldNames: ['a', 'b'], targetId: 'test-target', rows: [] };
    const ac = { shapeHash: 'ac', fieldNames: ['a', 'c'], targetId: 'test-target', rows: [] };
    renderSheet({ targetId: 'test-target', mappings: [ab, ac] });
    await screen.findByTestId('map-row-Patient.identifier.value');
    expect(screen.queryByTestId('map-ambiguous')).toBeNull();
  });

  it('keeps the system the person picked for a code found in two systems', async () => {
    setRun(ROWS_A);
    m(api.fetchMapTargets).mockResolvedValue([
      { ...TEST_TARGET, fields: TEST_TARGET.fields.map((f) => (f.path === 'Patient.gender' ? { ...f, valueSet: 'urn:test:vs' } : f)) },
    ]);
    m(api.findValueSetByUrl).mockResolvedValue({ id: 'vs1', url: 'urn:test:vs' });
    m(api.storedValueSetCodes).mockResolvedValue([
      { system: 'urn:test:a', code: 'male', display: 'A' },
      { system: 'urn:test:b', code: 'male', display: 'B' },
    ]);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'sex' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Sex' }), { target: { value: 'values' } });
    const to = (await screen.findByRole('combobox', { name: 'To 1: Sex' })) as HTMLSelectElement;
    fireEvent.change(to, { target: { value: 'urn:test:b|male' } });
    expect((screen.getByRole('combobox', { name: 'To 1: Sex' }) as HTMLSelectElement).value).toBe('urn:test:b|male');
  });

  it('opens a wider group on a narrower saved mapping, and Save writes the wider names and drops the narrower', async () => {
    setRun(ROWS_A);
    const narrow = { shapeHash: 'n', fieldNames: ['pat_no', 'test_a'], targetId: 'test-target', rows: [{ targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } }, { targetPath: 'Observation.code', from: { field: 'test_a' } }] };
    const { update } = renderSheet({ targetId: 'test-target', mappings: [narrow] });
    await waitFor(() => expect(sourceSelect('Patient ID').value).toBe('pat_no'));
    expect(sourceSelect('Test').value).toBe('test_a');
    openMenuAndClick('Save');
    const mappings = update.mock.calls[0][0].config.mappings;
    expect(mappings).toHaveLength(1);
    expect(mappings[0].fieldNames).toEqual(['pat_no', 'sex', 'test_a', 'test_b']);
    expect(mappings[0].rows).toHaveLength(2);
  });
});


describe('MapToFhirSheet one column per test', () => {
  const ROWS_WIDE = [
    { pid: 'QZX-1', AMP: 'QZX-2', CIP: 'QZX-3', GEN: 'QZX-4' },
    { pid: 'QZX-5', AMP: 'QZX-6', GEN: 'QZX-2' },
  ];
  const rowsOf = (update: ReturnType<typeof vi.fn>) => update.mock.calls[0][0].config.mappings[0].rows as { targetPath: string; from: unknown }[];
  const testInput = (column: string) => screen.getByRole('textbox', { name: `Test: ${column}` }) as HTMLInputElement;

  async function addThree() {
    setRun(ROWS_WIDE);
    const ui = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pid' } });
    fireEvent.change(sourceSelect('Result (text)'), { target: { value: 'AMP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add another column: Result (text)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'CIP' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'GEN' }));
    return ui;
  }

  it('shows a test input per column, filled with the column name, and the test row says it is set per column', async () => {
    await addThree();
    expect(['AMP', 'CIP', 'GEN'].map((c) => testInput(c).value)).toEqual(['AMP', 'CIP', 'GEN']);
    expect(screen.getByTestId('map-per-column-Observation.code')).toHaveTextContent('Set for each column on Result (text)');
    expect(screen.queryByRole('combobox', { name: 'From your data: Test' })).toBeNull();
    // The example is the first column's.
    expect(within(screen.getByTestId('map-row-Observation.valueString')).getByText('QZX-2')).toBeInTheDocument();
  });

  it('saves the columns and their tests as two rows in the same order, with the typed test, and no sample value', async () => {
    const { update } = await addThree();
    fireEvent.change(testInput('CIP'), { target: { value: 'typed-test' } });
    openMenuAndClick('Save');
    const rows = rowsOf(update);
    expect(rows.find((r) => r.targetPath === 'Observation.valueString')!.from).toEqual({ fields: ['AMP', 'CIP', 'GEN'] });
    expect(rows.find((r) => r.targetPath === 'Observation.code')!.from).toEqual({ fixedList: ['AMP', 'typed-test', 'GEN'] });
    const text = JSON.stringify(update.mock.calls[0][0].config);
    for (const v of MARKERS) expect(text).not.toContain(v);
  });

  it('sends the two rows to Test', async () => {
    await addThree();
    openMenuAndClick('Test');
    await screen.findByTestId('map-test-footer');
    const sent = m(api.testMapping).mock.calls[0][0].config.mappings[0].rows;
    expect(sent.find((r: { targetPath: string }) => r.targetPath === 'Observation.code').from).toEqual({ fixedList: ['AMP', 'CIP', 'GEN'] });
  });

  it('refuses Save while two columns have the same test, or a test is empty, naming the columns', async () => {
    const { update } = await addThree();
    fireEvent.change(testInput('GEN'), { target: { value: ' AMP ' } });
    openMenuAndClick('Save');
    expect(screen.getByRole('alert')).toHaveTextContent('These columns have the same test: AMP, GEN. Give each column its own test.');
    fireEvent.change(testInput('GEN'), { target: { value: '  ' } });
    openMenuAndClick('Save');
    expect(screen.getByRole('alert')).toHaveTextContent('Each column needs a test. Fill in the test for GEN.');
    expect(update).not.toHaveBeenCalled();
  });

  it('opens a saved mapping with its columns and their tests', async () => {
    setRun(ROWS_WIDE);
    const saved = {
      shapeHash: 'w', fieldNames: ['AMP', 'CIP', 'GEN', 'pid'], targetId: 'test-target',
      rows: [
        { targetPath: 'Patient.identifier.value', from: { field: 'pid' } },
        { targetPath: 'Observation.code', from: { fixedList: ['amp-t', 'cip-t', 'gen-t'] } },
        { targetPath: 'Observation.valueString', from: { fields: ['AMP', 'CIP', 'GEN'] } },
      ],
    };
    renderSheet({ targetId: 'test-target', mappings: [saved] });
    await waitFor(() => expect(testInput('AMP').value).toBe('amp-t'));
    expect(testInput('CIP').value).toBe('cip-t');
    expect(testInput('GEN').value).toBe('gen-t');
    expect(screen.getByTestId('map-per-column-Observation.code')).toBeInTheDocument();
  });

  it('makes the test row an ordinary row again when the columns go back to one', async () => {
    await addThree();
    fireEvent.click(screen.getByRole('button', { name: 'Remove CIP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove GEN' }));
    expect(screen.queryByTestId('map-per-column-Observation.code')).toBeNull();
    expect(sourceSelect('Test')).toBeInTheDocument();
  });

  it('filters the columns and selects every one shown', async () => {
    setRun([{ pid: 'QZX-1', AMP: 'QZX-2', AMX: 'QZX-3', GEN: 'QZX-4' }]);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Result (text)'), { target: { value: 'GEN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add another column: Result (text)' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter columns: Result (text)' }), { target: { value: 'am' } });
    expect(screen.queryByRole('checkbox', { name: 'pid' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }));
    expect(['GEN', 'AMP', 'AMX'].map((c) => testInput(c).value)).toEqual(['GEN', 'AMP', 'AMX']);
  });

  it('refuses Save when a second result field has another number of columns', async () => {
    const { update } = await addThree();
    fireEvent.change(sourceSelect('Result (number)'), { target: { value: 'AMP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add another column: Result (number)' }));
    fireEvent.click(within(screen.getByTestId('map-column-picker-Result (number)')).getByRole('checkbox', { name: 'CIP' }));
    expect(screen.getByText('Each column takes the test on the same line of Result (text).')).toBeInTheDocument();
    openMenuAndClick('Save');
    expect(screen.getByRole('alert')).toHaveTextContent('Result (number) has 2 columns and Result (text) has 3.');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('MapToFhirSheet Excel dates and coded values', () => {
  it('suggests the Excel date rule for day numbers, and saves it once accepted', async () => {
    setRun([{ pid: 'QZX-1', t: 'QZX-2', dob: '45000' }, { pid: 'QZX-3', t: 'QZX-4', dob: 45001.5 }]);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pid' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 't' } });
    fireEvent.change(sourceSelect('Date of birth'), { target: { value: 'dob' } });
    expect(screen.getByTestId('map-rule-suggestion-Patient.birthDate')).toHaveTextContent('Suggested rule: date, Excel date cell');
    fireEvent.click(screen.getByRole('button', { name: 'Accept: Rule: Date of birth' }));
    expect((screen.getByRole('combobox', { name: 'Date is: Date of birth' }) as HTMLSelectElement).value).toBe('excel');
    expect(screen.queryByRole('textbox', { name: 'Format: Date of birth' })).toBeNull();
    openMenuAndClick('Save');
    const rows = update.mock.calls[0][0].config.mappings[0].rows;
    expect(rows.find((r: { targetPath: string }) => r.targetPath === 'Patient.birthDate').rule).toEqual({ kind: 'date', format: 'excel' });
  });

  it('switches the date rule between a written date, with a format, and an Excel date cell, without one', async () => {
    setRun([{ pid: 'QZX-1', dob: 'QZX-2' }]);
    renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Date of birth'), { target: { value: 'dob' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Date of birth' }), { target: { value: 'date' } });
    expect((screen.getByRole('combobox', { name: 'Date is: Date of birth' }) as HTMLSelectElement).value).toBe('written');
    expect(screen.getByRole('textbox', { name: 'Format: Date of birth' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Date is: Date of birth' }), { target: { value: 'excel' } });
    expect(screen.queryByRole('textbox', { name: 'Format: Date of birth' })).toBeNull();
  });

  it('gives Sex its FHIR list: the sample values on From, a code picker on To, and the code a value names picked', async () => {
    // Sex has no value set of its own. Its FHIR binding takes a whole code system, so nothing is
    // stored and the codes come from the live expansion, as the forms read them.
    m(api.findValueSetByUrl).mockImplementation(async (url: string) => ({ id: 'vs-g', url }));
    m(api.storedValueSetCodes).mockResolvedValue([]);
    m(api.expandValueSetByUrl).mockResolvedValue([
      { system: 'urn:test:g', code: 'female', display: 'Female' },
      { system: 'urn:test:g', code: 'male', display: 'Male' },
    ]);
    setRun([
      { pid: 'QZX-1', t: 'QZX-2', sx: 'QZX-F' },
      { pid: 'QZX-3', t: 'QZX-4', sx: ' MALE ' },
      { pid: 'QZX-5', t: 'QZX-6', sx: 'Fem' },
    ]);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pid' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 't' } });
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'sx' } });
    await screen.findByTestId('map-rule-suggestion-Patient.gender');
    fireEvent.click(screen.getByRole('button', { name: 'Accept: Rule: Sex' }));
    expect((await screen.findByRole('textbox', { name: 'From 1: Sex' }) as HTMLInputElement).value).toBe('QZX-F');
    expect((screen.getByRole('textbox', { name: 'From 2: Sex' }) as HTMLInputElement).value).toBe('MALE');
    // A value equal to a code's display, ignoring case and spaces, has that code picked. Part of a
    // display is no match.
    expect((await screen.findByRole('combobox', { name: 'To 1: Sex' }) as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('combobox', { name: 'To 2: Sex' }) as HTMLSelectElement).value).toBe('urn:test:g|male');
    expect((screen.getByRole('combobox', { name: 'To 3: Sex' }) as HTMLSelectElement).value).toBe('');
    openMenuAndClick('Save');
    const gender = update.mock.calls[0][0].config.mappings[0].rows.find((r: { targetPath: string }) => r.targetPath === 'Patient.gender');
    expect(gender.rule).toEqual({ kind: 'values', map: { MALE: { system: 'urn:test:g', code: 'male' } } });
    expect(JSON.stringify(update.mock.calls[0][0].config)).not.toContain('QZX-F');
  });
});

describe('MapToFhirSheet preselected codes on a Values rule picked by hand', () => {
  beforeEach(() => {
    m(api.findValueSetByUrl).mockImplementation(async (url: string) => ({ id: 'vs-g', url }));
    m(api.storedValueSetCodes).mockResolvedValue([
      { system: 'urn:test:g', code: 'male', display: 'QZX-9' },
      { system: 'urn:test:g', code: 'female', display: 'Female' },
    ]);
  });

  async function pickValuesByHand() {
    setRun([{ pid: 'QZX-1', t: 'QZX-2', sx: 'QZX-9' }, { pid: 'QZX-3', t: 'QZX-4', sx: 'QZX-8' }]);
    const ui = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Patient ID'), { target: { value: 'pid' } });
    fireEvent.change(sourceSelect('Test'), { target: { value: 't' } });
    fireEvent.change(sourceSelect('Sex'), { target: { value: 'sx' } });
    // Once the codes have loaded (the suggestion shows), the person picks Values without accepting it.
    await screen.findByTestId('map-rule-suggestion-Patient.gender');
    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Sex' }), { target: { value: 'values' } });
    // Line 1 names a code, so it is picked, as a suggestion. Line 2 the person picks.
    expect((await screen.findByRole('combobox', { name: 'To 1: Sex' }) as HTMLSelectElement).value).toBe('urn:test:g|male');
    fireEvent.change(screen.getByRole('combobox', { name: 'To 2: Sex' }), { target: { value: 'urn:test:g|female' } });
    return ui;
  }
  const genderRule = (update: ReturnType<typeof vi.fn>) =>
    update.mock.calls.at(-1)![0].config.mappings[0].rows.find((r: { targetPath: string }) => r.targetPath === 'Patient.gender').rule;

  it('leaves a picked-for-you line out of Save until the person accepts it', async () => {
    const { update } = await pickValuesByHand();
    expect(screen.getByTestId('map-values-suggested-Sex')).toHaveTextContent('Codes the sheet picked are suggestions.');
    openMenuAndClick('Save');
    expect(genderRule(update)).toEqual({ kind: 'values', map: { 'QZX-8': { system: 'urn:test:g', code: 'female' } } });
    expect(JSON.stringify(update.mock.calls.at(-1)![0].config)).not.toContain('QZX-9');

    fireEvent.click(screen.getByRole('button', { name: 'Accept: To: Sex' }));
    expect(screen.queryByTestId('map-values-suggested-Sex')).toBeNull();
    openMenuAndClick('Save');
    expect(genderRule(update)).toEqual({ kind: 'values', map: { 'QZX-9': { system: 'urn:test:g', code: 'male' }, 'QZX-8': { system: 'urn:test:g', code: 'female' } } });
  });

  it('keeps a picked-for-you line once the person changes its To', async () => {
    const { update } = await pickValuesByHand();
    fireEvent.change(screen.getByRole('combobox', { name: 'To 1: Sex' }), { target: { value: 'urn:test:g|female' } });
    openMenuAndClick('Save');
    expect(Object.keys(genderRule(update).map)).toEqual(['QZX-9', 'QZX-8']);
  });

  it('leaves a picked-for-you line out of Test too', async () => {
    await pickValuesByHand();
    openMenuAndClick('Test');
    await screen.findByTestId('map-test-footer');
    expect(JSON.stringify(m(api.testMapping).mock.calls[0][0].config)).not.toContain('QZX-9');
  });
});

describe('MapToFhirSheet saves what a workflow run reads', () => {
  const target = labResultTarget(seededStarterPacks());
  const label = (path: string) => target.fields.find((f) => f.path === path)!.label;
  const ROWS = [
    { pat_no: 'T-0401', gender: 'M', dob: '45000', sample_no: 'S-0401', sample_type: 'Urine', coll_dt: '2026-11-05', organism: 'QZX-ORG', AMP: 'R', CIP: 'S' },
    { pat_no: 'T-0402', gender: 'M', dob: '45001', sample_no: 'S-0402', sample_type: 'Urine', coll_dt: '2026-11-06', organism: 'QZX-ORG', AMP: 'S', GEN: 'I' },
  ];

  it('saves a per-test mapping with a coded Values rule and an Excel date that passes the schema after a JSON round trip', async () => {
    m(api.fetchMapTargets).mockResolvedValue([target]);
    m(api.findValueSetByUrl).mockImplementation(async (url: string) => (url.includes('specimen-type') ? { id: 'vs-s', url } : null));
    m(api.storedValueSetCodes).mockResolvedValue([{ system: 'urn:test:specimen', code: 'UR', display: 'Urine' }]);
    setRun(ROWS);
    const { update } = renderSheet();
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect(label('Patient.identifier.value')), { target: { value: 'pat_no' } });
    fireEvent.change(sourceSelect(label('Specimen.collection.collectedDateTime')), { target: { value: 'coll_dt' } });
    fireEvent.change(sourceSelect(label('Patient.birthDate')), { target: { value: 'dob' } });
    fireEvent.click(screen.getByRole('button', { name: `Accept: Rule: ${label('Patient.birthDate')}` }));
    fireEvent.change(sourceSelect(label('Specimen.type')), { target: { value: 'sample_type' } });
    await screen.findByTestId('map-rule-suggestion-Specimen.type');
    fireEvent.click(screen.getByRole('button', { name: `Accept: Rule: ${label('Specimen.type')}` }));
    expect((await screen.findByRole('combobox', { name: `To 1: ${label('Specimen.type')}` }) as HTMLSelectElement).value).toBe('urn:test:specimen|UR');
    fireEvent.change(sourceSelect(label('Observation.valueString')), { target: { value: 'AMP' } });
    fireEvent.click(screen.getByRole('button', { name: `Add another column: ${label('Observation.valueString')}` }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'CIP' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'GEN' }));
    openMenuAndClick('Save');

    const config = update.mock.calls[0][0].config;
    const back = JSON.parse(JSON.stringify(config));
    const parsed = SavedMappingSchema.safeParse(back.mappings[0]);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(back.mappings[0]).toEqual(config.mappings[0]);
    const rows = back.mappings[0].rows as { targetPath: string; from: unknown; rule?: unknown }[];
    const byPath = (k: string) => rows.find((r) => r.targetPath === k)!;
    expect(byPath('Observation.code').from).toEqual({ fixedList: ['AMP', 'CIP', 'GEN'] });
    expect(byPath('Observation.valueString').from).toEqual({ fields: ['AMP', 'CIP', 'GEN'] });
    expect(byPath('Specimen.type').rule).toEqual({ kind: 'values', map: { Urine: { system: 'urn:test:specimen', code: 'UR' } } });
    expect(byPath('Patient.birthDate').rule).toEqual({ kind: 'date', format: 'excel' });
  });
});

describe('MapToFhirSheet column list keys', () => {
  async function openPicker(onOpenChange = vi.fn()) {
    setRun([{ pid: 'QZX-1', AMP: 'QZX-2', CIP: 'QZX-3' }]);
    render(<MapToFhirSheet open onOpenChange={onOpenChange} node={mkNode()} update={vi.fn()} />);
    await screen.findByTestId('map-row-Patient.identifier.value');
    fireEvent.change(sourceSelect('Result (text)'), { target: { value: 'AMP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add another column: Result (text)' }));
    return onOpenChange;
  }

  it('closes only the column list when Escape is pressed in its filter box', async () => {
    const onOpenChange = await openPicker();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Filter columns: Result (text)' }), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Filter columns: Result (text)' })).toBeNull();
  });

  it('names the column list\'s close button apart from the sheet\'s', async () => {
    await openPicker();
    expect(screen.getByRole('button', { name: 'Close column list' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });
});
