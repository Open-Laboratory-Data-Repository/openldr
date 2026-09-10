import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { DashboardFilterEditor } from './DashboardFilterEditor';
import type { DashboardFilterDef } from '../../api';

/** Radix opens DropdownMenuContent on pointerdown; jsdom sometimes needs a follow-up Enter. */
function openMenu(triggerName: string | RegExp, probeItemName: string | RegExp) {
  const trigger = screen.getByRole('button', { name: triggerName });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: probeItemName })) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

function clickMenuItem(triggerName: string | RegExp, itemName: string | RegExp) {
  openMenu(triggerName, itemName);
  fireEvent.click(screen.getByRole('menuitem', { name: itemName }));
}

const period: DashboardFilterDef = { id: 'period', label: 'Period', type: 'date-range' };
const test: DashboardFilterDef = { id: 'test', label: 'Test', type: 'text' };

function renderEditor(filters: DashboardFilterDef[], props: Partial<Parameters<typeof DashboardFilterEditor>[0]> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<DashboardFilterEditor open filters={filters} onSave={onSave} onClose={onClose} {...props} />);
  return { onSave, onClose };
}

describe('DashboardFilterEditor', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  describe('SQL token hint', () => {
    it('shows both tokens for a date-range filter', () => {
      renderEditor([period]);
      expect(screen.getByText('{{period_from}}')).toBeInTheDocument();
      expect(screen.getByText('{{period_to}}')).toBeInTheDocument();
    });

    it('shows the bare id for a text filter, and never a _from', () => {
      renderEditor([test]);
      expect(screen.getByText('{{test}}')).toBeInTheDocument();
      expect(screen.queryByText('{{test_from}}')).not.toBeInTheDocument();
    });

    it('follows the Variable ID as it is edited', () => {
      renderEditor([period]);
      fireEvent.change(screen.getByLabelText('filter-0-id'), { target: { value: 'window' } });
      expect(screen.getByText('{{window_from}}')).toBeInTheDocument();
      expect(screen.queryByText('{{period_from}}')).not.toBeInTheDocument();
    });

    it('reverts to one token when the type stops being a date-range', () => {
      renderEditor([period]);
      // Radix Select is driven by keyboard here; jsdom has no layout for the popper.
      fireEvent.keyDown(screen.getByLabelText('filter-0-type'), { key: 'Enter' });
      fireEvent.click(screen.getByRole('option', { name: 'Text' }));
      expect(screen.getByText('{{period}}')).toBeInTheDocument();
      expect(screen.queryByText('{{period_from}}')).not.toBeInTheDocument();
    });

    it('copies a token and says so', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      renderEditor([period]);
      fireEvent.click(screen.getByText('{{period_to}}'));
      expect(writeText).toHaveBeenCalledWith('{{period_to}}');
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
    });
  });

  describe('actions', () => {
    it('adds a filter from the header menu', () => {
      renderEditor([]);
      clickMenuItem(/filter actions/i, /add filter/i);
      expect(screen.getByLabelText('filter-0-id')).toBeInTheDocument();
    });

    it('saves the edited list from the header menu, then closes', () => {
      const { onSave, onClose } = renderEditor([test]);
      fireEvent.change(screen.getByLabelText('filter-0-label'), { target: { value: 'Assay' } });
      clickMenuItem(/filter actions/i, /^save/i);
      expect(onSave).toHaveBeenCalledWith([{ ...test, label: 'Assay' }]);
      expect(onClose).toHaveBeenCalled();
    });

    it('cancels without saving', () => {
      const { onSave, onClose } = renderEditor([test]);
      fireEvent.change(screen.getByLabelText('filter-0-label'), { target: { value: 'Assay' } });
      clickMenuItem(/filter actions/i, /cancel/i);
      expect(onSave).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('removes a row from that row menu', () => {
      const { onSave } = renderEditor([period, test]);
      clickMenuItem(/actions for period/i, /remove/i);
      clickMenuItem(/filter actions/i, /^save/i);
      expect(onSave).toHaveBeenCalledWith([test]);
    });

    it('moves a row down from that row menu', () => {
      const { onSave } = renderEditor([period, test]);
      clickMenuItem(/actions for period/i, /move down/i);
      clickMenuItem(/filter actions/i, /^save/i);
      expect(onSave).toHaveBeenCalledWith([test, period]);
    });

    it('has no Cancel/Save footer buttons', () => {
      renderEditor([test]);
      expect(screen.queryByRole('button', { name: /^save filters$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^add filter$/i })).not.toBeInTheDocument();
    });
  });
});
