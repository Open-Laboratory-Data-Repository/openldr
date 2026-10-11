import { createContext } from 'react';

/**
 * True while the whole order is rejected (2026-10-11 spec, decision 2). The results field reads it to
 * close every row for entry. A context, so the flag does not thread through FieldRow and FieldControl.
 */
export const OrderRejectedContext = createContext(false);
