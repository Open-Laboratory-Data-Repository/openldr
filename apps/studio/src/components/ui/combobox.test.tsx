import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Combobox } from './combobox';

const options = [
  { value: 'ou1', label: 'Clinic Alpha' },
  { value: 'ou2', label: 'Clinic Beta' },
];

describe('Combobox', () => {
  it('filters by query and selects an option', async () => {
    const onChange = vi.fn();
    render(<Combobox options={options} value={null} onChange={onChange} placeholder="Pick" searchPlaceholder="Search" />);
    fireEvent.click(screen.getByRole('combobox', { name: /pick/i }));
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'beta' } });
    expect(screen.queryByText('Clinic Alpha')).toBeNull();
    fireEvent.click(screen.getByText('Clinic Beta'));
    expect(onChange).toHaveBeenCalledWith('ou2');
  });

  it('shows the selected label on the trigger', () => {
    render(<Combobox options={options} value="ou1" onChange={() => {}} placeholder="Pick" searchPlaceholder="Search" />);
    expect(screen.getByRole('combobox', { name: /clinic alpha/i })).toBeTruthy();
  });

  // A field label names the picker, so a screen reader hears the field, not only its value.
  it('takes an id and a fixed name, and lists its rows as options', () => {
    render(<Combobox id="country" ariaLabel="Country" options={options} value="ou1" onChange={() => {}} placeholder="Pick" searchPlaceholder="Search" />);
    const trigger = screen.getByRole('combobox', { name: 'Country' });
    expect(trigger.id).toBe('country');
    expect(trigger).toHaveTextContent('Clinic Alpha');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Clinic Alpha' })).toHaveAttribute('aria-selected', 'true');
  });

  // An optional field needs a way back to no value. The None row answers '' and stays while typing.
  it('offers a None row that answers an empty value', () => {
    const onChange = vi.fn();
    render(<Combobox options={options} value="ou1" onChange={onChange} noneLabel="None" placeholder="Pick" searchPlaceholder="Search" />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'beta' } });
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('shows the placeholder, not None, when the value is empty', () => {
    render(<Combobox options={options} value="" onChange={() => {}} noneLabel="None" placeholder="Pick" searchPlaceholder="Search" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Pick');
  });
});
