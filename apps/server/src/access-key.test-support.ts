// Shared setup for the access key tests. The real buildApp over pg-mem, with the real key, role,
// user and audit stores. Not real Postgres. Token sign-in is faked by verifyToken only.
import { vi } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createAccessKeyStore, createRoleStore } from '@openldr/db';
import { createAuditStore } from '@openldr/audit';
import { createLogger, type Logger } from '@openldr/core';
import type { AppContext } from '@openldr/bootstrap';
// apps/server does not depend on @openldr/users. The same relative reach into another package's
// source as account-status-auth.test.ts uses, so the hook runs against the real user store.
import { createUserStore } from '../../../packages/users/src/store';
import { buildApp } from './app';
import { ctxWith } from './test-helpers';

/** Token values the fake verifyToken accepts, and the subject each one signs in as. */
export const TOKENS = { admin: 'admin-token', viewer: 'viewer-token' } as const;
const CLAIMS: Record<string, { sub: string; preferred_username: string }> = {
  [TOKENS.admin]: { sub: 'admin-sub', preferred_username: 'admin' },
  [TOKENS.viewer]: { sub: 'viewer-sub', preferred_username: 'viewer' },
};

export const bearer = (value: string) => ({ authorization: `Bearer ${value}` });

/** The fake directory's accounts, keyed by provider id. `ai-sub` has no local row: it never signed in. */
export const DIRECTORY: Record<string, { id: string; username: string; enabled: boolean }> = {
  'admin-sub': { id: 'admin-sub', username: 'admin', enabled: true },
  'viewer-sub': { id: 'viewer-sub', username: 'viewer', enabled: true },
  'bot-sub': { id: 'bot-sub', username: 'bot', enabled: true },
  'ai-sub': { id: 'ai-sub', username: 'ai', enabled: true },
  'off-sub': { id: 'off-sub', username: 'off', enabled: false },
};

export async function keyFixture(opts: { devBypass?: boolean; logger?: Logger; adapter?: string; identityAdmin?: boolean } = {}) {
  const db = await makeMigratedDb();
  // pg-mem has no advisory lock, so the subject lock runs the work directly.
  const users = createUserStore(db, { withSubjectLock: async (_subject, work) => work(db) });
  const roles = createRoleStore(db);
  const accessKeys = createAccessKeyStore(db);
  const audit = createAuditStore(db);
  const verifyToken = vi.fn(async (token: string) => {
    const claims = CLAIMS[token];
    if (!claims) throw new Error('bad token');
    return claims;
  });

  // Three accounts. Each is already linked to its subject and past the one-time role backfill.
  const account = async (id: string, subject: string, username: string) => {
    await db.insertInto('users').values({ id, subject, username, roles: JSON.stringify([]) as never, rbac_initialized: true }).execute();
  };
  await account('admin-id', 'admin-sub', 'admin');
  await account('viewer-id', 'viewer-sub', 'viewer');
  await account('bot-id', 'bot-sub', 'bot');
  const managers = await roles.create({ name: 'Key managers', slug: 'key_managers', capabilities: ['users.manage', 'users.view'] });
  const viewers = await roles.create({ name: 'Viewers', slug: 'viewers', capabilities: ['users.view'] });
  await roles.assignRole('admin-sub', managers.id);
  await roles.assignRole('viewer-sub', viewers.id);
  await roles.assignRole('bot-sub', managers.id);

  const base = ctxWith('up');
  // Identity admin on: Keycloak with admin credentials, and a directory that knows DIRECTORY.
  // Off: ctxWith's directory, which answers "not configured".
  const directoryGet = vi.fn(async (id: string): Promise<(typeof DIRECTORY)[string] | null> => DIRECTORY[id] ?? null);
  const directory = opts.identityAdmin
    ? { ...((base.auth as { directory: object }).directory), get: directoryGet }
    : (base.auth as { directory: object }).directory;
  const adminCfg = opts.identityAdmin ? { KEYCLOAK_ADMIN_CLIENT_ID: 'fixture', KEYCLOAK_ADMIN_CLIENT_SECRET: 'fixture' } : {};
  const ctx = {
    ...base,
    logger: opts.logger ?? createLogger({ level: 'silent' }),
    internalDb: db as never,
    users, roles, accessKeys, audit,
    auth: { ...(base.auth as object), verifyToken, directory },
    cfg: { ...(base.cfg as object), AUTH_DEV_BYPASS: opts.devBypass ?? false, AUTH_ADAPTER: opts.adapter ?? 'keycloak', ...adminCfg },
  } as unknown as AppContext;
  const app = await buildApp(ctx);

  /** Makes a key for `userId` through the route, signed in as the admin token. */
  const makeKey = async (userId = 'bot-id', name = 'backup job', expiresAt?: string | null) => {
    const res = await app.inject({ method: 'POST', url: `/api/users/${userId}/keys`, headers: bearer(TOKENS.admin), payload: { name, expiresAt } });
    if (res.statusCode !== 201) throw new Error(`key create answered ${res.statusCode}`);
    return res.json() as { key: string; record: { id: string; name: string; prefix: string } };
  };
  const allAuditRows = () => db.selectFrom('audit_events').selectAll().execute();

  return { app, ctx, db, users, roles, accessKeys, audit, verifyToken, directoryGet, managers, viewers, makeKey, allAuditRows, close: () => app.close() };
}
