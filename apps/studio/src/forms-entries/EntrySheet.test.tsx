import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as api from '@/api';
import '@/i18n';
import { EntrySheet } from './EntrySheet';

const detail = (over: Partial<api.FormEntryDetail>): api.FormEntryDetail => ({
  id: 'e-1', formId: 'form-1', facilityId: null, facilityCode: null, facilityName: null,
  entryKey: 'CS-0001', summary: [], enteredBy: 'u-2', enteredByName: 'aisha', enteredAt: '2026-11-22T13:50:00.000Z',
  status: 'active', statusBy: null, statusAt: null, statusReason: null, statusByName: null,
  answers: [{ fieldId: 'num', label: 'Requisition number', value: 'CS-0001' }, { fieldId: 'test', label: 'Test', value: 'HIV VL' }],
  ...over,
});

describe('EntrySheet', () => {
  it('shows every answer, and who entered it', async () => {
    vi.spyOn(api, 'getFormEntry').mockResolvedValue(detail({}));
    render(<EntrySheet entryId="e-1" onClose={() => {}} />);
    expect(await screen.findByText('Requisition number')).toBeInTheDocument();
    expect(screen.getByText('HIV VL')).toBeInTheDocument();
    expect(screen.getByText('aisha')).toBeInTheDocument();
    expect(screen.queryByText('Reason')).not.toBeInTheDocument();
    expect(api.getFormEntry).toHaveBeenCalledWith('e-1');
  });

  it('shows who marked it in error by name, and why', async () => {
    vi.spyOn(api, 'getFormEntry').mockResolvedValue(detail({
      status: 'entered-in-error', statusBy: 'u-manager', statusByName: 'Mary Manager',
      statusAt: '2026-11-22T15:00:00.000Z', statusReason: 'wrong patient',
    }));
    render(<EntrySheet entryId="e-1" onClose={() => {}} />);
    expect(await screen.findByText('wrong patient')).toBeInTheDocument();
    expect(screen.getAllByText('Entered in error').length).toBeGreaterThan(0);
    expect(screen.getByText('Mary Manager')).toBeInTheDocument();
    expect(screen.queryByText('u-manager')).not.toBeInTheDocument();
  });

  it('says a removed user, never the raw id, when the marker no longer exists', async () => {
    vi.spyOn(api, 'getFormEntry').mockResolvedValue(detail({
      status: 'entered-in-error', statusBy: 'u-gone', statusByName: null,
      statusAt: '2026-11-22T15:00:00.000Z', statusReason: 'wrong patient',
    }));
    render(<EntrySheet entryId="e-1" onClose={() => {}} />);
    expect(await screen.findByText('a removed user')).toBeInTheDocument();
    expect(screen.queryByText('u-gone')).not.toBeInTheDocument();
  });

  it('says so when the answers could not be read', async () => {
    vi.spyOn(api, 'getFormEntry').mockResolvedValue(detail({ answers: null }));
    render(<EntrySheet entryId="e-1" onClose={() => {}} />);
    expect(await screen.findByText('The answers of this entry could not be read.')).toBeInTheDocument();
  });

  it('shows the error when the entry cannot be read', async () => {
    vi.spyOn(api, 'getFormEntry').mockRejectedValue(new Error('get form entry failed: not found'));
    render(<EntrySheet entryId="e-1" onClose={() => {}} />);
    expect(await screen.findByText('get form entry failed: not found')).toBeInTheDocument();
  });
});
