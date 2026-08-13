import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuggestCombobox } from './suggest-combobox';

const cities = ['Kampala', 'Kigali', 'Kisumu'];

describe('SuggestCombobox', () => {
  it('renders a combobox', () => {
    render(<SuggestCombobox value="" onChange={() => {}} options={cities} label="City" />);
    expect(screen.getByRole('combobox', { name: 'City' })).toBeInTheDocument();
  });

  it('filters the visible suggestions as the user types', () => {
    // SuggestCombobox is a controlled component (value comes from the caller), so — as with
    // Input and Combobox elsewhere in this directory — a single fireEvent.change sets the full
    // typed value in one shot rather than simulating a static prop being typed into keystroke
    // by keystroke.
    render(<SuggestCombobox value="ki" onChange={() => {}} options={cities} label="City" />);
    const input = screen.getByRole('combobox', { name: 'City' });
    fireEvent.focus(input);
    expect(screen.getByText('Kigali')).toBeInTheDocument();
    expect(screen.getByText('Kisumu')).toBeInTheDocument();
    expect(screen.queryByText('Kampala')).not.toBeInTheDocument();
  });

  it('picking a suggestion sets the answer to that plain string', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SuggestCombobox value="" onChange={onChange} options={cities} label="City" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    await user.click(screen.getByText('Kigali'));
    expect(onChange).toHaveBeenCalledWith('Kigali');
  });

  it('accepts a typed value that is not in the suggestion list, verbatim', () => {
    const onChange = vi.fn();
    render(<SuggestCombobox value="" onChange={onChange} options={cities} label="City" />);
    const input = screen.getByRole('combobox', { name: 'City' });
    fireEvent.change(input, { target: { value: 'Somewhere New' } });
    expect(onChange).toHaveBeenLastCalledWith('Somewhere New');
  });

  it('shows a "no suggestions" state, distinct from loading, for an empty ready list', async () => {
    const user = userEvent.setup();
    render(<SuggestCombobox value="" onChange={() => {}} options={[]} status="ready" label="City" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.getByText(/no suggestions/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('shows a loading state distinct from "no suggestions"', async () => {
    const user = userEvent.setup();
    render(<SuggestCombobox value="" onChange={() => {}} options={[]} status="loading" label="City" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/no suggestions/i)).not.toBeInTheDocument();
  });

  it('still allows free typing while the suggestion list is empty', () => {
    const onChange = vi.fn();
    render(<SuggestCombobox value="" onChange={onChange} options={[]} status="ready" label="City" />);
    const input = screen.getByRole('combobox', { name: 'City' });
    fireEvent.change(input, { target: { value: 'Anywhere' } });
    expect(onChange).toHaveBeenLastCalledWith('Anywhere');
  });

  it('shows an error state with the given message', async () => {
    const user = userEvent.setup();
    render(<SuggestCombobox value="" onChange={() => {}} options={[]} status="error" error="boom" label="City" />);
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('sets aria-activedescendant to the keyboard-active option id', async () => {
    const user = userEvent.setup();
    render(<SuggestCombobox id="city" value="" onChange={() => {}} options={cities} label="City" />);
    const input = screen.getByRole('combobox', { name: 'City' });
    await user.click(input);
    expect(input).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'city-suggest-option-0');
  });
});

describe('SuggestCombobox — optionLabels', () => {
  const registers = { 'urn:zm:mfl': 'Zambia MFL', 'urn:tz:hfr': 'Tanzania HFR' };

  it('shows the LABEL while the option value stays the stored one', () => {
    // The facility register field stores a canonical URI because `idFor` hashes exactly that string
    // into every facility's permanent id — but an operator should be choosing "Zambia MFL".
    const onChange = vi.fn();
    render(
      <SuggestCombobox
        value="" onChange={onChange}
        options={['urn:zm:mfl', 'urn:tz:hfr']} optionLabels={registers}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Zambia MFL')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Zambia MFL'));
    expect(onChange).toHaveBeenCalledWith('urn:zm:mfl');
  });

  it('matches a query against the label, not only the value', () => {
    render(
      <SuggestCombobox
        value="zambia" onChange={vi.fn()}
        options={['urn:zm:mfl', 'urn:tz:hfr']} optionLabels={registers}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Zambia MFL')).toBeInTheDocument();
    expect(screen.queryByText('Tanzania HFR')).not.toBeInTheDocument();
  });

  it('falls back to the raw value when no label is given', () => {
    render(<SuggestCombobox value="" onChange={vi.fn()} options={['urn:zm:mfl']} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('urn:zm:mfl')).toBeInTheDocument();
  });
});
