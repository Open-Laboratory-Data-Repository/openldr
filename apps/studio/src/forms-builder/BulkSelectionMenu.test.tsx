import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkSelectionMenu } from './BulkSelectionMenu';

function setup() {
  const props = { onMove: vi.fn(), onToggleEnabled: vi.fn(), onDelete: vi.fn(), onClear: vi.fn() };
  render(<BulkSelectionMenu count={3} sections={[{ id: 'vitals', label: 'Vitals', order: 0 }]} {...props} />);
  const trigger = screen.getByRole('button', { name: 'Selection actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
  return props;
}

describe('BulkSelectionMenu', () => {
  it('shows the count', () => {
    setup();
    expect(screen.getByText('3 selected')).toBeTruthy();
  });

  it('moves to a section', () => {
    const { onMove } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Vitals' }));
    expect(onMove).toHaveBeenCalledWith('vitals');
  });

  it('moves out of every section', () => {
    const { onMove } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to (no section)' }));
    expect(onMove).toHaveBeenCalledWith(undefined);
  });

  it('hands back Toggle enabled', () => {
    const { onToggleEnabled } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Toggle enabled' }));
    expect(onToggleEnabled).toHaveBeenCalled();
  });

  it('hands back Delete', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('hands back Clear selection', () => {
    const { onClear } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalled();
  });
});
