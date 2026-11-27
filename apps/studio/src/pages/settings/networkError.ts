import type { TFunction } from 'i18next';
import { NetworkError } from '@/api';

const KNOWN = new Set(['private-key', 'not-a-certificate', 'duplicate', 'no-answer', 'not-found', 'read-only', 'damaged', 'busy', 'audit-failed']);

/**
 * The plain line for a failed call to /api/network. A code the server names gets its own line in
 * the person's language. Anything else is the server's own sentence, such as the one for a host
 * with a port in it.
 */
export function networkErrorLine(err: unknown, t: TFunction): string {
  if (err instanceof NetworkError) return KNOWN.has(err.code) ? t(`settings.network.error.${err.code}`) : err.code;
  return err instanceof Error ? err.message : String(err);
}

/** True when the change was made and only its audit record failed. The page then reloads. */
export const changeWasMade = (err: unknown): boolean => err instanceof NetworkError && err.changed;
