import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DataTab } from './DataTab';
import { queryApi } from '../query/api';
import type { DesignElement } from './types';

vi.mock('../query/api', () => ({
  queryApi: {
    list: vi.fn(async () => [{ id: 'cq_1', name: 'AMR', connectorId: 'c1', sql: 'select 1', params: [] }]),
    run: vi.fn(async () => ({ columns: [{ key: 'org', label: 'Organism' }, { key: 'pct', label: '%R' }], rows: [] })),
  },
}));

const tableEl = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 't', kind: 'table', name: 'Table', rect: { x: 0, y: 0, w: 200, h: 100 }, ...over,
});

function setup(over: Partial<DesignElement> = {}) {
  const onPatchElement = vi.fn();
  const onPatchParameters = vi.fn();
  const utils = render(<DataTab element={tableEl(over)} parameters={[]} onPatchElement={onPatchElement} onPatchParameters={onPatchParameters} />);
  return { onPatchElement, onPatchParameters, ...utils };
}

// The query list resolves asynchronously; retry the Load-columns click until run() fires.
async function loadColumns() {
  const loadBtn = screen.getByRole('button', { name: /load columns/i });
  await waitFor(() => {
    fireEvent.click(loadBtn);
    expect(queryApi.run).toHaveBeenCalled();
  });
}

describe('DataTab table binding', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows a hint when the selected element is not a table', () => {
    render(<DataTab element={undefined} parameters={[]} onPatchElement={vi.fn()} onPatchParameters={vi.fn()} />);
    expect(screen.getByText(/select a table/i)).toBeInTheDocument();
  });

  it('binds the table to a picked custom query (discrete)', async () => {
    const { onPatchElement } = setup();
    fireEvent.click(screen.getByLabelText('Bind query'));
    const opt = await screen.findByText('AMR');
    fireEvent.click(opt);
    expect(onPatchElement).toHaveBeenCalledWith('t', { dataSource: { kind: 'custom-query', queryId: 'cq_1' } }, { discrete: true });
  });

  it('loads result columns and includes one into boundColumns (discrete)', async () => {
    const { onPatchElement } = setup({ dataSource: { kind: 'custom-query', queryId: 'cq_1' } });
    await loadColumns();
    fireEvent.click(await screen.findByLabelText('org'));
    expect(onPatchElement).toHaveBeenCalledWith('t', { boundColumns: [{ key: 'org', label: 'Organism' }] }, { discrete: true });
  });

  it('relabelling an included column is coalesced (no discrete opt)', async () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'org', label: 'Organism' }],
    });
    // The label Input for the included column carries the translated aria-label suffixed with the key.
    fireEvent.change(screen.getByLabelText('Label for column org'), { target: { value: 'Bug' } });
    expect(onPatchElement).toHaveBeenLastCalledWith('t', { boundColumns: [{ key: 'org', label: 'Bug' }] }, undefined);
  });

  it('reorders included columns via move-down (discrete)', async () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'org', label: 'Organism' }, { key: 'pct', label: '%R' }],
    });
    await loadColumns();
    fireEvent.click(screen.getByLabelText('Move down Organism'));
    expect(onPatchElement).toHaveBeenLastCalledWith(
      't',
      { boundColumns: [{ key: 'pct', label: '%R' }, { key: 'org', label: 'Organism' }] },
      { discrete: true },
    );
  });

  it('binds a status column to an included column (discrete)', async () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'org', label: 'Organism' }],
    });
    await loadColumns();
    // 'pct' is the only result column not already shown as a visible bound column, so it's the
    // sole status-source choice besides None.
    fireEvent.click(screen.getByLabelText('Status column for Organism'));
    fireEvent.click(await screen.findByText('%R'));
    expect(onPatchElement).toHaveBeenLastCalledWith(
      't',
      { boundColumns: [{ key: 'org', label: 'Organism', statusKey: 'pct' }] },
      { discrete: true },
    );
  });

  it('clears statusKey when the status column is set back to none (discrete)', async () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'org', label: 'Organism', statusKey: 'pct' }],
    });
    await loadColumns();
    fireEvent.click(screen.getByLabelText('Status column for Organism'));
    fireEvent.click(await screen.findByRole('option', { name: 'None' }));
    expect(onPatchElement).toHaveBeenLastCalledWith(
      't',
      { boundColumns: [{ key: 'org', label: 'Organism' }] },
      { discrete: true },
    );
    // A column with no statusKey behaves exactly as before this slice: no stray property left behind.
    expect(onPatchElement.mock.calls.at(-1)?.[1].boundColumns[0]).not.toHaveProperty('statusKey');
  });

  it('disables the emphasis control for a column with no statusKey', async () => {
    setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'org', label: 'Organism' }],
    });
    await loadColumns();
    expect(await screen.findByLabelText('Emphasis for Organism')).toBeDisabled();
  });

  it('sets emphasis to fill on a status-bound column (discrete)', async () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'org', label: 'Organism', statusKey: 'pct' }],
    });
    await loadColumns();
    const emphasisSelect = await screen.findByLabelText('Emphasis for Organism');
    expect(emphasisSelect).not.toBeDisabled();
    fireEvent.click(emphasisSelect);
    fireEvent.click(await screen.findByText('Filled chip'));
    expect(onPatchElement).toHaveBeenLastCalledWith(
      't',
      { boundColumns: [{ key: 'org', label: 'Organism', statusKey: 'pct', emphasis: 'fill' }] },
      { discrete: true },
    );
  });

  it('clears emphasis when set back to the default tinted-text option (discrete)', async () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'org', label: 'Organism', statusKey: 'pct', emphasis: 'fill' }],
    });
    await loadColumns();
    fireEvent.click(await screen.findByLabelText('Emphasis for Organism'));
    fireEvent.click(await screen.findByText('Tinted text'));
    expect(onPatchElement).toHaveBeenLastCalledWith(
      't',
      { boundColumns: [{ key: 'org', label: 'Organism', statusKey: 'pct' }] },
      { discrete: true },
    );
    // Regression guard: toEqual would treat a missing key and an explicit `emphasis: undefined` as
    // equal, masking a bug where the property is set to undefined instead of deleted.
    expect(onPatchElement.mock.calls.at(-1)?.[1].boundColumns[0]).not.toHaveProperty('emphasis');
  });

  it('renders the error line when the query run rejects', async () => {
    (queryApi.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    setup({ dataSource: { kind: 'custom-query', queryId: 'cq_1' } });
    await loadColumns();
    expect(await screen.findByText('Could not load columns. Check the query and its parameters.')).toBeInTheDocument();
  });

  it('recovers the Load button when the element is switched mid-flight', async () => {
    // A deferred run() that stays pending until we resolve it, simulating an in-flight load.
    let resolveRun: (v: { columns: { key: string; label: string }[]; rows: unknown[] }) => void = () => {};
    (queryApi.run as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise((r) => { resolveRun = r; }));

    const props = { parameters: [], onPatchElement: vi.fn(), onPatchParameters: vi.fn() };
    const { rerender } = render(<DataTab element={tableEl({ id: 't', dataSource: { kind: 'custom-query', queryId: 'cq_1' } })} {...props} />);

    const loadBtn = () => screen.getByRole('button', { name: /load columns/i });
    // Fire the load; wait until run() is actually dispatched (queries must be loaded first).
    await waitFor(() => { fireEvent.click(loadBtn()); expect(queryApi.run).toHaveBeenCalled(); });
    expect(loadBtn()).toBeDisabled(); // loading === true while the deferred is pending

    // Switch to a different element while the first run is still pending.
    rerender(<DataTab element={tableEl({ id: 't2', dataSource: { kind: 'custom-query', queryId: 'cq_1' } })} {...props} />);
    // Resolve the stale run late — its result must be ignored, and loading must not stay stuck.
    resolveRun({ columns: [{ key: 'org', label: 'Organism' }], rows: [] });

    await waitFor(() => expect(loadBtn()).not.toBeDisabled());
  });

  it('clears loaded columns when a different element is selected', async () => {
    const onPatchElement = vi.fn();
    const props = { parameters: [], onPatchElement, onPatchParameters: vi.fn() };
    const { rerender } = render(<DataTab element={tableEl({ id: 't', dataSource: { kind: 'custom-query', queryId: 'cq_1' } })} {...props} />);
    await loadColumns();
    expect(await screen.findByLabelText('org')).toBeInTheDocument();
    rerender(<DataTab element={tableEl({ id: 't2', dataSource: { kind: 'custom-query', queryId: 'cq_1' } })} {...props} />);
    expect(screen.queryByLabelText('org')).toBeNull();
    expect(screen.getByText(/no columns loaded/i)).toBeInTheDocument();
  });
});

describe('DataTab design parameters', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('adds and edits a design parameter (text + daterange)', () => {
    const onPatchParameters = vi.fn();
    render(<DataTab element={undefined} parameters={[]} onPatchElement={vi.fn()} onPatchParameters={onPatchParameters} />);
    fireEvent.click(screen.getByText(/add parameter/i));
    expect(onPatchParameters).toHaveBeenCalledWith([expect.objectContaining({ key: expect.any(String), type: 'text' })]);
  });

  it('renders from/to inputs for a daterange param and patches its value', () => {
    const onPatchParameters = vi.fn();
    const params = [{ key: 'range', label: 'Range', type: 'daterange' as const, value: { from: '', to: '' } }];
    render(<DataTab element={undefined} parameters={params} onPatchElement={vi.fn()} onPatchParameters={onPatchParameters} />);
    const from = screen.getByLabelText(/from/i);
    fireEvent.change(from, { target: { value: '2026-01-01' } });
    fireEvent.blur(from);
    expect(onPatchParameters).toHaveBeenCalledWith([expect.objectContaining({ value: { from: '2026-01-01', to: '' } })]);
  });

  it('commits a text param value on blur and removes a param', () => {
    const onPatchParameters = vi.fn();
    const params = [{ key: 'facility', label: 'Facility', type: 'text' as const, value: '' }];
    render(<DataTab element={undefined} parameters={params} onPatchElement={vi.fn()} onPatchParameters={onPatchParameters} />);
    const val = screen.getByLabelText('Value for facility');
    fireEvent.change(val, { target: { value: 'Ndola' } });
    fireEvent.blur(val);
    expect(onPatchParameters).toHaveBeenCalledWith([expect.objectContaining({ value: 'Ndola' })]);
    fireEvent.click(screen.getByLabelText('Remove parameter facility'));
    expect(onPatchParameters).toHaveBeenLastCalledWith([]);
  });

  it('resets value to a text default when the type changes away from daterange', async () => {
    const onPatchParameters = vi.fn();
    const params = [{ key: 'p', label: 'P', type: 'daterange' as const, value: { from: '2026-01-01', to: '2026-06-30' } }];
    render(<DataTab element={undefined} parameters={params} onPatchElement={vi.fn()} onPatchParameters={onPatchParameters} />);
    fireEvent.click(screen.getByLabelText('Type p')); // open the type Select (jsdom pointerDown-driven)
    fireEvent.click(await screen.findByText('Text'));
    expect(onPatchParameters).toHaveBeenCalledWith([expect.objectContaining({ type: 'text', value: '' })]);
    // The stale daterange object is gone — never committed with both a text type and a {from,to} value.
    expect(onPatchParameters).not.toHaveBeenCalledWith([expect.objectContaining({ type: 'text', value: { from: '2026-01-01', to: '2026-06-30' } })]);
  });

  it('rejects a key rename that collides with a sibling param', () => {
    const onPatchParameters = vi.fn();
    const params = [
      { key: 'param1', label: 'Param 1', type: 'text' as const, value: '' },
      { key: 'param2', label: 'Param 2', type: 'text' as const, value: '' },
    ];
    render(<DataTab element={undefined} parameters={params} onPatchElement={vi.fn()} onPatchParameters={onPatchParameters} />);
    const keyInput = screen.getByLabelText('Key param2');
    fireEvent.change(keyInput, { target: { value: 'param1' } });
    fireEvent.blur(keyInput);
    // The duplicate rename must be rejected: no patch that would produce two 'param1' keys.
    for (const call of onPatchParameters.mock.calls) {
      const next = call[0] as Array<{ key: string }>;
      expect(next.filter((p) => p.key === 'param1').length).toBeLessThan(2);
    }
  });
});

describe('DataTab keyvalue binding', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const kvEl = (over: Partial<DesignElement> = {}): DesignElement => ({
    id: 'kv', kind: 'keyvalue', name: 'Panel', rect: { x: 0, y: 0, w: 200, h: 100 }, ...over,
  });

  it('binds a keyvalue panel through the same editor as a table, labelled Fields', async () => {
    const onPatchElement = vi.fn();
    render(<DataTab element={kvEl({ dataSource: { kind: 'custom-query', queryId: 'cq_1' } })}
      parameters={[]} onPatchElement={onPatchElement} onPatchParameters={vi.fn()} />);
    expect(screen.queryByText(/select a table/i)).not.toBeInTheDocument();
    expect(screen.getByText('Fields')).toBeInTheDocument();
    await loadColumns();
    fireEvent.click(await screen.findByLabelText('org'));
    // One bound column === one label→value pair.
    expect(onPatchElement).toHaveBeenCalledWith('kv',
      { boundColumns: [{ key: 'org', label: 'Organism' }] }, { discrete: true });
  });

  it('still refuses to bind a kind that has no binding, e.g. a rect', () => {
    render(<DataTab element={{ id: 'r', kind: 'rect', name: 'R', rect: { x: 0, y: 0, w: 1, h: 1 } }}
      parameters={[]} onPatchElement={vi.fn()} onPatchParameters={vi.fn()} />);
    expect(screen.getByText(/select a table/i)).toBeInTheDocument();
  });
});

describe('DataTab sortBy, headerRow and cellgrid binding', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const cgEl = (over: Partial<DesignElement> = {}): DesignElement => ({
    id: 'cg', kind: 'cellgrid', name: 'Grid', rect: { x: 0, y: 0, w: 480, h: 160 },
    cellColumns: ['c1'], ...over,
  });

  it('lets a cellgrid pick a query but shows no include-columns list', async () => {
    const onPatchElement = vi.fn();
    render(<DataTab element={cgEl()} parameters={[]} onPatchElement={onPatchElement} onPatchParameters={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Bind query'));
    fireEvent.click(await screen.findByText('AMR'));
    expect(onPatchElement).toHaveBeenCalledWith('cg', { dataSource: { kind: 'custom-query', queryId: 'cq_1' } }, { discrete: true });
    expect(screen.queryByText('No columns loaded yet.')).toBeNull();
  });

  it('writes sortBy for a bound table (coalesced) and deletes it when blanked', () => {
    const { onPatchElement } = setup({ dataSource: { kind: 'custom-query', queryId: 'cq_1' }, sortBy: 'ord' });
    fireEvent.change(screen.getByLabelText('Sort by column'), { target: { value: '' } });
    expect(onPatchElement).toHaveBeenCalledWith('t', { sortBy: undefined, headerRow: undefined });
  });

  it('writes sortBy on a bound cellgrid too', () => {
    const onPatchElement = vi.fn();
    render(<DataTab element={cgEl({ dataSource: { kind: 'custom-query', queryId: 'cq_1' } })}
      parameters={[]} onPatchElement={onPatchElement} onPatchParameters={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Sort by column'), { target: { value: 'ord' } });
    expect(onPatchElement).toHaveBeenCalledWith('cg', { sortBy: 'ord' });
  });

  it('hides sortBy until a query is bound', () => {
    setup();
    expect(screen.queryByLabelText('Sort by column')).toBeNull();
  });

  it('disables the header-row checkbox until sortBy is set, with the explanation', () => {
    setup({ dataSource: { kind: 'custom-query', queryId: 'cq_1' } });
    expect(screen.getByLabelText('First data row is the header')).toBeDisabled();
    expect(screen.getByText('Set Sort by first.')).toBeInTheDocument();
  });

  it('writes headerRow with sortBy present, and deletes it when unchecked', () => {
    const { onPatchElement } = setup({ dataSource: { kind: 'custom-query', queryId: 'cq_1' }, sortBy: 'ord' });
    fireEvent.click(screen.getByLabelText('First data row is the header'));
    expect(onPatchElement).toHaveBeenCalledWith('t', { headerRow: true }, { discrete: true });
  });

  it('offers no header-row checkbox on a cellgrid', () => {
    render(<DataTab element={cgEl({ dataSource: { kind: 'custom-query', queryId: 'cq_1' } })}
      parameters={[]} onPatchElement={vi.fn()} onPatchParameters={vi.fn()} />);
    expect(screen.queryByLabelText('First data row is the header')).toBeNull();
  });

  it('replaces the columns list with the transposed note for a transposed table', () => {
    setup({ dataSource: { kind: 'custom-query', queryId: 'cq_1' }, transpose: true });
    expect(screen.getByText(/headers come from the data/i)).toBeInTheDocument();
    expect(screen.queryByText('No columns loaded yet.')).toBeNull();
  });
});

describe('parameter rows explain themselves', () => {
  it('captions key, label, type and the default value, and states what parameters are', () => {
    render(<DataTab element={undefined}
      parameters={[{ key: 'dateRange', label: 'Date range', type: 'daterange' as const, value: { from: '', to: '' } }]}
      onPatchElement={vi.fn()} onPatchParameters={vi.fn()} />);
    expect(screen.getByText('Key')).toBeInTheDocument();
    expect(screen.getByText('Label')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Default from')).toBeInTheDocument();
    expect(screen.getByText('Default to')).toBeInTheDocument();
    expect(screen.getByText(/values here are only defaults/i)).toBeInTheDocument();
  });

  it('captions a text parameter with Default value', () => {
    render(<DataTab element={undefined}
      parameters={[{ key: 'facility', label: 'Facility', type: 'text' as const, value: '' }]}
      onPatchElement={vi.fn()} onPatchParameters={vi.fn()} />);
    expect(screen.getByText('Default value')).toBeInTheDocument();
  });
});

describe('chart binding', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('a chart binds a query, sorts here, and points at Properties for its columns', async () => {
    const onPatchElement = vi.fn();
    render(<DataTab element={{ id: 'ch', kind: 'chart', name: 'Chart', rect: { x: 0, y: 0, w: 480, h: 200 },
      chartType: 'bar', dataSource: { kind: 'custom-query', queryId: 'cq_1' } }}
      parameters={[]} onPatchElement={onPatchElement} onPatchParameters={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Sort by column'), { target: { value: 'month' } });
    expect(onPatchElement).toHaveBeenCalledWith('ch', { sortBy: 'month' });
    expect(screen.getByText('Chart type and columns are set in the Properties tab.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load columns/i })).toBeNull();
  });
});

describe('decimals column option', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('writes clamped decimals and deletes the key when blanked', () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'pct', label: '%R' }],
    });
    fireEvent.change(screen.getByLabelText('Decimals for %R'), { target: { value: '7' } });
    expect(onPatchElement).toHaveBeenLastCalledWith('t', { boundColumns: [{ key: 'pct', label: '%R', decimals: 4 }] }, undefined);
    const clearing = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'pct', label: '%R', decimals: 1 }],
    });
    fireEvent.change(screen.getAllByLabelText('Decimals for %R')[1], { target: { value: '' } });
    expect(clearing.onPatchElement).toHaveBeenLastCalledWith('t', { boundColumns: [{ key: 'pct', label: '%R' }] }, undefined);
  });
});

describe('totals editor', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('typing a label turns totals on, blanking deletes it, and column checkboxes toggle sums', () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'count', label: 'Count' }],
    });
    fireEvent.change(screen.getByLabelText('Totals label'), { target: { value: 'Total' } });
    expect(onPatchElement).toHaveBeenLastCalledWith('t', { totals: { label: 'Total', columns: [] } });
    const withTotals = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'count', label: 'Count' }],
      totals: { label: 'Total', columns: [] },
    });
    fireEvent.click(screen.getAllByLabelText('Sum Count')[0]);
    expect(withTotals.onPatchElement).toHaveBeenCalledWith('t', { totals: { label: 'Total', columns: ['count'] } }, { discrete: true });
    fireEvent.change(screen.getAllByLabelText('Totals label')[1], { target: { value: '' } });
    expect(withTotals.onPatchElement).toHaveBeenLastCalledWith('t', { totals: undefined });
  });
});

describe('rule editor', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('picking an op creates a default rule, and None removes it (discrete)', () => {
    const { onPatchElement } = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'silent', label: 'Silent' }],
    });
    fireEvent.click(screen.getByLabelText('Rule for Silent'));
    fireEvent.click(screen.getByRole('option', { name: '≥' }));
    expect(onPatchElement).toHaveBeenCalledWith('t',
      { boundColumns: [{ key: 'silent', label: 'Silent', rule: { op: 'gte', value: '', status: 'critical' } }] }, { discrete: true });
    const withRule = setup({
      dataSource: { kind: 'custom-query', queryId: 'cq_1' },
      boundColumns: [{ key: 'silent', label: 'Silent', rule: { op: 'gte', value: '10', status: 'critical' } }],
    });
    fireEvent.change(screen.getAllByLabelText('Rule value for Silent')[0], { target: { value: '12' } });
    expect(withRule.onPatchElement).toHaveBeenCalledWith('t',
      { boundColumns: [{ key: 'silent', label: 'Silent', rule: { op: 'gte', value: '12', status: 'critical' } }] }, { discrete: true });
  });
});
