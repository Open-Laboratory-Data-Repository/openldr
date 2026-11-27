// Which way the app runs: it holds the lab's data on this PC, or it shows OpenLDR from another PC.

import { join } from 'node:path';
import type { DesktopController } from './controller';
import type { RemoteController } from './remote-controller';

/**
 * What the app does at start. Checked in this order:
 *   1. A saved mode wins.
 *   2. OPENLDR_DESKTOP_SERVER set: 'connect'. For development and tests.
 *   3. Only now is the launcher asked for its data folder. If that folder already holds an install
 *      (its standalone.json exists): 'local'. Otherwise 'ask'.
 * `dataDir` is called only in step 3, so connect mode never runs the launcher. An install that
 * already holds data never sees the question.
 */
export async function startMode(input: {
  saved: 'local' | 'connect' | undefined;
  envServer: string | undefined;
  dataDir(): Promise<string | undefined>;
  exists(path: string): boolean;
}): Promise<'local' | 'connect' | 'ask'> {
  if (input.saved !== undefined) return input.saved;
  if (input.envServer !== undefined && input.envServer.trim() !== '') return 'connect';
  let dir: string | undefined;
  try {
    dir = await input.dataDir();
  } catch {
    dir = undefined;
  }
  return dir !== undefined && input.exists(join(dir, 'standalone.json')) ? 'local' : 'ask';
}

/** The running controller, with its mode. Narrow on `mode` before using launcher-only methods. */
export type Running =
  | { mode: 'local'; controller: DesktopController }
  | { mode: 'connect'; controller: RemoteController };
