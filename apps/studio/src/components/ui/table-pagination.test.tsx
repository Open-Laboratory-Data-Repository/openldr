import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TablePagination } from './table-pagination';

const base = { page: 0, pageSize: 25, onPageChange: vi.fn(), onPageSizeChange: vi.fn() };
describe('TablePagination', () => {
  it('preserves known totals and the final-page boundary', () => {
    const { rerender } = render(<TablePagination {...base} total={52} />);
    expect(screen.getByText('1–25 of 52')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(base.onPageChange).toHaveBeenCalledWith(1);
    rerender(<TablePagination {...base} page={2} total={52} />);
    expect(screen.getByText('51–52 of 52')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
  it('uses continuation, including a full final page, without claiming a total', () => {
    const { rerender } = render(<TablePagination {...base} total={null} rowCount={25} hasMore />);
    expect(screen.getByText('1–25 (total unknown)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    rerender(<TablePagination {...base} page={1} total={null} rowCount={25} hasMore={false} />);
    expect(screen.getByText('26–50 (total unknown)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });
  it('does not guess continuation when the server gives no signal', () => {
    render(<TablePagination {...base} total={null} rowCount={25} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
});
