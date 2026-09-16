import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api', () => ({
  catalogResultParams: vi.fn(),
  catalogSpecimensFor: vi.fn(),
  expandValueSetByUrl: vi.fn(),
}));
import { catalogResultParams, catalogSpecimensFor, expandValueSetByUrl } from '@/api';
import { TestDetailsField } from './TestDetailsField';

const CATALOG = 'urn:openldr:codesystem:test-catalog';
const tests = [
  { system: CATALOG, code: 'FBC', display: 'Full blood count' },
  { system: CATALOG, code: 'CD4', display: 'CD4 count' },
];

beforeEach(() => {
  vi.mocked(catalogResultParams).mockReset();
  vi.mocked(catalogSpecimensFor).mockReset();
  vi.mocked(expandValueSetByUrl).mockReset();
  vi.mocked(catalogSpecimensFor).mockResolvedValue([]);
  vi.mocked(expandValueSetByUrl).mockResolvedValue([]);
  vi.mocked(catalogResultParams).mockResolvedValue({
    tests: [
      { test: { system: CATALOG, code: 'FBC' }, params: [{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [], fits: [], unit: 'g/dL', display: 'Haemoglobin', band: null }] },
      { test: { system: CATALOG, code: 'CD4' }, params: [] },
    ],
    rejectReasons: { order: [], test: [{ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }] },
    sexes: [],
  });
});

describe('TestDetailsField', () => {
  it('lists a row per chosen test, with its code and name', async () => {
    render(<TestDetailsField tests={tests} value={{}} onChange={() => {}} onRemoveTest={() => {}} patient={null} />);
    await waitFor(() => expect(screen.getByText('Full blood count')).toBeInTheDocument());
    expect(screen.getByText('FBC')).toBeInTheDocument();
    expect(screen.getByText('CD4 count')).toBeInTheDocument();
  });

  it('asks the server once for the chosen tests', async () => {
    render(<TestDetailsField tests={tests} value={{}} onChange={() => {}} onRemoveTest={() => {}} patient={{ reference: 'Patient/p1' }} />);
    await waitFor(() => expect(catalogResultParams).toHaveBeenCalledWith(
      [{ system: CATALOG, code: 'FBC' }, { system: CATALOG, code: 'CD4' }], { reference: 'Patient/p1' },
    ));
    expect(catalogResultParams).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when no test is chosen, and asks nothing', () => {
    render(<TestDetailsField tests={[]} value={{}} onChange={() => {}} onRemoveTest={() => {}} patient={null} />);
    expect(screen.getByText(/no tests chosen/i)).toBeInTheDocument();
    expect(catalogResultParams).not.toHaveBeenCalled();
  });

  it('shows a rejected test as rejected, with its reason', async () => {
    const value = { [`${CATALOG}|FBC`]: { specimen: null, rejection: { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }, results: [] } };
    render(<TestDetailsField tests={tests} value={value} onChange={() => {}} onRemoveTest={() => {}} patient={null} />);
    await waitFor(() => expect(screen.getByText(/Haemolysed/)).toBeInTheDocument());
  });

  it('removes a test through its row menu', async () => {
    const onRemoveTest = vi.fn();
    const user = userEvent.setup();
    render(<TestDetailsField tests={tests} value={{}} onChange={() => {}} onRemoveTest={onRemoveTest} patient={null} />);
    await waitFor(() => expect(screen.getByText('Full blood count')).toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: /actions for/i })[0]);
    await user.click(await screen.findByText(/remove/i));
    expect(onRemoveTest).toHaveBeenCalledWith({ system: CATALOG, code: 'FBC' });
  });

  it('takes its chrome copy from the caller, and falls back to English', () => {
    render(<TestDetailsField tests={[]} value={{}} onChange={() => {}} onRemoveTest={() => {}} patient={null} copy={{ empty: 'Aucun examen choisi' }} />);
    expect(screen.getByText('Aucun examen choisi')).toBeInTheDocument();
  });
});
