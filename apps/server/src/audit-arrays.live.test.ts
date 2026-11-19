import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Kysely, sql } from 'kysely';
import { createInternalDb, type InternalDb } from '@openldr/db';
import { createAuditStore } from '@openldr/audit';
import type { AppContext } from '@openldr/bootstrap';
import * as auditEvents from '../../../packages/db/src/migrations/internal/005_audit_events';
import { registerRolesRoutes } from './roles-routes';
import { registerReportCategoryRoutes } from './report-categories-routes';

// pg-mem stores a JavaScript array in a jsonb column without complaint. Real Postgres gets the
// array from the pg driver as an array literal and refuses it as JSON, so the audit row is lost.
// Only a live database shows that (demo.4 test, SUP-017).
const url = process.env.INTERNAL_DATABASE_URL;

describe.skipIf(!url)('audits whose before and after are lists save on real Postgres', () => {
  let admin: InternalDb;
  let internal: InternalDb;
  let app: FastifyInstance;
  let schema: string;
  const logged: unknown[] = [];

  beforeEach(async () => {
    schema = 'roles_audit_' + randomUUID().replaceAll('-', '');
    admin = createInternalDb(url!);
    await sql`create schema ${sql.id(schema)}`.execute(admin.db);
    const scoped = new URL(url!);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    internal = createInternalDb(scoped.toString());
    await auditEvents.up(internal.db as Kysely<unknown>);
    let categories: unknown[] = [{ id: 'old', label: 'Old', order: 1 }];
    const held = new Map<string, string[]>([['u1', ['r-old']]]);
    const role = (id: string) => ({ id, name: id, capabilities: [], builtIn: false });
    const ctx = {
      audit: createAuditStore(internal.db),
      logger: { error: (...a: unknown[]) => logged.push(a), warn: () => {}, info: () => {}, debug: () => {} },
      roles: {
        rolesForUser: async (id: string) => (held.get(id) ?? []).map(role),
        setUserRoles: async (id: string, ids: string[]) => { held.set(id, ids); },
      },
      reportCategories: {
        list: async () => categories,
        save: async (next: unknown[]) => { categories = next; },
      },
    } as unknown as AppContext;
    app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'admin', username: 'admin', roles: [], capabilities: ['roles.manage', 'reports.edit_templates'] } as never;
    });
    registerRolesRoutes(app, ctx);
    registerReportCategoryRoutes(app, ctx);
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    await internal?.close();
    if (admin) {
      await sql`drop schema ${sql.id(schema)} cascade`.execute(admin.db);
      await admin.close();
    }
    logged.length = 0;
  });

  it('writes user.assign_role with the roles before and after', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/users/u1/roles', payload: { roleIds: ['r-new'] } });
    expect(res.statusCode).toBe(200);
    expect(logged).toEqual([]);
    const rows = await internal.db.selectFrom('audit_events').selectAll().where('action', '=', 'user.assign_role').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.before).toMatchObject({ roles: [{ id: 'r-old' }] });
    expect(rows[0]!.after).toMatchObject({ roles: [{ id: 'r-new' }] });
  });

  it('writes report-category.update with the categories before and after', async () => {
    const payload = [{ id: 'new', label: 'New', order: 1 }];
    const res = await app.inject({ method: 'PUT', url: '/api/report-categories', payload });
    expect(res.statusCode).toBe(200);
    expect(logged).toEqual([]);
    const rows = await internal.db.selectFrom('audit_events').selectAll().where('action', '=', 'report-category.update').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.before).toMatchObject({ categories: [{ id: 'old' }] });
    expect(rows[0]!.after).toMatchObject({ categories: [{ id: 'new' }] });
  });
});
