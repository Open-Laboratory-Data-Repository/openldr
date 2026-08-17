import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createSyncActivityStore } from '@openldr/db';
import type { InternalSchema } from '@openldr/db';
import { createAuditStore } from '@openldr/audit';
import type { Logger } from '@openldr/core';
import {
  listNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  saveNotificationPrefs,
  updateStateToNotification,
  type NotificationCtx,
} from './notifications';
import type { UpdateState } from './update-check';

const nullLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;

const state = (over: Partial<UpdateState> = {}): UpdateState => ({
  enabled: true, running: '0.1.1', latestVersion: '0.2.0', releasedAt: '2026-08-20',
  notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z',
  lastCheckedAt: '2026-08-20T10:00:00.000Z', lastError: null, updateAvailable: true, ...over,
});

async function buildCtx(): Promise<NotificationCtx> {
  const internalDb = (await makeMigratedDb()) as Kysely<InternalSchema>;
  const syncActivity = createSyncActivityStore(internalDb);
  const audit = createAuditStore(internalDb);
  return { internalDb, syncActivity, audit, logger: nullLogger };
}

describe('notifications DB store', () => {
  let ctx: NotificationCtx;

  beforeEach(async () => {
    ctx = await buildCtx();
    // Seed: one sync_activity 'failed' row + one 'synced' row (the synced row must never surface
    // as a notification), and one audit 'auth.failed' row.
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    await ctx.syncActivity.record({ direction: 'push', event: 'synced', records: 3 });
    await ctx.audit.record({
      actorType: 'system',
      actorName: 'system',
      action: 'auth.failed',
      entityType: 'user',
      entityId: 'bob',
    });
  });

  it('lists the failed sync + auth.failed audit rows, but never the synced row', async () => {
    const { notifications, unreadCount, total } = await listNotifications(ctx, 'user1', {});
    expect(total).toBe(2);
    expect(unreadCount).toBe(2);
    const types = notifications.map((n) => n.type).sort();
    expect(types).toEqual(['auth_failed', 'sync_failed']);
    expect(notifications.some((n) => n.id.startsWith('sync:'))).toBe(true);
    expect(notifications.some((n) => n.id.startsWith('audit:'))).toBe(true);
  });

  it('markNotificationsRead marks a single id read, dropping it from unreadOnly + unreadCount', async () => {
    const before = await listNotifications(ctx, 'user1', {});
    const failed = before.notifications.find((n) => n.type === 'sync_failed');
    expect(failed).toBeTruthy();

    await markNotificationsRead(ctx, 'user1', [failed!.id]);

    const after = await listNotifications(ctx, 'user1', {});
    expect(after.unreadCount).toBe(1);
    expect(after.total).toBe(2); // still visible, just read

    const unreadOnly = await listNotifications(ctx, 'user1', { unreadOnly: true });
    expect(unreadOnly.notifications).toHaveLength(1);
    expect(unreadOnly.notifications[0].type).toBe('auth_failed');
  });

  it('markAllNotificationsRead drops unreadCount to 0', async () => {
    await markAllNotificationsRead(ctx, 'user1');
    const { unreadCount, total } = await listNotifications(ctx, 'user1', {});
    expect(unreadCount).toBe(0);
    expect(total).toBe(2);
  });

  it('saveNotificationPrefs disabling auth_failed removes it from the list', async () => {
    await saveNotificationPrefs(ctx, 'user1', [{ type: 'auth_failed', enabled: false }]);
    const { notifications, total } = await listNotifications(ctx, 'user1', {});
    expect(total).toBe(1);
    expect(notifications.every((n) => n.type !== 'auth_failed')).toBe(true);
    expect(notifications[0].type).toBe('sync_failed');
  });

  it('saveNotificationPrefs with minPriority critical hides the remaining warning-level rows', async () => {
    await saveNotificationPrefs(ctx, 'user1', [{ type: 'auth_failed', enabled: false }]);
    await saveNotificationPrefs(ctx, 'user1', [], 'critical');
    const { notifications, total, unreadCount } = await listNotifications(ctx, 'user1', {});
    expect(total).toBe(0);
    expect(unreadCount).toBe(0);
    expect(notifications).toEqual([]);
  });

  it('excludes sync_activity rows older than the 30-day window, includes an in-window row', async () => {
    // Older than the window: seeded by inserting straight into the table, since the store always
    // stamps occurred_at via now().
    const oldDate = new Date(Date.now() - 40 * 86_400_000);
    await ctx.internalDb
      .insertInto('sync_activity')
      .values({
        id: randomUUID(),
        occurred_at: oldDate,
        direction: 'push',
        event: 'failed',
        records: 0,
        error: 'stale beyond window',
        metadata: null,
      })
      .execute();
    // Inside the window: a fresh row via the normal store path (occurred_at = now()).
    await ctx.syncActivity.record({ direction: 'push', event: 'quarantined', records: 1 });

    const { notifications } = await listNotifications(ctx, 'user1', {});
    expect(notifications.some((n) => n.body === 'stale beyond window')).toBe(false);
    expect(notifications.some((n) => n.type === 'sync_quarantined')).toBe(true);
  });

  // Trap 3: gather() drops source rows older than WINDOW_DAYS=30. The update entry is NOT a
  // source row, so it must survive past the window — the update is still available.
  it('includes the update entry even when firstSeenAt is older than the source window', async () => {
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const res = await listNotifications(
      { ...ctx, updateState: state({ firstSeenAt: old }) } as never,
      'u1',
      {},
    );
    expect(res.notifications.some((n) => n.id === 'update:0.2.0')).toBe(true);
  });

  // The push must not just tack the entry onto the end of the already-sorted list — it has to be
  // re-sorted into its true chronological position, or an install with > limit notifications can
  // push it past the page boundary and hide it forever (see notifications.ts:listNotifications).
  it('sorts the update entry to the top when its firstSeenAt is the newest', async () => {
    // "now", captured after beforeEach's seed rows were written, so it is strictly newer than them
    // and still in the past by the time listNotifications runs below.
    const newest = new Date().toISOString();
    const c = { ...ctx, updateState: state({ firstSeenAt: newest }) } as never;
    const { notifications } = await listNotifications(c, 'user1', {});
    expect(notifications[0].id).toBe('update:0.2.0');
  });

  it('sorts the update entry to the bottom when its firstSeenAt is older than the rest', async () => {
    const older = new Date(Date.now() - 3_600_000).toISOString(); // 1 hour before the seeded rows
    const c = { ...ctx, updateState: state({ firstSeenAt: older }) } as never;
    const { notifications } = await listNotifications(c, 'user1', {});
    expect(notifications[notifications.length - 1].id).toBe('update:0.2.0');
  });

  it('stays dismissed after mark-all-read', async () => {
    // firstSeenAt must be in the PAST for this to mean anything: mark-all-read writes a cursor of
    // now() and reads it back as `createdAt <= cursor`. The shared fixture's 2026-08-20 is a fixed
    // literal that goes stale the moment the clock is behind it, so pin it relative to now.
    const seen = new Date(Date.now() - 3_600_000).toISOString();
    const c = { ...ctx, updateState: state({ firstSeenAt: seen }) } as never;
    await markAllNotificationsRead(c, 'u1');
    const res = await listNotifications(c, 'u1', {});
    const n = res.notifications.find((x) => x.id === 'update:0.2.0');
    expect(n?.readAt).toBeTruthy();
  });

  it('markNotificationsRead sets readAt to the actual mark-read timestamp, not createdAt', async () => {
    const before = await listNotifications(ctx, 'user1', {});
    const failed = before.notifications.find((n) => n.type === 'sync_failed');
    expect(failed).toBeTruthy();
    expect(failed!.readAt).toBeNull();

    const beforeMark = Date.now();
    await markNotificationsRead(ctx, 'user1', [failed!.id]);
    const afterMark = Date.now();

    const after = await listNotifications(ctx, 'user1', {});
    const stillFailed = after.notifications.find((n) => n.id === failed!.id);
    expect(stillFailed).toBeTruthy();
    expect(stillFailed!.readAt).not.toBeNull();
    // The bug this guards against: readAt falling back to createdAt instead of the real mark-read time.
    expect(stillFailed!.readAt).not.toBe(stillFailed!.createdAt);
    const readAtMs = new Date(stillFailed!.readAt!).getTime();
    expect(readAtMs).toBeGreaterThanOrEqual(beforeMark - 1000);
    expect(readAtMs).toBeLessThanOrEqual(afterMark + 1000);
  });
});

describe('updateStateToNotification', () => {
  it('is null when no update is available', () => {
    expect(updateStateToNotification(state({ updateAvailable: false }))).toBeNull();
  });

  it('is null when the check is disabled', () => {
    expect(updateStateToNotification(state({ enabled: false, updateAvailable: false }))).toBeNull();
  });

  it('is null when firstSeenAt is missing — without it the entry cannot be dismissed', () => {
    expect(updateStateToNotification(state({ firstSeenAt: null }))).toBeNull();
  });

  // Trap 2: one notification per VERSION, not per poll.
  it('uses a stable id keyed on the version', () => {
    expect(updateStateToNotification(state())!.id).toBe('update:0.2.0');
    expect(updateStateToNotification(state({ latestVersion: '0.3.0' }))!.id).toBe('update:0.3.0');
  });

  // Trap 1: createdAt must be firstSeenAt. A `now` value always beats the mark-all-read cursor,
  // so the entry would come back unread on every request.
  it('uses firstSeenAt as createdAt, unchanged across calls', () => {
    const a = updateStateToNotification(state())!;
    const b = updateStateToNotification(state())!;
    expect(a.createdAt).toBe('2026-08-20T10:00:00.000Z');
    expect(b.createdAt).toBe(a.createdAt);
  });

  it('is an info notification pointing at the settings page', () => {
    const n = updateStateToNotification(state())!;
    expect(n.type).toBe('update_available');
    expect(n.priority).toBe('info');
    expect(n.linkTo).toBe('/settings/general');
    expect(n.metadata).toMatchObject({ version: '0.2.0', running: '0.1.1' });
  });
});
