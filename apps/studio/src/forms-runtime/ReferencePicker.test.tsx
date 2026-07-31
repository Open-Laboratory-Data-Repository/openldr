import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReferencePicker } from './ReferencePicker';

vi.mock('@/api', () => ({
  referenceSearch: vi.fn(),
  referenceSearchPreview: vi.fn(),
}));
import { referenceSearch } from '@/api';

const field = { id: 'patient', displayLabel: 'Patient', fieldType: 'reference', referenceTarget: 'Patient' } as never;
const entityResult = {
  kind: 'entity' as const,
  rows: [{ reference: 'Patient/p1', display: 'Doe Jane', secondary: '1992-01-01 · F' }],
  total: 1,
};

beforeEach(() => { vi.mocked(referenceSearch).mockReset(); });

describe('ReferencePicker', () => {
  it('searches after the debounce and renders display plus secondary', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={() => {}} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await waitFor(() => expect(screen.getByText('Doe Jane')).toBeInTheDocument());
    expect(screen.getByText('1992-01-01 · F')).toBeInTheDocument();
  });

  it('coalesces keystrokes into a single request', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={() => {}} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await waitFor(() => expect(referenceSearch).toHaveBeenCalledTimes(1));
  });

  it('emits the selected row', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={onChange} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await user.click(await screen.findByText('Doe Jane'));
    expect(onChange).toHaveBeenCalledWith({ reference: 'Patient/p1', display: 'Doe Jane' });
  });

  it('selects with the keyboard', async () => {
    vi.mocked(referenceSearch).mockResolvedValue(entityResult);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={onChange} />);

    await user.type(screen.getByRole('combobox'), 'doe');
    await screen.findByText('Doe Jane');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith({ reference: 'Patient/p1', display: 'Doe Jane' });
  });

  it('clears a selection', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ReferencePicker field={field} formId="f1" multiple={false}
        value={{ reference: 'Patient/p1', display: 'Doe Jane' }} onChange={onChange} />,
    );
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders one chip per value when multiple', () => {
    render(
      <ReferencePicker field={field} formId="f1" multiple
        value={[{ reference: 'Patient/p1', display: 'Doe Jane' }, { reference: 'Patient/p2', display: 'Doe John' }]}
        onChange={() => {}} />,
    );
    expect(screen.getByText('Doe Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe John')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    vi.mocked(referenceSearch).mockResolvedValue({ kind: 'entity', rows: [], total: 0 });
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(await screen.findByText(/no matches/i)).toBeInTheDocument();
  });

  it('shows an error row when the search fails', async () => {
    vi.mocked(referenceSearch).mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<ReferencePicker field={field} formId="f1" multiple={false} value={null} onChange={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'doe');
    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
  });
});
