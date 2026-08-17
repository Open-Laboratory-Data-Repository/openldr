import { describe, it, expect } from 'vitest';
import i18n from '@/i18n';
import type { Notification } from '@/api';
import { notifTitle, notifBody } from './notif-text';

/** notifTitle/notifBody re-resolve the text from `type` + `metadata`, so a type the
 *  locales do not know about renders whatever the server sent — or, once a caller
 *  passes no fallback, a raw key. Every type the server can emit needs both keys. */
const t = i18n.getFixedT('en');

function make(over: Partial<Notification>): Notification {
  return {
    id: 'n1', type: 'update_available', priority: 'info',
    title: 'server title', body: 'server body', linkTo: '/settings/general',
    createdAt: '2026-08-20T10:00:00.000Z', readAt: null, metadata: null,
    ...over,
  } as Notification;
}

describe('notif-text for update_available', () => {
  it('resolves a localized title, not the server string and not a raw key', () => {
    const title = notifTitle(make({}), t);
    expect(title).not.toContain('{{');
    expect(title).not.toBe('server title');
    expect(title).toMatch(/update/i);
  });

  it('resolves a localized body with the version interpolated', () => {
    const body = notifBody(make({ metadata: { version: '0.2.0', running: '0.1.1' } }), t);
    expect(body).not.toContain('{{');
    expect(body).toContain('0.2.0');
    expect(body).toContain('0.1.1');
  });
});
