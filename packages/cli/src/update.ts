import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createAppContext } from '@openldr/bootstrap';
import type { UpdateState } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { updateVerdict } from '@openldr/core/pure';
import { redactError } from './redact-error';

/**
 * What version is this CLI running? There is no `readAppVersion` reachable from `packages/cli`
 * (the one at `apps/server/src/version.ts` is app-local and not exported), so this mirrors it:
 * prefer `APP_VERSION`, else walk up from this module looking for a `version` field, working in
 * both dev (`packages/cli/src`) and the bundled CLI (`dist`).
 *
 * ⛔ The env check is not optional, and it must stay FIRST. Inside the image the walk finds
 * /app/cli/package.json — @openldr/cli's OWN version, not the release. Measured on a live 0.1.2
 * install with APP_VERSION=0.1.0: the server reported 0.1.0 and this reported 0.1.2, so
 * `openldr update check` and the studio About card disagreed about the same install. Both read
 * the same cached manifest, so the running number is the only thing that can drift.
 */
export function runningVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
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

export function renderUpdateCheck(state: UpdateState, opts: { json: boolean }): { text: string; code: number } {
  const verdict = updateVerdict(state);
  // Exit 1 means "an update exists" so this can be scripted; it is not an error. Errors exit 2,
  // see UPDATE_ERROR_EXIT below.
  const code = verdict.kind === 'update_available' ? 1 : 0;

  // Every pre-existing field is kept. Adding `verdict` is safe for a script reading this;
  // removing anything would not be.
  if (opts.json) return { text: JSON.stringify({ ...state, verdict }, null, 2), code };

  const lines = [`running:   ${state.running}`];
  if (verdict.kind === 'check_off') {
    lines.push('update check is disabled (Studio: Settings → General)');
    return { text: lines.join('\n'), code };
  }
  lines.push(`published: ${state.latestVersion ?? 'unknown'}`);

  // ⛔ Only a real check failure prints this. The bad_running_version cause fires with lastError
  // null, and naming a failure that never happened points the operator at the network when the
  // problem is the build's own version string.
  if (verdict.kind === 'cannot_confirm' && verdict.cause === 'check_failed') {
    lines.push(`last check failed: ${verdict.error}`);
  }

  switch (verdict.kind) {
    case 'update_available':
      lines.push(
        '',
        `${verdict.latest} is available. To upgrade, run these in your install directory:`,
        '', '  docker compose pull', '  docker compose up -d',
      );
      if (verdict.notesUrl) lines.push('', `release notes: ${verdict.notesUrl}`);
      return { text: lines.join('\n'), code };
    case 'cannot_confirm':
      lines.push('', verdict.cause === 'bad_running_version'
        ? `cannot confirm this is the latest: ${verdict.error}.`
        : 'cannot confirm this is the latest.');
      return { text: lines.join('\n'), code };
    case 'never_checked':
      lines.push('', 'not checked yet.');
      return { text: lines.join('\n'), code };
    case 'up_to_date':
      lines.push('', 'this install is up to date.');
      return { text: lines.join('\n'), code };
  }
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
