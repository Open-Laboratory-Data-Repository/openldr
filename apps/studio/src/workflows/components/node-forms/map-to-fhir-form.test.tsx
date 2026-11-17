import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as api from '@/api';
import { MapToFhirForm } from './map-to-fhir-form';
import { TEST_TARGET } from '../map/test-fixtures';

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
  m(api.fetchMapTargets).mockResolvedValue([TEST_TARGET]);
  m(api.fetchNodeOptions).mockResolvedValue([{ value: 'f1', label: 'Form one' }, { value: 'f2', label: 'Form two' }]);
  m(api.suggestMapping).mockResolvedValue([]);
});

describe('MapToFhirForm', () => {
  it('writes the source path, the target and the allowed forms into config', async () => {
    const update = vi.fn();
    render(<MapToFhirForm node={mkNode({ formIds: ['f1'], mappings: [{}, {}] })} update={update} />);
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
});
