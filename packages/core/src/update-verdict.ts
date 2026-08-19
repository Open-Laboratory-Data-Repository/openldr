import { isNewerVersion, parseSemver } from './semver';

/** Where an install stands, as one value rather than four overlapping booleans.
 *
 *  Shared with the CLI on purpose. The About card and `openldr update check` must never disagree
 *  about which state an install is in. Wording may differ between them, the verdict may not. */
export type UpdateVerdict =
  | { kind: 'update_available'; latest: string; releasedAt: string | null; notesUrl: string | null }
  | { kind: 'up_to_date'; latest: string }
  | { kind: 'check_off' }
  | { kind: 'cannot_confirm'; error: string; cause: 'check_failed' | 'bad_running_version' }
  | { kind: 'never_checked' };

/** Structurally a subset of UpdateState, so both callers pass their state straight in. */
export interface UpdateVerdictInput {
  enabled: boolean;
  running: string;
  latestVersion: string | null;
  releasedAt: string | null;
  notesUrl: string | null;
  lastError: string | null;
}

/** Not a copy of lastError. This cause fires when lastError is null, and naming a check failure
 *  that never happened sends the operator after the wrong problem. */
export const BAD_RUNNING_VERSION = 'unrecognised running version';

export function updateVerdict(input: UpdateVerdictInput): UpdateVerdict {
  const { enabled, running, latestVersion, releasedAt, notesUrl, lastError } = input;

  // 1. Off means off, matching decideUpdate. Suppressing the poll but still showing a verdict
  //    built from the pre-existing cache would defeat the point of the switch.
  if (!enabled) return { kind: 'check_off' };

  // 2. ⛔ isNewerVersion returns FALSE when either side is unparseable, so without this an
  //    unreadable running version falls through to up_to_date and the card states it is current
  //    on a version it cannot even parse. This cannot displace update_available below, because an
  //    unparseable running version already forces isNewerVersion to false.
  if (!parseSemver(running)) {
    return { kind: 'cannot_confirm', error: BAD_RUNNING_VERSION, cause: 'bad_running_version' };
  }

  // 3. A known newer version beats a failed poll. Today's fetch failing does not make yesterday's
  //    answer wrong, and decideUpdate already ignores lastError for exactly this reason.
  if (latestVersion !== null && isNewerVersion(latestVersion, running)) {
    return { kind: 'update_available', latest: latestVersion, releasedAt, notesUrl };
  }

  // 4. Below the check above, so a real update is never downgraded to a shrug.
  if (lastError) return { kind: 'cannot_confirm', error: lastError, cause: 'check_failed' };

  if (latestVersion === null) return { kind: 'never_checked' };

  return { kind: 'up_to_date', latest: latestVersion };
}
