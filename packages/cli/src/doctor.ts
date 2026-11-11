import { loadConfig } from '@openldr/config';
import {
  createAppContext, recordAuditEvent, runSetupChecks, setupCheckDeps,
  SETUP_CHECK_TITLE, SETUP_HINT_TEXT, type SetupReport,
} from '@openldr/bootstrap';

/** Plain-text report: one line per check, the advice indented under a warning, failure or skip note. */
export function formatSetupReport(report: SetupReport): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    lines.push(`${check.status.toUpperCase().padEnd(5)} ${SETUP_CHECK_TITLE[check.id]}${check.detail ? `: ${check.detail}` : ''}`);
    if (check.hint) lines.push(`      ${SETUP_HINT_TEXT[check.hint]}`);
  }
  const failed = report.checks.filter((c) => c.status === 'fail').length;
  const warned = report.checks.filter((c) => c.status === 'warn').length;
  const parts = [
    ...(failed ? [`${failed} failed`] : []),
    ...(warned ? [`${warned} warning${warned === 1 ? '' : 's'}`] : []),
  ];
  lines.push('', parts.length ? `${parts.join(', ')}.` : 'All checks passed.');
  return lines.join('\n');
}

/** The same list as Settings, Setup checks. Read-only, but it opens test connections with the
 *  stored connector credentials, so it leaves one audit row, like `connectors diagnose`. */
export async function runDoctor(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const report = await runSetupChecks(setupCheckDeps(ctx));
    const ids = (status: string) => report.checks.filter((c) => c.status === status).map((c) => c.id);
    await recordAuditEvent(ctx, { actorType: 'cli', actorId: null, actorName: 'cli' }, {
      action: 'setup.check', entityType: 'system', entityId: 'setup',
      metadata: { ok: report.ok, failed: ids('fail'), warned: ids('warn') },
    });
    process.stdout.write((opts.json ? JSON.stringify(report, null, 2) : formatSetupReport(report)) + '\n');
    return report.ok ? 0 : 1;
  } finally { await ctx.close(); }
}
