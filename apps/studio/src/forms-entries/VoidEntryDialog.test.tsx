import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '@/api';
import '@/i18n';
import { VoidEntryDialog } from './VoidEntryDialog';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const entry: api.FormEntry = {
  id: 'e-1', formId: 'form-1', facilityId: null, facilityCode: null, facilityName: null,
  entryKey: 'CS-0001', summary: [], enteredBy: 'u-2', enteredByName: 'aisha', enteredAt: '2026-11-22T13:50:00.000Z',
  status: 'active', statusBy: null, statusAt: null, statusReason: null,
};

function setup() {
  const props = { onClose: vi.fn(), onDone: vi.fn() };
  render(<VoidEntryDialog entry={entry} {...props} />);
  return props;
}

const confirm = () => screen.getByRole('button', { name: 'Mark as entered in error' });

describe('VoidEntryDialog', () => {
  beforeEach(() => { toast.success.mockReset(); toast.error.mockReset(); });

  it('needs a reason and says it cannot be undone', () => {
    setup();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '   ' } });
    expect(confirm()).toBeDisabled();
  });

  it('marks the entry, closes, and toasts the warning when there is one', async () => {
    vi.spyOn(api, 'voidFormEntry').mockResolvedValue({ entry: { ...entry, status: 'entered-in-error' }, resaved: 0, skipped: 0, warning: 'records not updated' });
    const props = setup();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: ' wrong patient ' } });
    fireEvent.click(confirm());
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(api.voidFormEntry).toHaveBeenCalledWith('e-1', 'wrong patient');
    expect(props.onClose).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('CS-0001 is marked as entered in error.', { description: 'records not updated' });
  });

  it('closes and refreshes when someone else already marked it', async () => {
    vi.spyOn(api, 'voidFormEntry').mockRejectedValue(Object.assign(new Error('mark entry in error failed: already-void'), { status: 409 }));
    const props = setup();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'typo' } });
    fireEvent.click(confirm());
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(props.onClose).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('This entry was already marked as entered in error.');
  });

  it('stays open with the message on another failure', async () => {
    vi.spyOn(api, 'voidFormEntry').mockRejectedValue(Object.assign(new Error('mark entry in error failed: boom'), { status: 500 }));
    const props = setup();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'typo' } });
    fireEvent.click(confirm());
    expect(await screen.findByText('mark entry in error failed: boom')).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onDone).not.toHaveBeenCalled();
  });
});
