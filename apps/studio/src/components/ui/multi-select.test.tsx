import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelect } from './multi-select';

const options = [{ value: 'r1', label: 'Lab Manager' }, { value: 'r2', label: 'Clerk' }];

describe('MultiSelect', () => {
  it('removes a chosen value with its chip button', () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={['r1', 'r2']} onChange={onChange} placeholder="Add" removeLabel={(l) => `Remove ${l}`} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Lab Manager' }));
    expect(onChange).toHaveBeenCalledWith(['r2']);
  });

  it('gives each chip a remove button large enough to tap on a phone (24px)', () => {
    render(<MultiSelect options={options} value={['r1']} onChange={() => {}} placeholder="Add" removeLabel={(l) => `Remove ${l}`} />);
    const button = screen.getByRole('button', { name: 'Remove Lab Manager' });
    expect(button.className).toContain('h-6');
    expect(button.className).toContain('w-6');
  });
});
