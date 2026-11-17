import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RunDetail, RunStatus, runCounts } from './run-history-drawer';

// CodeMirror (JsonView) is awkward in jsdom — render it as a textarea showing the value.
vi.mock('../node-forms/code-editor', () => ({
  CodeEditor: ({ value }: { value: string }) => <textarea data-testid="json" readOnly value={value} />,
}));

const mkRun = (results: unknown[]) => ({
  id: 'r1', triggerSource: 'event' as const, status: 'completed' as const,
  startedAt: '2026-06-30T00:00:00.000Z', finishedAt: '2026-06-30T00:00:01.000Z', error: null,
  result: { status: 'completed', results },
}) as never;

const run = mkRun([
  { nodeId: 'sql-1', label: 'Query batch rows', type: 'action', status: 'success', durationMs: 5,
    output: [{ json: { batchId: 'b1' } }], meta: { persisted: 1 }, logs: [] },
  { nodeId: 'log-1', label: 'Log', type: 'action', status: 'success', durationMs: 0,
    output: [{ json: { ok: true } }], meta: undefined, logs: [{ level: 'log', message: 'batch rows: 1', ts: 1 }] },
]);

describe('RunDetail master-detail', () => {
  it('shows node labels (not just ids) in the table', () => {
    render(<RunDetail run={run} loading={false} />);
    expect(screen.getAllByText('Query batch rows').length).toBeGreaterThan(0);
    expect(screen.getByText('Log')).toBeInTheDocument();
  });

  it('auto-selects the first node and shows its output', () => {
    render(<RunDetail run={run} loading={false} />);
    const text = screen.getAllByTestId('json').map((v) => (v as HTMLTextAreaElement).value).join('\n');
    expect(text).toContain('batchId');
    expect(text).toContain('b1');
  });

  it('selecting a node shows its output and its logs tab', () => {
    render(<RunDetail run={run} loading={false} />);
    fireEvent.click(screen.getByText('Log'));
    expect(screen.getAllByTestId('json').map((v) => (v as HTMLTextAreaElement).value).join('\n')).toContain('ok');
    fireEvent.click(screen.getByRole('button', { name: /logs/i }));
    expect(screen.getByText('batch rows: 1')).toBeInTheDocument();
  });

  it('auto-selects a failed node and its Result tab shows its meta', () => {
    const failRun = mkRun([
      { nodeId: 'a', label: 'Node A', type: 'action', status: 'success', durationMs: 1, output: [{ json: { a: 1 } }], logs: [] },
      { nodeId: 'b', label: 'Node B', type: 'action', status: 'error', durationMs: 1, error: 'boom', output: undefined, meta: { tried: true }, logs: [] },
    ]);
    render(<RunDetail run={failRun} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /result/i }));
    const ta = screen.getByTestId('json') as HTMLTextAreaElement;
    expect(ta.value).toContain('tried');
  });
});

const mapMeta = (mapped: number, held: number) => ({ fhir: 0, form: 0, mapped, held, heldReasons: held ? ['x'] : [], notes: [] });
const persistMeta = (persisted: number) => ({ persisted, batchId: 'b1', flattened: { written: 0, skipped: 0, degraded: 0, deferred: 0 }, resourceTypes: [] });

describe('run outcomes beside the run status', () => {
  const allHeld = mkRun([
    { nodeId: 'm', label: 'Map to FHIR', type: 'action', status: 'success', durationMs: 1, meta: mapMeta(0, 3) },
    { nodeId: 'p', label: 'Persist store', type: 'action', status: 'skipped', durationMs: 0 },
  ]);

  it('counts mapped and held from Map to FHIR and persisted from Persist store, and nothing it was not told', () => {
    expect(runCounts({ results: [
      { nodeId: 'm1', type: 'action', status: 'success', durationMs: 1, meta: mapMeta(4, 1) },
      { nodeId: 'm2', type: 'action', status: 'success', durationMs: 1, meta: mapMeta(2, 2) },
      { nodeId: 'p', type: 'action', status: 'success', durationMs: 1, meta: persistMeta(5) },
    ] })).toEqual({ mapped: 6, held: 3, persisted: 5 });
    // A meta that only looks like a count is not one: no Map to FHIR or Persist store shape.
    expect(runCounts({ results: [{ nodeId: 'a', type: 'action', status: 'success', durationMs: 1, meta: { persisted: 1, held: 2 } }] })).toEqual({});
    expect(runCounts(null)).toEqual({});
  });

  it('adds the rows a loop step reports for its body', () => {
    expect(runCounts({ results: [
      { nodeId: 'm', type: 'action', status: 'success', durationMs: 1, meta: mapMeta(1, 0) },
      { nodeId: 'loop', type: 'loop', status: 'success', durationMs: 1, meta: { iterations: 3, bodyCounts: { mapped: 1, held: 2 } } },
    ] })).toEqual({ mapped: 2, held: 2 });
  });

  it('shows Completed and a held count when a completed run held rows', () => {
    render(<RunStatus run={allHeld} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('3 held')).toBeInTheDocument();
  });

  it('shows no held count when nothing was held', () => {
    render(<RunStatus run={mkRun([{ nodeId: 'm', type: 'action', status: 'success', durationMs: 1, meta: mapMeta(2, 0) }])} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByText(/held/)).toBeNull();
  });

  it('shows mapped, held and persisted in the run detail, and a skipped step by its label', () => {
    render(<RunDetail run={allHeld} loading={false} />);
    expect(screen.getByTestId('run-counts')).toHaveTextContent('0 mapped · 3 held');
    expect(screen.getByTestId('run-counts')).not.toHaveTextContent('persisted');
    expect(screen.getByText('Persist store')).toBeInTheDocument();
  });
});
