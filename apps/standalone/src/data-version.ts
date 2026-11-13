// Which version of OpenLDR last started a data folder. A newer version may have changed the
// database in ways an older one cannot read, so an older launcher refuses the folder and names
// both versions. Without this the database fails with a migration error that tells the person
// nothing.
//
// Only Linux is tested. The rename over an existing file on Windows is unproven.

import { randomBytes } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { StandalonePaths } from './state.js';

type VersionPaths = Pick<StandalonePaths, 'versionFile'>;

const LEADING_VERSION = /^(\d+)\.(\d+)\.(\d+)/;

function leading(version: string): [number, number, number] | null {
  const m = LEADING_VERSION.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1, 0 or 1 by the leading x.y.z of each. null when either has no leading x.y.z. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = leading(a);
  const y = leading(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) {
    if (x[i]! < y[i]!) return -1;
    if (x[i]! > y[i]!) return 1;
  }
  return 0;
}

export function newerDataMessage(recorded: string, current: string): string {
  return (
    `This data folder was last used by OpenLDR ${recorded}. ` +
    `This is OpenLDR ${current}, which is older and cannot open it. ` +
    `Install OpenLDR ${recorded} or newer.`
  );
}

/**
 * The version a launcher reports when it could not find its own (launcherFiles). Such a launcher
 * neither refuses a folder nor records anything in it.
 */
function knownVersion(version: string): boolean {
  return leading(version) !== null && compareVersions(version, '0.0.0') !== 0;
}

/**
 * The recorded version, or null when there is none to go by: no file, a file that cannot be
 * read, not JSON, or no version with a leading x.y.z.
 */
async function readRecorded(paths: VersionPaths): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(paths.versionFile, 'utf8');
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const version = (data as Record<string, unknown>).version;
  return typeof version === 'string' && leading(version) !== null ? version : null;
}

/** Throws an Error with newerDataMessage when the folder was last started by a newer version. Writes nothing. */
export async function checkDataVersion(paths: VersionPaths, appVersion: string): Promise<void> {
  if (!knownVersion(appVersion)) return;
  const recorded = await readRecorded(paths);
  if (recorded !== null && compareVersions(recorded, appVersion) === 1) {
    throw new Error(newerDataMessage(recorded, appVersion));
  }
}

/** Records the current version as the one that last started the folder. */
export async function recordDataVersion(paths: VersionPaths, appVersion: string): Promise<void> {
  if (!knownVersion(appVersion)) return;
  const recorded = await readRecorded(paths);
  if (recorded === appVersion) return;
  // A newer record is never lowered. runStart checks first, so it does not get here with one.
  if (recorded !== null && compareVersions(recorded, appVersion) === 1) return;

  // A finished, flushed file is renamed over the old one, so a power cut leaves one or the other.
  const tmp = join(
    dirname(paths.versionFile),
    `.${basename(paths.versionFile)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    const handle = await open(tmp, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({ version: appVersion })}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, paths.versionFile);
  } finally {
    await rm(tmp, { force: true });
  }
}
