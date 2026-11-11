import type { AggregatedHealth } from '@openldr/core';
import { testConnector } from './connector-test';
import { LAB_IDENTITY_DEFAULTS } from './lab-identity-defaults';
import type { SyncStatus } from './sync-handle';

// What a fresh install still needs before it is ready, as one list. An admin would otherwise open
// every settings page to find out, and a headless operator has no single command that says so.
// Each check exists because something goes wrong today when it is not met; the plan
// (docs/superpowers/plans/2026-11-11-setup-checks.md) cites the line for each.
// The studio translates the hint codes; the CLI prints SETUP_HINT_TEXT.

export type SetupCheckId = 'adapters' | 'signIn' | 'secretsKey' | 'labName' | 'timeZone' | 'connectors' | 'sync';
export type SetupStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type SetupHint =
  | 'adapterDown' | 'adapterDegraded' | 'signInOff' | 'secretsKeyMissing'
  | 'labNameDefault' | 'timeZoneEmpty' | 'timeZoneSqlServer'
  | 'connectorFailed' | 'syncIncomplete' | 'syncFailing' | 'checkError';

export interface SetupCheck {
  id: SetupCheckId;
  status: SetupStatus;
  /** A name or a count. Never an error message: those can hold hosts and users. */
  detail?: string;
  hint?: SetupHint;
  /** The studio page that fixes it. */
  fix?: string;
}

export interface SetupReport {
  /** True when no check failed. Warnings do not make it false. */
  ok: boolean;
  checks: SetupCheck[];
}

export interface SetupCheckDeps {
  cfg: { AUTH_DEV_BYPASS: boolean; NODE_ENV: string; SECRETS_ENCRYPTION_KEY?: string };
  targetEngine: string;
  health(): Promise<AggregatedHealth>;
  /** Stored lab identity, by key (`lab.name`). A key that is not set is absent. */
  labIdentity(): Promise<Record<string, string>>;
  connectors(): Promise<Array<{ id: string; name: string; type?: string | null; enabled: boolean }>>;
  connectorConfig(id: string): Promise<Record<string, string>>;
  /** Resolves when the connector answers, rejects when it does not. */
  testConnector(type: string, config: Record<string, string>): Promise<void>;
  syncStatus(): Promise<SyncStatus>;
}

export const SETUP_CHECK_TITLE: Record<SetupCheckId, string> = {
  adapters: 'Services',
  signIn: 'Sign-in',
  secretsKey: 'Secrets key',
  labName: 'Laboratory name',
  timeZone: 'Time zone',
  connectors: 'Connectors',
  sync: 'Sync with central',
};

export const SETUP_HINT_TEXT: Record<SetupHint, string> = {
  adapterDown: 'A service CE depends on is down. Run `openldr health` on the server to see which, then check that service and its settings.',
  adapterDegraded: 'A service CE depends on answers, but reports a problem. Run `openldr health` on the server for the detail.',
  signInOff: 'Sign-in is switched off (AUTH_DEV_BYPASS). Anyone who can reach this server is treated as an administrator. Turn it off before real use.',
  secretsKeyMissing: 'SECRETS_ENCRYPTION_KEY is not set. A connector that holds a password cannot be saved or read until it is.',
  labNameDefault: 'The laboratory name is empty or still the shipped default. Reports print it as the issuing laboratory. Set it in Settings, Laboratory.',
  timeZoneEmpty: 'No time zone is set. The monthly transmission report then counts days in UTC, which moves evening arrivals to the wrong day. Set it in Settings, Laboratory.',
  timeZoneSqlServer: 'Not used on a SQL Server warehouse. Leave the setting empty and type the Windows zone name into each report run.',
  connectorFailed: 'A connector does not answer. Open Settings, Connectors and run Test or Diagnose on it.',
  syncIncomplete: 'Sync is on but has no central URL or no site id. Finish it in Settings, Distributed sync, or turn sync off.',
  syncFailing: 'The last sync cycle failed. Open Settings, Distributed sync to see why.',
  checkError: 'This check could not run. The server log has the reason.',
};

const DEFAULT_LAB_NAME = LAB_IDENTITY_DEFAULTS.find((d) => d.id === 'lab.name')?.value ?? '';

async function adapters(deps: SetupCheckDeps): Promise<SetupCheck> {
  const health = await deps.health();
  const named = (status: string) => Object.entries(health.checks).filter(([, r]) => r.status === status).map(([name]) => name).sort();
  const down = named('down');
  if (down.length > 0) return { id: 'adapters', status: 'fail', hint: 'adapterDown', detail: down.join(', ') };
  const degraded = named('degraded');
  if (degraded.length > 0) return { id: 'adapters', status: 'warn', hint: 'adapterDegraded', detail: degraded.join(', ') };
  return { id: 'adapters', status: 'pass' };
}

async function signIn(deps: SetupCheckDeps): Promise<SetupCheck> {
  if (!deps.cfg.AUTH_DEV_BYPASS) return { id: 'signIn', status: 'pass' };
  return { id: 'signIn', status: deps.cfg.NODE_ENV === 'production' ? 'fail' : 'warn', hint: 'signInOff' };
}

async function secretsKey(deps: SetupCheckDeps): Promise<SetupCheck> {
  return deps.cfg.SECRETS_ENCRYPTION_KEY ? { id: 'secretsKey', status: 'pass' } : { id: 'secretsKey', status: 'warn', hint: 'secretsKeyMissing' };
}

async function labName(deps: SetupCheckDeps): Promise<SetupCheck> {
  const name = ((await deps.labIdentity())['lab.name'] ?? '').trim();
  if (name === '' || name === DEFAULT_LAB_NAME) return { id: 'labName', status: 'warn', hint: 'labNameDefault', fix: '/settings/laboratory' };
  return { id: 'labName', status: 'pass', detail: name };
}

async function timeZone(deps: SetupCheckDeps): Promise<SetupCheck> {
  // The setting takes IANA names only, which SQL Server cannot use, so it must stay empty there.
  if (deps.targetEngine === 'mssql') return { id: 'timeZone', status: 'skip', hint: 'timeZoneSqlServer' };
  const zone = ((await deps.labIdentity())['lab.timezone'] ?? '').trim();
  if (zone === '') return { id: 'timeZone', status: 'warn', hint: 'timeZoneEmpty', fix: '/settings/laboratory' };
  return { id: 'timeZone', status: 'pass', detail: zone };
}

async function connectors(deps: SetupCheckDeps): Promise<SetupCheck> {
  // Host connectors only (databases, mail, SFTP). A plugin connector is tested through its plugin.
  const hosts = (await deps.connectors()).filter((c) => c.enabled && c.type);
  if (hosts.length === 0) return { id: 'connectors', status: 'skip' };
  const failed: string[] = [];
  await Promise.all(hosts.map(async (c) => {
    try {
      await deps.testConnector(c.type as string, await deps.connectorConfig(c.id));
    } catch {
      failed.push(c.name);
    }
  }));
  if (failed.length > 0) return { id: 'connectors', status: 'fail', hint: 'connectorFailed', fix: '/settings/connectors', detail: failed.sort().join(', ') };
  return { id: 'connectors', status: 'pass', detail: `${hosts.length} of ${hosts.length}` };
}

async function sync(deps: SetupCheckDeps): Promise<SetupCheck> {
  const status = await deps.syncStatus();
  if (!status.enabled) return { id: 'sync', status: 'skip' };
  if (!status.centralUrl.trim() || !status.siteId.trim()) return { id: 'sync', status: 'fail', hint: 'syncIncomplete', fix: '/settings/sync' };
  // ISO strings compare in time order. A failure counts only if no success came after it.
  const failing = [status.push, status.pull].some((d) => d !== null && d.lastErrorAt !== null && (d.lastSuccessAt === null || d.lastErrorAt > d.lastSuccessAt));
  if (failing) return { id: 'sync', status: 'warn', hint: 'syncFailing', fix: '/settings/sync' };
  return { id: 'sync', status: 'pass' };
}

const CHECKS: Array<[SetupCheckId, (deps: SetupCheckDeps) => Promise<SetupCheck>]> = [
  ['adapters', adapters], ['signIn', signIn], ['secretsKey', secretsKey], ['labName', labName],
  ['timeZone', timeZone], ['connectors', connectors], ['sync', sync],
];

/** Run every check. One that throws reports as failed and never stops the others. */
export async function runSetupChecks(deps: SetupCheckDeps): Promise<SetupReport> {
  const checks = await Promise.all(CHECKS.map(async ([id, run]): Promise<SetupCheck> => {
    try {
      return await run(deps);
    } catch {
      // The error text is dropped on purpose: it can name hosts, users and file paths.
      return { id, status: 'fail', hint: 'checkError' };
    }
  }));
  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}

/** The checks' sources, taken from a running app context. The route and the CLI both use this. */
export function setupCheckDeps(ctx: {
  cfg: SetupCheckDeps['cfg'];
  targetEngine: string;
  health: { runAll(): Promise<AggregatedHealth> };
  labIdentity: { all(): Promise<Record<string, string>> };
  connectors: {
    list(): Promise<Array<{ id: string; name: string; type?: string | null; enabled: boolean }>>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  sync: { status(): Promise<SyncStatus> };
}): SetupCheckDeps {
  return {
    cfg: ctx.cfg,
    targetEngine: ctx.targetEngine,
    health: () => ctx.health.runAll(),
    labIdentity: () => ctx.labIdentity.all(),
    connectors: () => ctx.connectors.list(),
    connectorConfig: (id) => ctx.connectors.getDecryptedConfig(id, ctx.cfg.SECRETS_ENCRYPTION_KEY),
    testConnector: async (type, config) => { await testConnector(type, config); },
    syncStatus: () => ctx.sync.status(),
  };
}
