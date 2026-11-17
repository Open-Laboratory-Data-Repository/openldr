import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DecimalInput, parseDecimal } from './decimal-input';

function Host({ start = null, onValue = () => {} }: { start?: number | null; onValue?: (v: number | null) => void }) {
  const [value, setValue] = useState<number | null>(start);
  return (
    <>
      <DecimalInput aria-label="n" value={value} onValueChange={(v) => { onValue(v); setValue(v); }} />
      <button type="button" onClick={() => setValue(42)}>outside</button>
    </>
  );
}

describe('parseDecimal', () => {
  it('reads blank and part-typed text as null, and a number as itself', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('-')).toBeNull();
    expect(parseDecimal('.')).toBeNull();
    expect(parseDecimal('11.')).toBe(11);
    expect(parseDecimal(' 11.5 ')).toBe(11.5);
    expect(parseDecimal('-0.5')).toBe(-0.5);
  });
});

describe('DecimalInput', () => {
  it('keeps "-" and "." while typing, and writes the number', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Host onValue={onValue} />);
    const input = screen.getByLabelText('n');
    await user.type(input, '-');
    expect(input).toHaveValue('-');
    expect(onValue).toHaveBeenLastCalledWith(null);
    await user.type(input, '1.');
    expect(input).toHaveValue('-1.');
    await user.type(input, '25');
    expect(input).toHaveValue('-1.25');
    expect(onValue).toHaveBeenLastCalledWith(-1.25);
  });

  it('refuses text that cannot become a number, and keeps what was there', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Host start={12} onValue={onValue} />);
    const input = screen.getByLabelText('n');
    await user.type(input, 'a');
    expect(input).toHaveValue('12');
    expect(onValue).not.toHaveBeenCalled();
  });

  it('takes a pasted number with spaces round it', () => {
    const onValue = vi.fn();
    render(<Host onValue={onValue} />);
    fireEvent.change(screen.getByLabelText('n'), { target: { value: ' 11.5 ' } });
    expect(onValue).toHaveBeenLastCalledWith(11.5);
  });

  it('shows a value changed from outside', async () => {
    const user = userEvent.setup();
    render(<Host start={1} />);
    await user.type(screen.getByLabelText('n'), '.');
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.getByLabelText('n')).toHaveValue('42');
  });
});
