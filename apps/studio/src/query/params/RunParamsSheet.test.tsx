// apps/studio/src/query/params/RunParamsSheet.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RunParamsSheet } from './RunParamsSheet';
import type { CustomQueryParam } from '../custom-query-types';

vi.mock('../api', () => ({ queryApi: { paramOptions: vi.fn(async () => ['Ndola', 'Lusaka']) } }));

const params: CustomQueryParam[] = [
  { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
  { id: 'facility', label: 'Facility', type: 'select', required: false, optionsSql: 'select distinct f from t' },
  { id: 'code', label: 'Code', type: 'text', required: false },
];

// Radix opens a dropdown on pointerdown; fall back to Enter, as FieldEditorSheet.test.tsx does.
function openRunMenu(): void {
  const trigger = screen.getByRole('button', { name: /run actions/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText(/run with these values/i)) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('RunParamsSheet', () => {
  it('runs from the ⋯ menu with the entered values', () => {
    const onRun = vi.fn();
    render(<RunParamsSheet open params={params} connectorId="c1" onClose={() => {}} onRun={onRun} />);
    fireEvent.change(screen.getByLabelText('dateRange-from'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('dateRange-to'), { target: { value: '2026-06-30' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'PMC' } });
    openRunMenu();
    fireEvent.click(screen.getByText(/run with these values/i));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({
      dateRange: { from: '2026-01-01', to: '2026-06-30' }, code: 'PMC',
    }));
  });

  it('has no standalone run button and no native select', () => {
    render(<RunParamsSheet open params={params} connectorId="c1" onClose={() => {}} onRun={() => {}} />);
    expect(screen.queryByRole('button', { name: /run with these values/i })).toBeNull();
    expect(document.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Facility' })).toBeTruthy();
  });

  it('runs with nothing filled in, sending no values', () => {
    const onRun = vi.fn();
    render(<RunParamsSheet open params={params} connectorId="c1" onClose={() => {}} onRun={onRun} />);
    openRunMenu();
    fireEvent.click(screen.getByText(/run with these values/i));
    expect(onRun).toHaveBeenCalledWith({});
  });
});
