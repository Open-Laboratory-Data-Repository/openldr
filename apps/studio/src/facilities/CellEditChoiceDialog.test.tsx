import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellEditChoiceDialog } from './CellEditChoiceDialog';

const base = {
  open: true, header: 'Type', fromValue: 'Others', toValue: 'Health Post',
  onOpenChange: () => {},
};

describe('CellEditChoiceDialog', () => {
  it('names the column, the old value and the new one', () => {
    render(<CellEditChoiceDialog {...base} onChoose={() => {}} />);
    expect(screen.getByText(/Others/)).toBeInTheDocument();
    expect(screen.getByText(/Health Post/)).toBeInTheDocument();
    expect(screen.getByText(/Type/)).toBeInTheDocument();
  });

  it('reports the row choice', async () => {
    const onChoose = vi.fn();
    render(<CellEditChoiceDialog {...base} onChoose={onChoose} />);
    await userEvent.click(screen.getByRole('button', { name: /just this row/i }));
    expect(onChoose).toHaveBeenCalledWith('row');
  });

  it('reports the everywhere choice', async () => {
    const onChoose = vi.fn();
    render(<CellEditChoiceDialog {...base} onChoose={onChoose} />);
    await userEvent.click(screen.getByRole('button', { name: /every row/i }));
    expect(onChoose).toHaveBeenCalledWith('everywhere');
  });
});
