import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useBuilderKeyboard, type BuilderKeyboardHandlers } from './useBuilderKeyboard';

function Harness({ handlers }: { handlers: BuilderKeyboardHandlers }) {
  useBuilderKeyboard(handlers);
  return (
    <div>
      <input aria-label="box" />
      <button type="button" data-row-label>row</button>
      <button type="button">other</button>
      <div role="dialog"><button type="button">inside</button></div>
    </div>
  );
}

function setup() {
  const handlers: BuilderKeyboardHandlers = {
    focusSearch: vi.fn(), next: vi.fn(), previous: vi.fn(), open: vi.fn(), toggle: vi.fn(),
    duplicate: vi.fn(), remove: vi.fn(), selectAll: vi.fn(), undo: vi.fn(), redo: vi.fn(), clear: vi.fn(),
  };
  return { ...render(<Harness handlers={handlers} />), handlers };
}

describe('useBuilderKeyboard', () => {
  it('runs the list keys when the page has focus', () => {
    const { handlers } = setup();
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(handlers.next).toHaveBeenCalled();
    expect(handlers.selectAll).toHaveBeenCalled();
    expect(handlers.clear).toHaveBeenCalled();
  });

  it('runs them from a row label', () => {
    const { handlers, getByText } = setup();
    fireEvent.keyDown(getByText('row'), { key: 'd' });
    expect(handlers.remove).toHaveBeenCalled();
  });

  it('leaves them to a text box, another control, or anything in a dialog', () => {
    const { handlers, getByLabelText, getByText } = setup();
    fireEvent.keyDown(getByLabelText('box'), { key: 'j' });
    fireEvent.keyDown(getByText('other'), { key: 'Enter' });
    fireEvent.keyDown(getByText('inside'), { key: 'Escape' });
    expect(handlers.next).not.toHaveBeenCalled();
    expect(handlers.open).not.toHaveBeenCalled();
    expect(handlers.clear).not.toHaveBeenCalled();
  });

  it('keeps undo and Ctrl+F working from a text box', () => {
    const { handlers, getByLabelText } = setup();
    fireEvent.keyDown(getByLabelText('box'), { key: 'z', ctrlKey: true });
    fireEvent.keyDown(getByLabelText('box'), { key: 'f', ctrlKey: true });
    expect(handlers.undo).toHaveBeenCalled();
    expect(handlers.focusSearch).toHaveBeenCalled();
  });
});
