import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createAppContext } from '@openldr/bootstrap';
import type { UpdateState } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { redactError } from './redact-error';

/**
 * What version is this CLI running? There is no `readAppVersion` reachable from `packages/cli`
 * (the one at `apps/server/src/version.ts` is app-local and not exported), so this reads the
 * repo root `package.json` the same way that one does: walk up from this module looking for a
 * `version` field, working in both dev (`packages/cli/src`) and the bundled CLI (`dist`).
 */
export function runningVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../package.json'), // dev: packages/cli/src -> repo root
    resolve(here, '../../package.json'),
    resolve(here, '../package.json'), // bundled: packages/cli/dist -> repo root
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0';
}

/** Pure: state in, text and exit code out. Exit 1 means "an update exists" so this can be
 *  scripted; it is not an error. Errors exit 2 — see UPDATE_ERROR_EXIT below. */
export function renderUpdateCheck(state: UpdateState, opts: { json: boolean }): { text: string; code: number } {
  if (opts.json) return { text: JSON.stringify(state, null, 2), code: state.updateAvailable ? 1 : 0 };

  const lines = [`running:   ${state.running}`];
  if (!state.enabled) {
    lines.push('update check is disabled (Studio: Settings → General)');
    return { text: lines.join('\n'), code: 0 };
  }
  lines.push(`published: ${state.latestVersion ?? 'unknown'}`);
  if (state.lastError) lines.push(`last check failed: ${state.lastError}`);
  if (state.updateAvailable) {
    lines.push('', `${state.latestVersion} is available. To upgrade, run these in your install directory:`, '', '  docker compose pull', '  docker compose up -d');
    if (state.notesUrl) lines.push('', `release notes: ${state.notesUrl}`);
    return { text: lines.join('\n'), code: 1 };
  }
  // Only when the last check actually SUCCEEDED. A stale cache that happens to match the running
  // version would otherwise print "last check failed: …" and "this install is up to date." together.
  if (state.latestVersion && !state.lastError) lines.push('', 'this install is up to date.');
  return { text: lines.join('\n'), code: 0 };
}

/** Errors exit 2, never 1. Exit 1 already means "an update is available" and the Settings doc
 *  tells operators to act on it, so a run that failed because the database was unreachable would
 *  otherwise fire an upgrade script. */
export const UPDATE_ERROR_EXIT = 2;

export async function runUpdateCheck(opts: { json: boolean }): Promise<number> {
  let ctx: Awaited<ReturnType<typeof createAppContext>> | undefined;
  try {
    ctx = await createAppContext(loadConfig());
    // ctx.updateCheck is the already-constructed UpdateCheck (createUpdateCheck(appSettings) is
    // called once inside createAppContext) — reuse it rather than building a second instance
    // over ctx.appSettings.
    const state = await ctx.updateCheck.read(runningVersion());
    const { text, code } = renderUpdateCheck(state, opts);
    process.stdout.write(text + '\n');
    return code;
  } catch (err) {
    const message = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: message }, null, 2) + '\n');
    else process.stderr.write(`update check failed: ${message}\n`);
    return UPDATE_ERROR_EXIT;
  } finally {
    // A close() failure must not turn a good run into a thrown rejection at the command layer.
    try { await ctx?.close(); } catch { /* nothing useful left to report */ }
  }
}
