import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// `ConstantValueField` fetches its own value set, the same way `ValueMapPanel` does and unlike
// `ColumnMapStep`, which takes its column suggestions as a prop. There is no global `fetch` stub in
// `setupTests.ts`, so an unmocked call would hit Node's own `fetch` and reject on a relative URL.
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, suggestValueMappings: vi.fn() };
});

import * as api from '@/api';
import { ConstantValueField } from './ConstantValueField';

const mocked = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>;

const LEVEL_OPTIONS = [
  { code: 'health-center', display: 'Health Center' },
  { code: 'district-hospital', display: 'District Hospital' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocked(api.suggestValueMappings).mockResolvedValue({
    values: [], options: LEVEL_OPTIONS, notValidated: false,
  });
});

describe('ConstantValueField', () => {
  it('offers the whole value set and commits the CODE, not the display', async () => {
    const onChange = vi.fn();
    render(<ConstantValueField id="c-level" field="level" value="" onChange={onChange} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalledWith('level', []));

    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /health center/i }));

    expect(onChange).toHaveBeenCalledWith('health-center');
  });

  it('warns when the typed value is in neither the codes nor the displays', async () => {
    render(<ConstantValueField id="c-level" field="level" value="Health Centre" onChange={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/not in the level list/i);
  });

  it('does not warn about a value that is canonical by DISPLAY', async () => {
    render(<ConstantValueField id="c-level" field="level" value="Health Center" onChange={vi.fn()} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not warn about a value that is canonical by CODE', async () => {
    render(<ConstantValueField id="c-level" field="level" value="health-center" onChange={vi.fn()} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('never warns while the list is still loading', () => {
    mocked(api.suggestValueMappings).mockReturnValue(new Promise(() => {}));
    render(<ConstantValueField id="c-level" field="level" value="Health Centre" onChange={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // ⛔ "Could not ask" and "there is nothing to ask about" must not look the same on screen. This
  // is the exact confusion `ValueMapPanel` shipped with and had to fix: an operator faced with a
  // silently empty picker reasonably reads it as "there are no options".
  it('says the value set is not seeded, and warns about nothing, when notValidated', async () => {
    mocked(api.suggestValueMappings).mockResolvedValue({ values: [], options: [], notValidated: true });
    render(<ConstantValueField id="c-level" field="level" value="Health Centre" onChange={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/no level value list on this install/i);
    expect(screen.queryByText(/not in the level list/i)).toBeNull();
  });

  it('shows the fetch failure, and warns about nothing, when the request rejects', async () => {
    mocked(api.suggestValueMappings).mockRejectedValue(new Error('boom'));
    render(<ConstantValueField id="c-level" field="level" value="Health Centre" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the value list/i);
    expect(screen.queryByText(/not in the level list/i)).toBeNull();
  });

  // The parser writes the constant verbatim (`facility-csv.ts:411-413`) and `setConstant` stores it
  // untrimmed (`ColumnMapStep.tsx:232-235`), so a leading space genuinely is not canonical and the
  // warning must say so rather than quietly trimming for the check.
  it('treats a value with surrounding whitespace as not canonical', async () => {
    render(<ConstantValueField id="c-level" field="level" value=" health-center" onChange={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/not in the level list/i);
  });

  it('survives a route that returns no options key at all', async () => {
    mocked(api.suggestValueMappings).mockResolvedValue({ values: [], notValidated: false });
    render(<ConstantValueField id="c-level" field="level" value="" onChange={vi.fn()} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalled());
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

describe('ConstantValueField option ordering', () => {
  // ⛔ Nothing ranks this list, so it would otherwise render in expansion order, which is seed
  // order. 249 countries that way cannot be searched by eye.
  it('renders the whole list alphabetically, whatever order the route returned it in', async () => {
    mocked(api.suggestValueMappings).mockResolvedValue({
      values: [],
      options: [
        { code: 'zmb', display: 'Zambia' },
        { code: 'moz', display: 'Mozambique' },
        { code: 'ago', display: 'Angola' },
      ],
      notValidated: false,
    });

    render(<ConstantValueField id="c-country" field="country" value="" onChange={vi.fn()} />);
    await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalled());
    fireEvent.focus(screen.getByRole('combobox'));

    const shown = (await screen.findAllByRole('option')).map((o) => o.getAttribute('aria-label') ?? o.textContent);
    expect(shown.map((s2) => (s2 ?? '').split(',')[0])).toEqual(['Angola', 'Mozambique', 'Zambia']);
  });
});
