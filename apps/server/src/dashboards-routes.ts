import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { DashboardQueryError, DashboardShareError, setDashboardShare, type AppContext } from '@openldr/bootstrap';
import { DashboardSchema, WidgetQuerySchema, PII_COLUMNS, bindQuery, type Dashboard } from '@openldr/dashboards';
import { EXTERNAL_TABLE_COLUMNS } from '@openldr/db/schema/external';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// Reads and query execution require dashboards.view; authoring (create/update/delete of shared
// operational dashboards) is split by verb into dashboards.create/edit/delete. Raw-SQL widget
// authoring is gated further by the `dashboard.raw_sql` feature flag (see
// assertSqlAuthoringAllowed), and dashboard query execution itself is SELECT-only/read-only in
// @openldr/dashboards.
const VIEW = { preHandler: requireCapability('dashboards.view') };
const CREATE = { preHandler: requireCapability('dashboards.create') };
const EDIT = { preHandler: requireCapability('dashboards.edit') };
const DELETE = { preHandler: requireCapability('dashboards.delete') };
const EXPOSURE = { preHandler: requireCapability('data_exposure.manage') };

// The governed tables + labels shown on the Settings -> Data Exposure page (a fixed subset of
// EXTERNAL_TABLE_COLUMNS that is joinable/modeled). Only these tables are readable/writable via
// the column-policy routes below — any other key in a PUT body is silently ignored.
const GOVERNED: Array<{ table: keyof typeof EXTERNAL_TABLE_COLUMNS; label: string }> = [
  { table: 'patients', label: 'Patient' },
  { table: 'specimens', label: 'Specimen' },
  { table: 'lab_requests', label: 'Request' },
  { table: 'facilities', label: 'Facility' },
  { table: 'diagnostic_reports', label: 'Report' },
  // FAC-P1-17: facility_map is the warehouse reporting dimension (facility name, code and
  // administrative area). It was in EXTERNAL_TABLE_COLUMNS but in no policy, so its columns were
  // exposed by omission. Its defaults live in HARDCODED_DENY_UNION/PII_COLUMNS.facility_map.
  { table: 'facility_map', label: 'Facility Map' },
  // Test mapping spec 4.2: governed from the start, so no column is exposed by omission (FAC-P1-17).
  { table: 'test_map', label: 'Test Map' },
];

// Collect the set of already-vetted SQL templates (trimmed) from a persisted dashboard. On
// UPDATE these are the SQL widgets the user is allowed to keep — layout/chart/config edits to
// them must save even with the flag off; only NEW or CHANGED SQL is authoring and gated.
function persistedSqlTemplates(prev: Dashboard | undefined): Set<string> {
  const set = new Set<string>();
  if (!prev) return set;
  for (const w of prev.widgets) {
    if (w.query.mode === 'sql' && typeof w.query.sql === 'string') set.add(w.query.sql.trim());
  }
  return set;
}

// Authoring gate: when the `dashboard.raw_sql` feature flag is off, reject persisting a dashboard whose
// widgets introduce NEW or CHANGED `mode:'sql'` queries. This stops an untrusted user (the
// dashboard routes have no role gating) from storing arbitrary SQL and then executing it as
// "vetted" SQL. Non-SQL edits — and edits to non-SQL fields of an already-persisted SQL widget
// (chart type, layout, config) — are allowed: only the SQL text itself is gated.
//
// `prevTemplates` is the set of SQL templates already persisted (empty on CREATE, so any
// sql-mode widget is new and rejected). On UPDATE, an incoming sql widget whose (trimmed) SQL
// exact-matches a persisted template is unchanged/vetted and passes; a new or edited template
// does not match and is rejected. The server-seeded sample is inserted via the store directly,
// bypassing this route.
function assertSqlAuthoringAllowed(sqlEnabled: boolean, d: Dashboard, prevTemplates: Set<string>): void {
  if (sqlEnabled) return;
  for (const w of d.widgets) {
    if (w.query.mode === 'sql') {
      const sql = typeof w.query.sql === 'string' ? w.query.sql.trim() : '';
      if (!prevTemplates.has(sql)) {
        throw new DashboardQueryError('raw SQL widgets are disabled');
      }
    }
  }
}

// A saved widget runs with only the dashboard's filter values from the caller (roles part 2).
const FilterValuesSchema = z.object({
  filterValues: z.record(z.string(), z.union([z.string().max(1000), z.number(), z.null(), z.object({ from: z.string().max(100), to: z.string().max(100) })])).default({}),
});
const ShareSchema = z.object({ roles: z.array(z.string().min(1).max(100)).max(200) });

export function registerDashboardRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  // Who may see a dashboard (design 2026-11-18-roles-scope, part 2). A dashboard a person may not
  // see is missing to them: 404 on every route, so its existence is not disclosed.
  const who = (req: { user?: { id: string; roleIds?: string[]; capabilities?: string[] } }) =>
    ({ id: req.user?.id ?? '', roleIds: req.user?.roleIds ?? [], capabilities: req.user?.capabilities ?? [] });
  const ref = (d: Dashboard) => ({ id: d.id, ownerId: d.ownerId ?? null });
  async function seen(req: Parameters<typeof who>[0], id: string): Promise<Dashboard | null> {
    const d = await ctx.dashboards.store.get(id);
    if (!d || !(await ctx.dashboardAccess.maySee(who(req), ref(d)))) return null;
    return d;
  }

  app.get('/api/dashboards/models', VIEW, async () => ctx.dashboards.models());

  // Global admin-governed universe of joinable tables (not per-model), for the join-picker UI.
  app.get('/api/dashboards/joinable-tables', VIEW, async () => ctx.dashboards.joinableTables());

  // Free-form queries are for the widget editor. A viewer runs saved widgets of dashboards they may
  // see instead (below), so a viewer cannot read data no dashboard shared with them shows.
  app.post('/api/dashboards/query', EDIT, async (req, reply) => {
    try {
      const q = WidgetQuerySchema.parse(req.body);
      return await ctx.dashboards.query(q);
    } catch (err) { return mapError(err, reply); }
  });

  // Builder→SQL eject: compile a builder-mode query to readable SQL text (parameters inlined as
  // literals) for the widget editor's SQL tab. Display-only — never executed as submitted here.
  app.post('/api/dashboards/compile-sql', EDIT, async (req, reply) => {
    try {
      const q = WidgetQuerySchema.parse(req.body);
      if (q.mode !== 'builder') { reply.code(400); return { error: 'compile-sql accepts a builder-mode query' }; }
      const sql = await ctx.dashboards.compileSql(q);
      return { sql };
    } catch (err) { return mapError(err, reply); }
  });

  app.get('/api/dashboards', VIEW, async (req) => {
    const all = await ctx.dashboards.store.list();
    const shown = new Set((await ctx.dashboardAccess.visible(who(req), all.map(ref))).map((d) => d.id));
    return all.filter((d) => shown.has(d.id));
  });

  app.get('/api/dashboards/:id', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await seen(req, id);
    if (!d) { reply.code(404); return { error: `unknown dashboard: ${id}` }; }
    return d;
  });

  // Run one saved widget of a dashboard the person may see, with only the dashboard's filter values
  // from the caller. The query is the stored one, bound here as the studio binds it.
  app.post('/api/dashboards/:id/widgets/:widgetId/query', VIEW, async (req, reply) => {
    const { id, widgetId } = req.params as { id: string; widgetId: string };
    try {
      const d = await seen(req, id);
      const w = d?.widgets.find((x) => x.id === widgetId);
      if (!d || !w) { reply.code(404); return { error: 'unknown dashboard or widget' }; }
      const { filterValues } = FilterValuesSchema.parse(req.body ?? {});
      const known = new Set(d.filters.map((f) => f.id));
      const unknown = Object.keys(filterValues).find((k) => !known.has(k));
      if (unknown) { reply.code(400); return { error: `no filter ${unknown} on this dashboard` }; }
      return await ctx.dashboards.query(bindQuery(w.query, filterValues));
    } catch (err) { return mapError(err, reply); }
  });

  // A dashboard filter's stored option list, for someone who may see the dashboard.
  app.post('/api/dashboards/:id/filters/:filterId/options', VIEW, async (req, reply) => {
    const { id, filterId } = req.params as { id: string; filterId: string };
    try {
      const d = await seen(req, id);
      const f = d?.filters.find((x) => x.id === filterId);
      if (!d || !f || !f.optionsSql) { reply.code(404); return { error: 'unknown dashboard or filter' }; }
      return await ctx.dashboards.query({ mode: 'sql', sql: f.optionsSql });
    } catch (err) { return mapError(err, reply); }
  });

  // Who a dashboard is shared with, with every role's name so an owner without roles.view can pick.
  app.get('/api/dashboards/:id/share', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await seen(req, id);
    if (!d) { reply.code(404); return { error: `unknown dashboard: ${id}` }; }
    const choices = (await ctx.roles.list()).map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
    return { roles: await ctx.dashboardAccessStore.get(id), choices, mayShare: ctx.dashboardAccess.mayShare(who(req), ref(d)) };
  });

  app.put('/api/dashboards/:id/share', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await seen(req, id);
    if (!d) { reply.code(404); return { error: `unknown dashboard: ${id}` }; }
    if (!ctx.dashboardAccess.mayShare(who(req), ref(d))) { reply.code(403); return { error: 'only the owner or an admin may share this dashboard' }; }
    const p = ShareSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    try {
      const { before, after } = await setDashboardShare({ access: ctx.dashboardAccessStore, dashboards: ctx.dashboards.store, roles: ctx.roles }, id, p.data.roles);
      // Objects, not bare arrays: node-pg would send an array as a Postgres array literal, which the
      // jsonb audit columns refuse.
      await recordAudit(ctx, req, { action: 'dashboard.share.set', entityType: 'dashboard', entityId: id, before: { roles: before }, after: { roles: after } });
      return { roles: after };
    } catch (err) {
      if (!(err instanceof DashboardShareError)) throw err;
      reply.code(err.reason === 'no-dashboard' ? 404 : 400);
      return { error: err.message };
    }
  });

  app.post('/api/dashboards', CREATE, async (req, reply) => {
    try {
      // The owner is the caller, whatever the body says (roles part 2).
      const parsed = { ...DashboardSchema.parse(req.body), ownerId: req.user?.id ?? null };
      // CREATE: no prior dashboard, so no SQL is vetted — any sql-mode widget is new and gated.
      const sqlEnabled = await ctx.featureFlags.get('dashboard.raw_sql');
      assertSqlAuthoringAllowed(sqlEnabled, parsed, new Set());
      const created = await ctx.dashboards.store.create(parsed);
      await recordAudit(ctx, req, { action: 'dashboard.create', entityType: 'dashboard', entityId: created.id, before: null, after: created });
      return created;
    } catch (err) { return mapError(err, reply); }
  });

  app.put('/api/dashboards/:id', EDIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const before = await seen(req, id);
      if (!before) { reply.code(404); return { error: `unknown dashboard: ${id}` }; }
      // The stored owner stays, whatever the body says (roles part 2).
      const parsed = { ...DashboardSchema.parse(req.body), ownerId: before.ownerId ?? null };
      // UPDATE: unchanged SQL widgets (SQL text matches what's already persisted) are exempt, so
      // layout/chart/config edits save; only genuinely new/changed SQL is authoring and gated.
      const sqlEnabled = await ctx.featureFlags.get('dashboard.raw_sql');
      assertSqlAuthoringAllowed(sqlEnabled, parsed, persistedSqlTemplates(before));
      const updated = await ctx.dashboards.store.update(id, parsed);
      await recordAudit(ctx, req, { action: 'dashboard.update', entityType: 'dashboard', entityId: id, before, after: updated });
      return updated;
    } catch (err) { return mapError(err, reply); }
  });

  app.delete('/api/dashboards/:id', DELETE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await seen(req, id);
    if (!before) { reply.code(404); return { error: `unknown dashboard: ${id}` }; }
    await ctx.dashboards.store.remove(id);
    if (before) {
      await recordAudit(ctx, req, { action: 'dashboard.delete', entityType: 'dashboard', entityId: id, before, after: null });
    }
    return { ok: true };
  });

  // Settings -> Data Exposure: per-table/per-column hidden flags, admin-governed and audited.
  app.get('/api/dashboards/column-policy', EXPOSURE, async () => {
    const hidden = await ctx.dashboards.columnPolicy.listHidden();
    return {
      tables: GOVERNED.map(({ table, label }) => {
        const hiddenSet = new Set(hidden[table] ?? []);
        const pii = new Set(PII_COLUMNS[table] ?? []);
        return {
          table,
          label,
          columns: EXTERNAL_TABLE_COLUMNS[table].map((name) => ({
            name,
            hidden: hiddenSet.has(name),
            pii: pii.has(name),
          })),
        };
      }),
    };
  });

  app.put('/api/dashboards/column-policy', EXPOSURE, async (req, reply) => {
    try {
      const body = (req.body ?? {}) as Record<string, string[]>;
      const before = await ctx.dashboards.columnPolicy.listHidden();
      // Only GOVERNED tables are writable; any other body key is ignored. Column names are
      // validated against the real schema so unknown/typo'd names never get persisted.
      for (const { table } of GOVERNED) {
        if (!Array.isArray(body[table])) continue;
        const valid = new Set(EXTERNAL_TABLE_COLUMNS[table]);
        const hiddenCols = body[table].filter((c) => valid.has(c));
        await ctx.dashboards.columnPolicy.replaceTable(table, hiddenCols, req.user?.username ?? undefined);
      }
      await ctx.dashboards.reloadColumnPolicy();
      const after = await ctx.dashboards.columnPolicy.listHidden();
      await recordAudit(ctx, req, {
        action: 'data_exposure.policy.updated',
        entityType: 'column_exposure_policy',
        entityId: 'global',
        before,
        after,
      });
      return { ok: true };
    } catch (err) { return mapError(err, reply); }
  });
}

function mapError(err: unknown, reply: FastifyReply): { error: string } {
  if (err instanceof ZodError) { reply.code(400); return { error: 'invalid payload' }; }
  if (err instanceof DashboardQueryError || (err instanceof Error && err.name === 'DashboardQueryError')) {
    reply.code(400); return { error: (err as Error).message };
  }
  // Postgres unique-violation (SQLSTATE 23505): a concurrent create hit a unique constraint
  // (e.g. the id PK or a name index). That is a conflict, not a server fault — surface 409.
  if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505') {
    reply.code(409); return { error: 'already exists' };
  }
  const msg = err instanceof Error ? err.message : String(err);
  const isConn = /ECONNREFUSED|ETIMEDOUT|connection|connect/i.test(msg);
  reply.code(isConn ? 503 : 500);
  return { error: msg };
}
