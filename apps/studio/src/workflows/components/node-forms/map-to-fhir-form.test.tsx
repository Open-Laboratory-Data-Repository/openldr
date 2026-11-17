import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import * as api from '@/api';
import { MapToFhirForm } from './map-to-fhir-form';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
import { TEST_TARGET } from '../map/test-fixtures';

const OTHER_TARGET = { ...TEST_TARGET, id: 'other-target', name: 'Other target' };

vi.mock('@/components/ui/select', () => import('../map/test-select-mock'));
vi.mock('@/api', async (orig) => ({
  ...(await orig<typeof api>()),
  fetchMapTargets: vi.fn(),
  fetchNodeOptions: vi.fn(),
  suggestMapping: vi.fn(),
}));

const m = <T,>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const mkNode = (config: Record<string, unknown>) =>
  ({ id: 'map1', type: 'action', position: { x: 0, y: 0 }, data: { label: 'Map', action: 'map-to-fhir', config } }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  m(api.fetchMapTargets).mockResolvedValue([TEST_TARGET, OTHER_TARGET]);
  m(api.fetchNodeOptions).mockResolvedValue([{ value: 'f1', label: 'Form one' }, { value: 'f2', label: 'Form two' }]);
  m(api.suggestMapping).mockResolvedValue([]);
});

describe('MapToFhirForm', () => {
  it('writes the source path, the target and the allowed forms into config', async () => {
    const update = vi.fn();
    render(<MapToFhirForm node={mkNode({ formIds: ['f1'], mappings: [{ targetId: 'test-target' }, { targetId: 'test-target' }] })} update={update} />);
    expect(screen.getByTestId('mtf-mapping-count')).toHaveTextContent('2');
    expect(screen.getByText(/A webhook puts them under body/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Source path'), { target: { value: 'body' } });
    expect(update).toHaveBeenLastCalledWith({ config: expect.objectContaining({ sourcePath: 'body' }) });

    const target = await screen.findByRole('combobox', { name: 'Target' });
    await screen.findByRole('option', { name: 'Test target' });
    fireEvent.change(target, { target: { value: 'test-target' } });
    expect(update).toHaveBeenLastCalledWith({ config: expect.objectContaining({ targetId: 'test-target' }) });

    expect(m(api.fetchNodeOptions)).toHaveBeenCalledWith('forms');
    fireEvent.change(await screen.findByRole('combobox', { name: 'Allowed forms' }), { target: { value: 'f2' } });
    expect(update).toHaveBeenLastCalledWith({ config: expect.objectContaining({ formIds: ['f1', 'f2'] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Form one' }));
    expect(update).toHaveBeenLastCalledWith({ config: expect.objectContaining({ formIds: [] }) });
  });

  it('opens the mapping sheet from the dots menu', async () => {
    render(<MapToFhirForm node={mkNode({})} update={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Node actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Open mapping' })) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open mapping' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Map to FHIR');
  });

  function Stateful({ config }: { config: Record<string, unknown> }) {
    const [node, setNode] = useState(mkNode(config) as { data: { config: Record<string, unknown> } });
    return (
      <MapToFhirForm
        node={node as never}
        update={(patch) => setNode((n) => ({ ...n, data: { ...n.data, ...(patch as object) } }))}
      />
    );
  }
  const openMenu = (name: string, item: string) => {
    const trigger = screen.getByRole('button', { name });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: item })) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: item }));
  };

  it('opens the sheet on the target the form holds now', async () => {
    render(<Stateful config={{ targetId: 'test-target' }} />);
    await screen.findByRole('option', { name: 'Other target' });
    const formTarget = screen.getAllByRole('combobox', { name: 'Target' })[0];
    fireEvent.change(formTarget, { target: { value: 'other-target' } });
    openMenu('Node actions', 'Open mapping');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      const sheetTarget = dialog.querySelector('select[aria-label="Target"]') as HTMLSelectElement;
      expect(sheetTarget.value).toBe('other-target');
    });
  });

  it('asks before a new target drops mappings made for the old one, then drops them in the same write', async () => {
    const update = vi.fn();
    const mine = { shapeHash: 'a', fieldNames: ['x'], targetId: 'test-target', rows: [] };
    const theirs = { shapeHash: 'b', fieldNames: ['y'], targetId: 'other-target', rows: [] };
    render(<MapToFhirForm node={mkNode({ targetId: 'test-target', mappings: [mine, theirs] })} update={update} />);
    await screen.findByRole('option', { name: 'Other target' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Target' }), { target: { value: 'other-target' } });
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTestId('mtf-target-change')).toHaveTextContent('Changing the target removes 1 saved mapping made for another target.');
    // Until the change is confirmed the select shows the node's real target.
    expect((screen.getByRole('combobox', { name: 'Target' }) as HTMLSelectElement).value).toBe('test-target');
    openMenu('Target change actions', 'Change the target and remove them');
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0].config).toMatchObject({ targetId: 'other-target', mappings: [theirs] });
    expect(screen.queryByTestId('mtf-target-change')).toBeNull();
  });

  it('keeps the current target when the person says so', async () => {
    const update = vi.fn();
    const mine = { shapeHash: 'a', fieldNames: ['x'], targetId: 'test-target', rows: [] };
    render(<MapToFhirForm node={mkNode({ targetId: 'test-target', mappings: [mine] })} update={update} />);
    await screen.findByRole('option', { name: 'Other target' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Target' }), { target: { value: 'other-target' } });
    openMenu('Target change actions', 'Keep the current target');
    expect(update).not.toHaveBeenCalled();
    expect((screen.getByRole('combobox', { name: 'Target' }) as HTMLSelectElement).value).toBe('test-target');
  });

  describe('the hint about Extract from File', () => {
    const HINT = "Extract from File is changing this file's values: a number with a comma and a code with leading zeros do not arrive as written. Open that node and turn on 'Read every cell as text'.";
    const feed = (config: Record<string, unknown>) =>
      useWorkflowStore.setState({
        nodes: [{ id: 'ex1', type: 'action', position: { x: 0, y: 0 }, data: { label: 'Extract', action: 'extract-from-file', config } }] as never,
        edges: [{ id: 'e1', source: 'ex1', target: 'map1' }] as never,
      });

    it('shows when the feeding Extract from File reads CSV with the option off', () => {
      feed({ format: 'csv', sourceField: 'file' });
      render(<MapToFhirForm node={mkNode({})} update={vi.fn()} />);
      expect(screen.getByText(HINT)).toBeInTheDocument();
    });

    it('does not show with the option on, or for a JSON file', () => {
      feed({ format: 'csv', cellsAsText: true });
      const { unmount } = render(<MapToFhirForm node={mkNode({})} update={vi.fn()} />);
      expect(screen.queryByText(HINT)).toBeNull();
      unmount();
      feed({ format: 'json' });
      render(<MapToFhirForm node={mkNode({})} update={vi.fn()} />);
      expect(screen.queryByText(HINT)).toBeNull();
    });
  });
});
