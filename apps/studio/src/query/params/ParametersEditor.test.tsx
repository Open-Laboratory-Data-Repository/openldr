import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { ParametersEditor } from './ParametersEditor';
import type { CustomQueryParam } from '../custom-query-types';

function clickMenuItem(trigger: string, item: string) {
  const button = screen.getByRole('button', { name: trigger });
  fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: item })) fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

const test: CustomQueryParam = { id: 'test', label: 'Test', type: 'text', required: false };

describe('ParametersEditor', () => {
  it('keeps its actions in the ⋯ menu, with no Cancel or Save buttons', () => {
    render(<ParametersEditor open parameters={[test]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parameter actions' })).toBeInTheDocument();
  });

  it('adds a parameter and saves the list from the ⋯ menu', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ParametersEditor open parameters={[test]} onClose={onClose} onSave={onSave} />);
    clickMenuItem('Parameter actions', 'Add');
    clickMenuItem('Parameter actions', 'Save');
    expect(onSave).toHaveBeenCalledWith([test, expect.objectContaining({ label: 'New Parameter' })]);
    expect(onClose).toHaveBeenCalled();
  });

  it('removes a row from that row menu', () => {
    const onSave = vi.fn();
    render(<ParametersEditor open parameters={[test]} onClose={vi.fn()} onSave={onSave} />);
    clickMenuItem('Actions for test', 'Remove');
    clickMenuItem('Parameter actions', 'Save');
    expect(onSave).toHaveBeenCalledWith([]);
  });
});
