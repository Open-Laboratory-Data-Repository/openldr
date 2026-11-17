import { createContext, useContext } from 'react';

/**
 * Ask the workflow page to store the workflow, the same way the toolbar's Save does: a protected
 * workflow still asks the person to confirm first. `successMessage` replaces the "Workflow saved"
 * toast, so a save started from inside a node says what was saved.
 */
export type SaveRequest = (opts?: { successMessage?: string }) => void;

/** Provided by the workflow page. Null outside it, where a node can only change the editor. */
export const SaveRequestContext = createContext<SaveRequest | null>(null);

export function useSaveRequest(): SaveRequest | null {
  return useContext(SaveRequestContext);
}
