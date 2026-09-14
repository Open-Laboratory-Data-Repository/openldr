import { useEffect } from 'react';

export interface BuilderKeyboardHandlers {
  focusSearch: () => void;
  next: () => void;
  previous: () => void;
  open: () => void;
  toggle: () => void;
  duplicate: () => void;
  remove: () => void;
  selectAll: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

/**
 * The list keys act only when the page itself has focus, or a row's label does. Before S4 they did
 * nothing, so no control relied on reaching them. Now they do things, so a key pressed in a text box,
 * an open menu, a select, a sheet or on any other control belongs to that control. Otherwise
 * ArrowDown in a select would move the list's anchor, and Escape that closes a sheet would clear the
 * selection.
 */
function isListFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target === document.body) return true;
  return target.hasAttribute('data-row-label');
}

export function useBuilderKeyboard(handlers: BuilderKeyboardHandlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); handlers.focusSearch(); return; }
      if (mod && event.key.toLowerCase() === 'z' && event.shiftKey) { event.preventDefault(); handlers.redo(); return; }
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); handlers.undo(); return; }
      if (!isListFocus(event.target)) return;
      if (event.key === 'j' || event.key === 'ArrowDown') handlers.next();
      else if (event.key === 'k' || event.key === 'ArrowUp') handlers.previous();
      else if (event.key === 'Enter') handlers.open();
      else if (event.key === ' ') { event.preventDefault(); handlers.toggle(); }
      else if (event.key.toLowerCase() === 'd' && mod) { event.preventDefault(); handlers.duplicate(); }
      else if (event.key.toLowerCase() === 'd') handlers.remove();
      else if (event.key.toLowerCase() === 'a' && mod) { event.preventDefault(); handlers.selectAll(); }
      else if (event.key === 'Escape') handlers.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
