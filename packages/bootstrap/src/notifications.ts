import type { Kysely } from 'kysely';
import type { SyncActivityRow, InternalSchema, SyncActivityStore } from '@openldr/db';
import type { AuditEvent, AuditStore } from '@openldr/audit';
import type { Logger } from '@openldr/core';
import type { UpdateState } from './update-check';

export type NotificationPriority = 'info' | 'warning' | 'critical';
export type NotificationType =
  | 'sync_diverged' | 'sync_failed' | 'sync_quarantined'
  | 'plugin_crashed' | 'system_crashed' | 'auth_failed' | 'site_revoked'
  | 'terminology_import_done' | 'terminology_import_failed'
  | 'update_available';

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  linkTo: string | null;
  createdAt: string;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface NotificationPreference { type: string; enabled: boolean }
export type MinPriority = NotificationPriority;

export const PRIORITY_RANK: Record<NotificationPriority, number> = { info: 0, warning: 1, critical: 2 };

const SYNC_MAP: Record<string, { type: NotificationType; priority: NotificationPriority; linkTo: string } | undefined> = {
  diverged: { type: 'sync_diverged', priority: 'critical', linkTo: '/settings/sync' },
  failed: { type: 'sync_failed', priority: 'warning', linkTo: '/activity' },
  quarantined: { type: 'sync_quarantined', priority: 'warning', linkTo: '/activity' },
};

/** English fallbacks. The client re-resolves via i18n from `type` + `metadata`. */
export function syncRowToNotification(row: SyncActivityRow): Notification | null {
  const m = SYNC_MAP[row.event];
  if (!m) return null;
  const titleByType: Record<string, string> = {
    sync_diverged: 'Sync divergence detected',
    sync_failed: 'Sync failed',
    sync_quarantined: 'Records quarantined during sync',
  };
  return {
    id: `sync:${row.id}`,
    type: m.type,
    priority: m.priority,
    title: titleByType[m.type],
    body: row.error ?? (row.records ? `${row.records} record(s), ${row.direction}` : null),
    linkTo: m.linkTo,
    createdAt: row.occurredAt,
    readAt: null,
    metadata: { direction: row.direction, records: row.records, error: row.error, ...(row.metadata ?? {}) },
  };
}

const AUDIT_MAP: Record<string, { type: NotificationType; priority: NotificationPriority; linkTo: string; title: string } | undefined> = {
  'auth.failed': { type: 'auth_failed', priority: 'warning', linkTo: '/audit', title: 'Authentication failure' },
  'plugin.crash': { type: 'plugin_crashed', priority: 'critical', linkTo: '/activity', title: 'Plugin crashed' },
  // System/API-process crashes are NOT plugin crashes — give them their own type so the client
  // doesn't label them "Plugin crashed".
  'system.crash': { type: 'system_crashed', priority: 'critical', linkTo: '/activity', title: 'System crash' },
  'system.crash_loop': { type: 'system_crashed', priority: 'critical', linkTo: '/activity', title: 'Crash loop detected' },
  'settings.sync.revoke': { type: 'site_revoked', priority: 'warning', linkTo: '/settings/sites', title: 'Site access revoked' },
  'terminology.import.completed': { type: 'terminology_import_done', priority: 'info', linkTo: '/terminology', title: 'Terminology import complete' },
  'terminology.import.failed': { type: 'terminology_import_failed', priority: 'warning', linkTo: '/terminology', title: 'Terminology import failed' },
};

/**
 * `auth.failed` reasons (`apps/server/src/auth-failed.ts`) that carry NO security signal, because
 * no credential was presented that could have been forged:
 *
 *  - `expired` — a validly signed token that simply aged out while the user was idle.
 *  - `missing` — no Authorization header at all. An absent credential says nothing about who sent
 *    the request; it is the ordinary result of ANY un-authenticated client touching a protected
 *    route, not a failed break-in.
 *
 * `missing` has to be here, not just `expired`: the studio nulls its own token the moment the
 * session lapses (`addAccessTokenExpired` in apps/studio/src/auth/oidc.ts), so an expired session
 * reaches the server carrying nothing and is recorded as `missing`. Suppressing only `expired`
 * therefore never fired for the app that produces almost all of these rows — measured on a dev
 * install, every single `auth.failed` row was `missing` and none was `expired`.
 *
 * Every other reason (bad-signature, wrong-audience, wrong-issuer, no-matching-key, invalid,
 * account-disabled, sync-failed) means a credential WAS presented and rejected, which is a real
 * signal and still notifies. Suppressed reasons are only kept off the bell — they stay in the
 * audit log and remain visible on /audit.
 */
const AUTH_REASONS_WITHOUT_SECURITY_SIGNAL = new Set(['expired', 'missing']);

export function auditRowToNotification(row: AuditEvent): Notification | null {
  const m = AUDIT_MAP[row.action];
  if (!m) return null;
  if (row.action === 'auth.failed') {
    // The reason is written to entityId, and duplicated into metadata.reason (auth-plugin.ts).
    // Check both, so a row from either shape is suppressed.
    const reason = (row.metadata as { reason?: unknown } | null)?.reason;
    if (AUTH_REASONS_WITHOUT_SECURITY_SIGNAL.has(row.entityId)
      || (typeof reason === 'string' && AUTH_REASONS_WITHOUT_SECURITY_SIGNAL.has(reason))) {
      return null;
    }
  }
  return {
    id: `audit:${row.id}`,
    type: m.type,
    priority: m.priority,
    title: m.title,
    body: `${row.entityType}: ${row.entityId}`,
    linkTo: m.linkTo,
    createdAt: row.occurredAt,
    readAt: null,
    metadata: { entityType: row.entityType, entityId: row.entityId, actorName: row.actorName, ...(typeof row.metadata === 'object' && row.metadata ? row.metadata as Record<string, unknown> : {}) },
  };
}

/** The bell entry for an available update. Synthetic — derived from the cached state, with no
 *  source row and no table of its own.
 *
 *  ⛔ Three things this must get right, each of which produces a plausible but broken bell:
 *   - `createdAt` is firstSeenAt, NEVER now. listNotifications marks anything with
 *     createdAt <= the mark-all-read cursor as read; a `now` value always beats the cursor, so
 *     the entry would reappear unread on every request and could never be dismissed.
 *   - the id is keyed on the VERSION, so there is one entry per release rather than per poll.
 *   - it is appended OUTSIDE gather()'s 30-day window (see listNotifications) — it is not a
 *     source row, and an update still available after 30 days must not vanish from the bell. */
export function updateStateToNotification(state: UpdateState): Notification | null {
  if (!state.enabled || !state.updateAvailable) return null;
  if (!state.latestVersion || !state.firstSeenAt) return null;
  return {
    id: `update:${state.latestVersion}`,
    type: 'update_available',
    priority: 'info',
    title: `Version ${state.latestVersion} is available`,
    body: `This install is running ${state.running}.`,
    linkTo: '/settings/general',
    createdAt: state.firstSeenAt,
    readAt: null,
    metadata: {
      version: state.latestVersion,
      running: state.running,
      releasedAt: state.releasedAt,
      notesUrl: state.notesUrl,
    },
  };
}

export function passesPrefs(n: Notification, disabled: Set<string>, minPriority: NotificationPriority): boolean {
  if (disabled.has(n.type)) return false;
  if (PRIORITY_RANK[n.priority] < PRIORITY_RANK[minPriority]) return false;
  return true;
}

export interface NotificationCtx {
  internalDb: Kysely<InternalSchema>;
  syncActivity: SyncActivityStore;
  audit: AuditStore;
  logger: Logger;
  /** Optional so every existing caller and test that builds this ctx keeps compiling. Absent
   *  means the bell simply has no update entry. */
  updateState?: UpdateState;
}

const AUDIT_ACTIONS = ['auth.failed', 'plugin.crash', 'system.crash', 'system.crash_loop', 'settings.sync.revoke', 'terminology.import.completed', 'terminology.import.failed'];
const WINDOW_DAYS = 30;
const CURSOR_ID = '__cursor__';
const MIN_PRIORITY_TYPE = '__min_priority__';

function windowStart(): string {
  return new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
}

/** All notification-worthy source rows in the window, newest first, before read-state/prefs.
 *  Audit rows are queried PER-ACTION so a high-volume unrelated action can never starve a
 *  target action out of a single shared LIMIT. */
async function gather(ctx: NotificationCtx): Promise<Notification[]> {
  const since = windowStart();
  const [syncRows, auditResults] = await Promise.all([
    ctx.syncActivity.list({ limit: 200 }),
    Promise.all(AUDIT_ACTIONS.map((action) => ctx.audit.list({ action, from: since, limit: 100 }))),
  ]);
  const out: Notification[] = [];
  for (const r of syncRows) {
    if (r.occurredAt < since) continue;
    const n = syncRowToNotification(r);
    if (n) out.push(n);
  }
  for (const rows of auditResults) {
    for (const r of rows) {
      const n = auditRowToNotification(r);
      if (n) out.push(n);
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

async function readState(ctx: NotificationCtx, userId: string): Promise<{ cursor: string | null; ids: Map<string, string> }> {
  const rows = await ctx.internalDb.selectFrom('notification_reads')
    .select(['notification_id', 'read_at']).where('user_id', '=', userId).execute();
  let cursor: string | null = null;
  const ids = new Map<string, string>();
  for (const r of rows) {
    const readAt = r.read_at instanceof Date ? r.read_at.toISOString() : String(r.read_at);
    if (r.notification_id === CURSOR_ID) cursor = readAt;
    else ids.set(r.notification_id, readAt);
  }
  return { cursor, ids };
}

export async function getNotificationPrefs(ctx: NotificationCtx, userId: string): Promise<{ disabled: string[]; minPriority: NotificationPriority }> {
  const rows = await ctx.internalDb.selectFrom('notification_prefs')
    .select(['type', 'enabled', 'value']).where('user_id', '=', userId).execute();
  const disabled: string[] = [];
  let minPriority: NotificationPriority = 'info';
  for (const r of rows) {
    if (r.type === MIN_PRIORITY_TYPE) {
      if (r.value === 'warning' || r.value === 'critical' || r.value === 'info') minPriority = r.value;
    } else if (r.enabled === false) {
      disabled.push(r.type);
    }
  }
  return { disabled, minPriority };
}

export async function listNotifications(
  ctx: NotificationCtx,
  userId: string,
  params: { limit?: number; offset?: number; unreadOnly?: boolean; type?: string; priority?: string } = {},
): Promise<{ notifications: Notification[]; unreadCount: number; total: number }> {
  const [all, prefs, reads] = await Promise.all([gather(ctx), getNotificationPrefs(ctx, userId), readState(ctx, userId)]);
  const disabled = new Set(prefs.disabled);
  const visible = all.filter((n) => passesPrefs(n, disabled, prefs.minPriority));
  // Appended AFTER gather()'s window filter on purpose — see updateStateToNotification. Prefs
  // still apply, so an operator can switch this type off like any other.
  const update = ctx.updateState ? updateStateToNotification(ctx.updateState) : null;
  if (update && passesPrefs(update, disabled, prefs.minPriority)) visible.push(update);
  // apply read-state
  const withRead = visible.map((n) => {
    const readByIdAt = reads.ids.get(n.id);
    if (readByIdAt) return { ...n, readAt: readByIdAt };
    if (reads.cursor != null && n.createdAt <= reads.cursor) return { ...n, readAt: reads.cursor };
    return n;
  });
  const unreadCount = withRead.filter((n) => !n.readAt).length;
  let filtered = withRead;
  if (params.type) filtered = filtered.filter((n) => n.type === params.type);
  if (params.priority) filtered = filtered.filter((n) => n.priority === params.priority);
  if (params.unreadOnly) filtered = filtered.filter((n) => !n.readAt);
  const total = filtered.length;
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 50;
  return { notifications: filtered.slice(offset, offset + limit), unreadCount, total };
}

export async function markNotificationsRead(ctx: NotificationCtx, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date();
  for (const id of ids) {
    await ctx.internalDb.insertInto('notification_reads')
      .values({ user_id: userId, notification_id: id, read_at: now })
      .onConflict((oc) => oc.columns(['user_id', 'notification_id']).doUpdateSet({ read_at: now }))
      .execute();
  }
}

export async function markAllNotificationsRead(ctx: NotificationCtx, userId: string): Promise<void> {
  const now = new Date();
  await ctx.internalDb.insertInto('notification_reads')
    .values({ user_id: userId, notification_id: CURSOR_ID, read_at: now })
    .onConflict((oc) => oc.columns(['user_id', 'notification_id']).doUpdateSet({ read_at: now }))
    .execute();
  // Prune per-id rows older than the cursor to keep the table small.
  await ctx.internalDb.deleteFrom('notification_reads')
    .where('user_id', '=', userId)
    .where('notification_id', '!=', CURSOR_ID)
    .where('read_at', '<=', now)
    .execute();
}

export async function saveNotificationPrefs(
  ctx: NotificationCtx, userId: string, prefs: NotificationPreference[], minPriority?: NotificationPriority,
): Promise<void> {
  for (const p of prefs) {
    await ctx.internalDb.insertInto('notification_prefs')
      .values({ user_id: userId, type: p.type, enabled: p.enabled, value: null })
      .onConflict((oc) => oc.columns(['user_id', 'type']).doUpdateSet({ enabled: p.enabled }))
      .execute();
  }
  if (minPriority) {
    await ctx.internalDb.insertInto('notification_prefs')
      .values({ user_id: userId, type: MIN_PRIORITY_TYPE, enabled: null, value: minPriority })
      .onConflict((oc) => oc.columns(['user_id', 'type']).doUpdateSet({ value: minPriority }))
      .execute();
  }
}
