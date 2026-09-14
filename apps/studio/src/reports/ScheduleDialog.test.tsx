import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

const { createSchedule, updateSchedule } = vi.hoisted(() => ({
  createSchedule: vi.fn(async () => ({ id: 's1' })),
  updateSchedule: vi.fn(async () => ({ id: 's1' })),
}));
vi.mock('../api', () => ({ createSchedule, updateSchedule }));

import { ScheduleDialog } from './ScheduleDialog';
import type { ReportParamMeta } from '../api';

const parameters: ReportParamMeta[] = [
  { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
  { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
];

beforeEach(() => vi.clearAllMocks());

async function saveFromMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' }));
}

describe('ScheduleDialog', () => {
  it('creates a schedule with the selected frequency + params', async () => {
    const onSaved = vi.fn();
    render(
      <ScheduleDialog open reportId="amr-resistance" parameters={parameters}
        options={{ facility: [{ value: 'F1', label: 'F1' }] }} initialParams={{ facility: 'F1' }}
        onClose={() => {}} onSaved={onSaved} />,
    );
    expect(screen.queryByText(/day of week|jour de la semaine|dia da semana/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' }));
    await waitFor(() => expect(createSchedule).toHaveBeenCalledWith('amr-resistance', expect.objectContaining({
      frequency: 'monthly', outputFormat: expect.any(String), params: { facility: 'F1' },
    })));
    expect(onSaved).toHaveBeenCalled();
  });

  it('updates an existing schedule and discards fixed date-window parameters', async () => {
    const onSaved = vi.fn();
    render(<ScheduleDialog open reportId="report-1" parameters={parameters} options={{}} initialParams={{}}
      existing={{ id: 's2', reportId: 'report-1', frequency: 'weekly', dayOfWeek: 3, dayOfMonth: null,
        outputFormat: 'csv', params: { facility: 'F2', from: '2026-01-01', to: '2026-01-31' },
        enabled: false, lastRunAt: null, nextDueAt: null, createdBy: null }} onClose={() => {}} onSaved={onSaved} />);
    await saveFromMenu();
    await waitFor(() => expect(updateSchedule).toHaveBeenCalledWith('s2', {
      frequency: 'weekly', dayOfWeek: 3, dayOfMonth: null, outputFormat: 'csv', params: { facility: 'F2' },
    }));
    expect(createSchedule).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('retains the editor and reports a failed save', async () => {
    createSchedule.mockRejectedValueOnce(new Error('offline'));
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<ScheduleDialog open reportId="report-1" parameters={[]} options={{}} initialParams={{}} onClose={onClose} onSaved={onSaved} />);
    await saveFromMenu();
    expect(await screen.findByText('Could not save the schedule.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Frequency' })).toHaveTextContent('Monthly');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('closes without saving a draft', () => {
    const onClose = vi.fn();
    render(<ScheduleDialog open reportId="report-1" parameters={[]} options={{}} initialParams={{}} onClose={onClose} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(createSchedule).not.toHaveBeenCalled();
    expect(updateSchedule).not.toHaveBeenCalled();
  });
});
