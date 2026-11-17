import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as api from '@/api';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
import { MapToFhirSheet } from './MapToFhirSheet';
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
    expect(await screen.findByText(/Save the workflow first/)).toBeInTheDocument();
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
    expect(labels).toContain('2 fields, 1 row');
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
    expect(offered).not.toContain('Patient.birthDate');
    expect(offered).toContain('Patient.active');
    fireEvent.change(pathSelect, { target: { value: 'Patient.active' } });
    const row = screen.getByTestId('map-row-Patient.active');
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
    expect(await screen.findByTestId('map-rule-suggestion-Patient.gender')).toHaveTextContent('add one line per value in your file');
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

  it('opens the accepted values rule with no lines, and does not send an unaccepted rule to Test', async () => {
    m(api.testMapping).mockResolvedValue([{ ok: false, reason: 'Observation.valueQuantity.value needs a number', field: 'Observation.valueQuantity.value' }, { ok: true, kind: 'mapped', resourceTypes: ['Patient'], resources: [] }]);
    await mapForm();
    await screen.findByTestId('map-rule-suggestion-Patient.gender');
    fireEvent.click(screen.getByRole('button', { name: 'Accept: Rule: Sex' }));
    expect(screen.queryByRole('textbox', { name: 'From 1: Sex' })).toBeNull();
    expect(screen.getByText('Add one line per value in your file.')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Rule: Sex' }), { target: { value: 'none' } });
    openMenuAndClick('Test');
    const footer = await screen.findByTestId('map-test-footer');
    const sent = m(api.testMapping).mock.calls[0][0].config.mappings[0].rows;
    expect(sent.every((r: { rule?: unknown }) => r.rule === undefined)).toBe(true);
    // A reason reads in the sheet's labels, and the result is pinned at the bottom.
    expect(within(footer).getByText('Result (number): needs a number')).toBeInTheDocument();
    expect(footer.className).toContain('sticky');
    expect(screen.getByTestId('map-status')).toHaveTextContent('1 row of 2 passes');
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

  it('groups rows that lack a column with the row that has it, and takes the example from the first row with a value', async () => {
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
    expect(screen.getByTestId('map-replaces-narrower')).toHaveTextContent('This replaces 1 saved mapping that covers fewer columns.');
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
    fireEvent.change(screen.getByRole('textbox', { name: 'From 1: Sex' }), { target: { value: 'm' } });
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
    // The codes load first, so the inputs show after the loader.
    fireEvent.change(await screen.findByRole('textbox', { name: 'From 1: Sex' }), { target: { value: 'm' } });
    const to = (await screen.findByRole('combobox', { name: 'To 1: Sex' })) as HTMLSelectElement;
    expect([...to.options].map((o) => o.value)).toEqual(['', 'urn:test:a|male', 'urn:test:b|male']);
    fireEvent.change(to, { target: { value: 'urn:test:b|male' } });
    openMenuAndClick('Save');
    const row = update.mock.calls[0][0].config.mappings[0].rows.find((r: { targetPath: string }) => r.targetPath === 'Patient.gender');
    expect(row.rule).toEqual({ kind: 'values', map: { m: 'male' } });
  });
});

