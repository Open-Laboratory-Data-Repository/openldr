import { getAccessToken, isAuthEnforced, notifyUnauthorized } from './auth/token';
import type { PluginBrokerOp, PluginRpcResult } from '@openldr/plugin-ui-sdk';
import type { ReportDesign } from '@openldr/report-designer/pure';
// Browser-safe subpath — no kysely/pg. Same seam FacilityDialog.tsx already imports
// CORE_FACILITY_KEYS through; see the re-export comment further down for why the level list
// itself now comes from here too instead of being hand-duplicated.
import type { FacilityAdminLevel } from '@openldr/db/facility-answers';
// Task 4 (scale): the per-row mapping/projection health union `list()` now derives
// (facility-registry-store.ts). `import type` only — TS elides a type-only import entirely, so
// this never actually pulls @openldr/db's root module (kysely/pg and friends) into the browser
// bundle, the same guarantee the facility-answers subpath above exists to give at the value level.
// Aliased on import: this file already has its own unrelated `FacilityHealth` interface further
// down (Task 11's report-dimension chip shape, from GET /api/facilities/health) — same name,
// completely different concept, and that one is already widely imported by name elsewhere in the
// app, so the newcomer is the one that takes the alias rather than forcing a rename through every
// existing caller.
import type { FacilityHealth as FacilityRowHealth } from '@openldr/db';
import type { ParsedFilter, ParsedSort } from '@openldr/table-query';

/** Routes the server answers WITHOUT a bearer token. Mirrors the public-path checks at the top of
 *  the `onRequest` hook in `apps/server/src/auth-plugin.ts` — keep the two in step.
 *
 *  The list deliberately errs towards "public": misclassifying a protected path as public here
 *  only falls back to the previous behaviour (send it, take the 401), whereas the reverse would
 *  short-circuit a call the server would happily have answered. */
function isPublicApiPath(path: string): boolean {
  // /health and the static SPA are not under /api at all.
  if (path !== '/api' && !path.startsWith('/api/')) return true;
  // The SPA reads OIDC settings here before it has a token — must never be short-circuited.
  if (path === '/api/config') return true;
  // Webhook triggers and sync push authenticate via their own per-route secret, not a session.
  if (path.startsWith('/api/workflows/hooks/')) return true;
  if (path.startsWith('/api/sync/')) return true;
  return false;
}

/** Path component of any `fetch` input form (relative string, absolute string, URL, Request). */
function apiPathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const base = globalThis.location?.origin ?? 'http://localhost';
  try {
    return new URL(raw, base).pathname;
  } catch {
    return raw.split('?')[0];
  }
}

/** fetch wrapper that attaches the bearer token when one is present. */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  let res: Response;
  if (!token) {
    // We hold no credential to offer. When the server enforces auth, sending the request anyway is
    // a guaranteed 401 that ALSO writes an `auth.failed`/`missing` row via auth-plugin.ts — and
    // because NotificationBell polls every 45s, a tab whose token has lapsed manufactures the very
    // "Authentication failure" notification the bell then shows, once per throttle window, forever.
    // A client that knows it is unauthenticated must not generate a security audit event.
    //
    // Answer locally instead: same status and body the server sends (auth-plugin.ts), and the same
    // notifyUnauthorized() re-login trigger, minus the request and the audit row.
    //
    // Gated on isAuthEnforced() because under AUTH_DEV_BYPASS the server injects the dev actor for
    // exactly these token-less requests — short-circuiting there would break the whole dev mode.
    if (isAuthEnforced() && !isPublicApiPath(apiPathOf(input))) {
      notifyUnauthorized();
      return new Response(JSON.stringify({ error: 'authentication required' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    res = init !== undefined ? await fetch(input, init) : await fetch(input);
  } else {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    res = await fetch(input, { ...init, headers });
  }
  // A 401 means the session expired or was invalidated (silent-renew failed / SSO ended). Notify
  // the auth layer to re-trigger login instead of surfacing raw "authentication required" errors
  // on every page/widget. Public endpoints (/api/config, /health) return 200, so this won't fire
  // during the pre-login bootstrap.
  if (res.status === 401) notifyUnauthorized();
  return res;
}

/** A report's category is a free-form id into the editable report-category list
 *  (see reports/reportCategoriesApi.ts). Was previously a hardcoded enum. */
export type ReportCategory = string;
export interface ReportParamMeta {
  id: string;
  label: string;
  type: 'daterange' | 'select' | 'text';
  required: boolean;
  optionsKey?: string;
  help?: string;
  /** Declared shape of the run value. Enforced SERVER-side (a violation comes back as a 400 with
   *  code RP0004 naming the field); published here so a client can echo the same rule. */
  format?: 'timezone-no-signed-offset' | 'year-month';
  /** Example text for the empty box. Absent ⇒ falls back to the label, as before. */
  placeholder?: string;
}
export interface ReportMetricMeta {
  id: string;
  label: string;
  type: 'count' | 'sum' | 'avg' | 'pct';
  column?: string;
  match?: string;
}
export interface ReportSummary {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;
  parameters: ReportParamMeta[];
  summaryMetrics?: ReportMetricMeta[];
  /** 'catalog' = built-in report; 'design' = a report record linking a report-designer template +
   *  query. Absent ⇒ catalog. */
  source?: 'catalog' | 'design';
  /** For source==='design': the linked report-designer template id, for the "Edit template" deep-link. */
  designId?: string;
}
export interface ChartHint {
  type: 'bar' | 'line' | 'pie' | 'stat';
  x?: string; y?: string; series?: string; label?: string; value?: string;
}
export interface ReportColumn { key: string; label: string; kind: 'string' | 'number' | 'percent' | 'date' }
export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  chart: ChartHint;
  meta: { generatedAt: string; rowCount: number };
}

export async function fetchReports(): Promise<ReportSummary[]> {
  const res = await authFetch('/api/reports');
  if (!res.ok) throw new Error(`reports list failed: ${res.status}`);
  return res.json() as Promise<ReportSummary[]>;
}

export async function fetchReport(id: string, params: Record<string, string> = {}): Promise<ReportResult> {
  const qs = new URLSearchParams(params).toString();
  const res = await authFetch(`/api/reports/${id}${qs ? `?${qs}` : ''}`);
  // Surface the server's own reason (+ code + correlationId) rather than the bare status. Running a
  // report is the one call an operator makes constantly and the one most likely to fail on THEIR
  // input (an unpicked date range); "report r-amr-antibiogram failed: 500" told them nothing and
  // made a plain client mistake indistinguishable from an outage.
  return okJson<ReportResult>(res, `report ${id}`);
}

/** One choice in a report parameter's select. `value` is what the query filters on; `label` is
 *  what the operator reads. They differ deliberately: five DISA facility codes all display as
 *  "Aga Khan" in different districts, so a name-valued dropdown would silently merge them. */
export interface ReportParamOption { value: string; label: string; }

export async function fetchReportOptions(id: string): Promise<Record<string, ReportParamOption[]>> {
  const res = await authFetch(`/api/reports/${encodeURIComponent(id)}/options`);
  if (!res.ok) throw new Error(`report options ${id} failed: ${res.status}`);
  return res.json() as Promise<Record<string, ReportParamOption[]>>;
}

export async function fetchReportPdf(id: string, params: Record<string, string> = {}): Promise<Blob> {
  const qs = new URLSearchParams(params).toString();
  const res = await authFetch(`/api/reports/${encodeURIComponent(id)}.pdf${qs ? `?${qs}` : ''}`);
  // Same coded-error surfacing as okJson (errorDetail + formatApiError below), just without the
  // res.json() success path — a PDF response body is a Blob, not JSON, so okJson itself can't be
  // reused here. On success this is unchanged: still res.blob(), still a Blob.
  if (!res.ok) throw new Error(formatApiError(`report pdf ${id}`, await errorDetail(res)));
  return res.blob();
}

export function csvUrl(id: string, params: Record<string, string> = {}): string {
  const qs = new URLSearchParams(params).toString();
  return `/api/reports/${id}.csv${qs ? `?${qs}` : ''}`;
}

export interface ReportRun {
  id: string;
  reportId: string;
  reportName: string;
  format: 'preview' | 'csv' | 'pdf' | 'xlsx';
  params: Record<string, string>;
  rowCount: number | null;
  userName: string | null;
  createdAt: string;
}

export async function logReportRun(
  id: string,
  body: { format: ReportRun['format']; rowCount?: number | null; params?: Record<string, string> },
): Promise<void> {
  try {
    await authFetch(`/api/reports/${encodeURIComponent(id)}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Fire-and-forget: logging must never block the user's action.
  }
}

export async function fetchReportRuns(
  opts: { reportId?: string; limit?: number; offset?: number } = {},
): Promise<{ runs: ReportRun[]; total: number }> {
  const qs = new URLSearchParams();
  if (opts.reportId) qs.set('reportId', opts.reportId);
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const q = qs.toString();
  const res = await authFetch(`/api/reports/runs${q ? `?${q}` : ''}`);
  if (!res.ok) throw new Error(`report runs failed: ${res.status}`);
  return res.json() as Promise<{ runs: ReportRun[]; total: number }>;
}

export async function downloadReportCsv(id: string, params: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams(params).toString();
  const res = await authFetch(`/api/reports/${encodeURIComponent(id)}.csv${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`report csv ${id} failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${id}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Report schedule types & API client ───────────────────────────────────────

export interface ReportSchedule {
  id: string;
  reportId: string;
  params: Record<string, string>;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  outputFormat: 'csv' | 'xlsx' | 'pdf';
  enabled: boolean;
  lastRunAt: string | null;
  nextDueAt: string | null;
  createdBy: string | null;
}
export interface ReportScheduleRun {
  id: string;
  scheduleId: string;
  reportId: string;
  reportName: string;
  runAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  outputFormat: string;
  objectKey: string | null;
  byteSize: number | null;
  rowCount: number | null;
  status: 'success' | 'failed';
  errorMessage: string | null;
}
export interface ScheduleInput {
  frequency: ReportSchedule['frequency'];
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  outputFormat: ReportSchedule['outputFormat'];
  params?: Record<string, string>;
}

export async function fetchSchedules(
  reportId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ schedules: ReportSchedule[]; total: number }> {
  const qs = new URLSearchParams();
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const q = qs.toString();
  const res = await authFetch(`/api/reports/${encodeURIComponent(reportId)}/schedules${q ? `?${q}` : ''}`);
  if (!res.ok) throw new Error(`schedules ${reportId} failed: ${res.status}`);
  return res.json() as Promise<{ schedules: ReportSchedule[]; total: number }>;
}
export async function createSchedule(reportId: string, body: ScheduleInput): Promise<ReportSchedule> {
  const res = await authFetch(`/api/reports/${encodeURIComponent(reportId)}/schedules`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create schedule failed: ${res.status}`);
  return res.json() as Promise<ReportSchedule>;
}
export async function updateSchedule(sid: string, patch: Partial<ScheduleInput> & { enabled?: boolean }): Promise<ReportSchedule> {
  const res = await authFetch(`/api/reports/schedules/${encodeURIComponent(sid)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update schedule failed: ${res.status}`);
  return res.json() as Promise<ReportSchedule>;
}
export async function deleteSchedule(sid: string): Promise<void> {
  const res = await authFetch(`/api/reports/schedules/${encodeURIComponent(sid)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete schedule failed: ${res.status}`);
}
export async function runScheduleNow(sid: string): Promise<void> {
  const res = await authFetch(`/api/reports/schedules/${encodeURIComponent(sid)}/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`run schedule failed: ${res.status}`);
}
export async function fetchScheduleRuns(
  opts: { reportId?: string; scheduleId?: string; limit?: number; offset?: number } = {},
): Promise<{ runs: ReportScheduleRun[]; total: number }> {
  const qs = new URLSearchParams();
  if (opts.reportId) qs.set('reportId', opts.reportId);
  if (opts.scheduleId) qs.set('scheduleId', opts.scheduleId);
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const q = qs.toString();
  const res = await authFetch(`/api/reports/schedule-runs${q ? `?${q}` : ''}`);
  if (!res.ok) throw new Error(`schedule runs failed: ${res.status}`);
  return res.json() as Promise<{ runs: ReportScheduleRun[]; total: number }>;
}
export async function downloadScheduleRun(runId: string): Promise<void> {
  const res = await authFetch(`/api/reports/schedule-runs/${encodeURIComponent(runId)}/download`);
  if (!res.ok) throw new Error(`download schedule run failed: ${res.status}`);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename="?([^"]+)"?/.exec(cd);
  const filename = m?.[1] ?? runId;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Dashboard types & API client ──────────────────────────────────────────────

export interface WidgetVariableDef {
  type: 'text' | 'number' | 'date' | 'date-range';
  label: string;
  options?: string[];
  optionsSql?: string;
  defaultValue?: string | number | null;
  defaultRange?: { from: string; to: string } | null;
}

export interface ConditionRule { kind: 'rule'; dimension: string; op: string; value: unknown }
export interface ConditionGroup { kind: 'group'; combinator: 'and' | 'or'; children: (ConditionRule | ConditionGroup)[] }

export type CustomColumnOperand =
  | { type: 'field'; dimension: string }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number };
export type CustomColumnExpr =
  | { kind: 'concat'; parts: CustomColumnOperand[] }
  | { kind: 'arithmetic'; op: '+' | '-' | '*' | '/'; left: CustomColumnOperand; right: CustomColumnOperand };
export interface CustomColumn { key: string; label: string; expr: CustomColumnExpr }

export interface UserJoin { id: string; table: string; left: string; right: string; label?: string }
export interface ClientJoinableTable { table: string; label: string; columns: string[]; primaryKeys: string[]; allColumns: string[] }

export type WidgetQuery =
  | { mode: 'builder'; model: string;
      metric?: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[]; derived?: { numerator: string; denominator: string; scale: number; decimals: number } };
      metrics?: { key: string; label?: string; agg: string; column?: string; where?: { dimension: string; op: string; value: unknown }[]; derived?: { numerator: string; denominator: string; scale: number; decimals: number } }[];
      dimension?: { key: string; grain?: string; reference?: string }; breakdown?: { key: string }; filters: { dimension: string; op: string; value: unknown }[];
      filterTree?: ConditionGroup;
      limit?: number;
      adhocDimensions?: { key: string; label: string; join: string; column: string; kind: 'string' | 'date' | 'number' }[];
      customColumns?: CustomColumn[];
      userJoins?: UserJoin[];
      variableBindings?: Record<string, string> }
  | { mode: 'sql'; sql: string; variableBindings?: Record<string, string>; variables?: Record<string, WidgetVariableDef>;
      values?: Record<string, string | number | null | { from: string; to: string }> };

export interface WidgetConfig {
  id: string; type: string; title: string; query: WidgetQuery; refreshIntervalSec: number; visual: Record<string, unknown>;
}
export interface LayoutItem { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }
export interface DashboardFilterDef { id: string; label: string; type: 'text' | 'number' | 'date' | 'date-range'; defaultValue?: string | number | null; defaultRange?: { from: string; to: string } | null; options?: string[]; optionsSql?: string }
export interface Dashboard {
  id: string; ownerId: string | null; name: string; layout: LayoutItem[]; widgets: WidgetConfig[];
  filters: DashboardFilterDef[]; refreshIntervalSec: number; isDefault: boolean; createdAt?: string; updatedAt?: string;
}
export interface ModelDimension { key: string; label: string; column: string; kind: 'string' | 'date' | 'number'; dateGrain?: string[]; compute?: { kind: 'age-band'; bands: { maxAge: number; label: string }[]; openEndedLabel: string; unknownLabel: string }; join?: string }
export interface ModelMetric { key: string; label: string; agg: string; column?: string }
export interface ClientOptionalJoin { alias: string; label: string; left: string; right: string; exposableColumns: string[] }
export interface QueryModel { id: string; label: string; dimensions: ModelDimension[]; metrics: ModelMetric[]; optionalJoins?: ClientOptionalJoin[]; tableColumns: string[] }

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function listModels(): Promise<QueryModel[]> {
  return authFetch('/api/dashboards/models').then((r) => okJson<QueryModel[]>(r, 'load models'));
}
export async function fetchJoinableTables(): Promise<ClientJoinableTable[]> {
  return authFetch('/api/dashboards/joinable-tables').then((r) => okJson<ClientJoinableTable[]>(r, 'load joinable tables'));
}
export async function runWidgetQuery(q: WidgetQuery): Promise<ReportResult> {
  return authFetch('/api/dashboards/query', json(q)).then((r) => okJson<ReportResult>(r, 'run query'));
}
/** Builder→SQL eject: compile a builder-mode query to its SQL text (display-only; never executed as returned). */
export async function compileBuilderToSql(q: Extract<WidgetQuery, { mode: 'builder' }>): Promise<string> {
  return authFetch('/api/dashboards/compile-sql', json(q))
    .then((r) => okJson<{ sql: string }>(r, 'compile sql'))
    .then((x) => x.sql);
}
export async function listDashboards(): Promise<Dashboard[]> {
  return authFetch('/api/dashboards').then((r) => okJson<Dashboard[]>(r, 'list dashboards'));
}
export async function getDashboard(id: string): Promise<Dashboard> {
  return authFetch(`/api/dashboards/${id}`).then((r) => okJson<Dashboard>(r, 'get dashboard'));
}
export async function createDashboard(d: Dashboard): Promise<Dashboard> {
  return authFetch('/api/dashboards', json(d)).then((r) => okJson<Dashboard>(r, 'create dashboard'));
}
export async function saveDashboard(d: Dashboard): Promise<Dashboard> {
  return authFetch(`/api/dashboards/${d.id}`, { ...json(d), method: 'PUT' }).then((r) => okJson<Dashboard>(r, 'save dashboard'));
}
export async function deleteDashboard(id: string): Promise<void> {
  const r = await authFetch(`/api/dashboards/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(`delete failed: ${r.status}`);
}

export interface ColumnPolicyColumn { name: string; hidden: boolean; pii: boolean }
export interface ColumnPolicyTable { table: string; label: string; columns: ColumnPolicyColumn[] }

export async function getColumnPolicy(): Promise<ColumnPolicyTable[]> {
  return authFetch('/api/dashboards/column-policy')
    .then((r) => okJson<{ tables: ColumnPolicyTable[] }>(r, 'load column policy'))
    .then((b) => b.tables);
}

export async function saveColumnPolicy(payload: Record<string, string[]>): Promise<void> {
  const r = await authFetch('/api/dashboards/column-policy', { ...json(payload), method: 'PUT' });
  if (!r.ok) throw new Error(`save column policy failed: ${r.status}`);
}

export interface OidcConfig { issuerUrl: string; clientId: string; audience: string | null }
export interface ClientConfig { dashboardSqlEnabled: boolean; authEnforced: boolean; version: string; environment: string; oidc: OidcConfig | null }
export async function fetchClientConfig(): Promise<ClientConfig> {
  const r = await authFetch('/api/config');
  if (!r.ok) return { dashboardSqlEnabled: false, authEnforced: false, version: '', environment: '', oidc: null };
  return r.json();
}

export interface FeatureFlag { id: string; labelKey: string; descriptionKey: string; value: boolean }

export const fetchFeatureFlags = (): Promise<FeatureFlag[]> =>
  authFetch('/api/settings/flags').then((r) => okJson<FeatureFlag[]>(r, 'list feature flags'));

export const setFeatureFlag = (key: string, value: boolean): Promise<{ key: string; value: boolean }> =>
  authFetch(`/api/settings/flags/${encodeURIComponent(key)}`, jbody({ value }, 'PUT'))
    .then((r) => okJson<{ key: string; value: boolean }>(r, 'set feature flag'));

/** The issuing lab's letterhead identity, keyed by its `lab.*` app_settings keys. */
export type LabIdentity = Record<string, string>;

export interface LabIdentityField {
  id: string;
  labelKey: string;
  multiline: boolean;
  /** Present when the field must be PICKED from a list rather than typed — today only
   *  `facility-registers`. See `LAB_IDENTITY_FIELDS` (@openldr/config) for why free text is unsafe
   *  for a register URI. */
  source?: 'facility-registers';
}
/** Field definitions come FROM the server: `@openldr/config` re-exports an env loader that reads
 *  process.env, so studio cannot import the registry (same reason feature flags work this way). */
export interface LabIdentityResponse {
  fields: LabIdentityField[];
  values: LabIdentity;
  logo: { maxBytes: number; mimeTypes: string[] };
}

export const fetchLabIdentity = (): Promise<LabIdentityResponse> =>
  authFetch('/api/settings/lab').then((r) => okJson<LabIdentityResponse>(r, 'load lab identity'));

export const saveLabIdentity = (patch: LabIdentity): Promise<{ values: LabIdentity }> =>
  authFetch('/api/settings/lab', jbody(patch, 'PUT')).then((r) => okJson<{ values: LabIdentity }>(r, 'save lab identity'));

export interface NumberSetting {
  id: string;
  labelKey: string;
  descriptionKey: string;
  value: number;
  min: number;
  max: number;
}

export const fetchNumberSettings = (): Promise<NumberSetting[]> =>
  authFetch('/api/settings/numbers').then((r) => okJson<NumberSetting[]>(r, 'list number settings'));

export const setNumberSetting = (key: string, value: number): Promise<{ key: string; value: number }> =>
  authFetch(`/api/settings/numbers/${encodeURIComponent(key)}`, jbody({ value }, 'PUT'))
    .then((r) => okJson<{ key: string; value: number }>(r, 'set number setting'));

// ── Lab ⇄ central sync (S4) ────────────────────────────────────────────────────
// Studio MIRRORS the server shapes: SyncConfigView/SyncConfigInput (@openldr/config)
// + SyncStatus/SyncDirectionStatus (@openldr/bootstrap sync-handle).
export type SyncMode = 'push' | 'pull' | 'bidirectional';
/** GET /api/settings/sync — never carries the secret value, only `clientSecretSet`. */
export interface SyncConfigView {
  enabled: boolean;
  mode: SyncMode;
  centralUrl: string;
  siteId: string;
  oidcIssuer: string;
  clientId: string;
  clientSecretSet: boolean;
  intervalMinutes: number;
  /** Whether a lab signing private key is stored (S5). Write-only: the value is never returned. */
  signingKeySet: boolean;
  /** Central's public key (DER hex), readable — a public key is not a secret (S5). */
  centralPublicKey: string;
}
/** PUT /api/settings/sync — `clientSecret` is WRITE-ONLY: omit it to preserve the stored value.
 *  `centralPublicKey` is OPTIONAL: omit it to preserve the enrollment-pinned key. */
export interface SyncConfigInput {
  enabled: boolean;
  mode: SyncMode;
  centralUrl: string;
  siteId: string;
  oidcIssuer: string;
  clientId: string;
  clientSecret?: string;
  intervalMinutes: number;
  centralPublicKey?: string;
}
export interface SyncDirectionStatus {
  running: boolean;
  lastSeq: number;
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}
export interface SyncStatus {
  enabled: boolean;
  mode: SyncMode;
  centralUrl: string;
  siteId: string;
  push: SyncDirectionStatus | null;
  pull: SyncDirectionStatus | null;
  pendingPush: number;
}

export const fetchSyncConfig = (): Promise<SyncConfigView> =>
  authFetch('/api/settings/sync').then((r) => okJson<SyncConfigView>(r, 'load sync config'));

export const saveSyncConfig = (cfg: SyncConfigInput): Promise<SyncConfigView> =>
  authFetch('/api/settings/sync', jbody(cfg, 'PUT')).then((r) => okJson<SyncConfigView>(r, 'save sync config'));

export const fetchSyncStatus = (): Promise<SyncStatus> =>
  authFetch('/api/settings/sync/status').then((r) => okJson<SyncStatus>(r, 'sync status'));

export interface SyncActivityRow {
  id: string;
  occurredAt: string;
  direction: 'push' | 'pull' | 'amend';
  event: 'synced' | 'failed' | 'quarantined' | 'diverged';
  records: number;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

export const fetchSyncActivity = (): Promise<SyncActivityRow[]> =>
  authFetch('/api/settings/sync/activity').then((r) => okJson<SyncActivityRow[]>(r, 'sync activity'));

/** POST /api/settings/sync/now. Returns 409 `{triggered:false,reason:'disabled'}` when sync is off —
 *  surface that as a result rather than an error so the caller can show an info toast. */
export async function triggerSyncNow(): Promise<{ triggered: boolean; reason?: string }> {
  const r = await authFetch('/api/settings/sync/now', jbody({}, 'POST'));
  if (r.status === 409) return r.json() as Promise<{ triggered: boolean; reason?: string }>;
  return okJson<{ triggered: boolean; reason?: string }>(r, 'sync now');
}

// ── Central enrollment (sync S4d) ──────────────────────────────────────────────
// Studio MIRRORS the server shapes: EnrollResult (@openldr/bootstrap enrollment) +
// SyncSiteRow (@openldr/db sync-site-store). The clientSecret is returned ONLY by
// enroll/rotate and is NEVER re-fetchable — GET /sites carries no secret.
export interface SyncSiteRow {
  siteId: string;
  name: string | null;
  clientId: string;
  enrolledAt: string;
  enrolledBy: string | null;
  status: 'active' | 'revoked';
}
export interface EnrollResult {
  clientId: string;
  clientSecret: string;
  siteId: string;
  centralUrl: string;
  oidcIssuer: string;
}

/** Build an Error that carries the HTTP status so the caller can map 400/404/409/503 to a
 *  precise toast instead of the raw server message. */
async function statusError(res: Response, what: string): Promise<Error & { status: number }> {
  return Object.assign(new Error(formatApiError(what, await errorDetail(res))), { status: res.status });
}

export const fetchSites = (): Promise<SyncSiteRow[]> =>
  authFetch('/api/settings/sync/sites').then((r) => okJson<SyncSiteRow[]>(r, 'list sites'));

export async function enrollSite(body: { siteId: string; name?: string; centralUrl: string }): Promise<EnrollResult> {
  const res = await authFetch('/api/settings/sync/enroll', jbody(body, 'POST'));
  if (!res.ok) throw await statusError(res, 'enroll site');
  return res.json() as Promise<EnrollResult>;
}

export async function rotateSite(siteId: string): Promise<{ clientId: string; clientSecret: string }> {
  const res = await authFetch(`/api/settings/sync/sites/${encodeURIComponent(siteId)}/rotate`, jbody({}, 'POST'));
  if (!res.ok) throw await statusError(res, 'rotate site');
  return res.json() as Promise<{ clientId: string; clientSecret: string }>;
}

export async function revokeSite(siteId: string): Promise<{ revoked: boolean }> {
  const res = await authFetch(`/api/settings/sync/sites/${encodeURIComponent(siteId)}/revoke`, jbody({}, 'POST'));
  if (!res.ok) throw await statusError(res, 'revoke site');
  return res.json() as Promise<{ revoked: boolean }>;
}

export async function downloadCentralCertificate(): Promise<void> {
  const res = await authFetch('/api/settings/sync/central-certificate');
  if (!res.ok) throw Object.assign(new Error('cert download failed'), { status: res.status });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'central-certificate.pem';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type DangerAction = 'reset-dashboards' | 'factory-reset' | 'clear-audit';

export const runDangerAction = (action: DangerAction): Promise<{ ok: boolean; action: string }> =>
  authFetch(`/api/settings/danger/${action}`, jbody({}, 'POST'))
    .then((r) => okJson<{ ok: boolean; action: string }>(r, `danger:${action}`));

// ── FHIR validation strictness (Danger Zone) ───────────────────────────────────
export type ValidationStrictness = 'low' | 'medium' | 'high';

export const getValidation = (): Promise<{ strictness: ValidationStrictness }> =>
  authFetch('/api/settings/validation').then((r) => okJson<{ strictness: ValidationStrictness }>(r, 'get validation strictness'));

export const setValidation = (strictness: ValidationStrictness): Promise<{ strictness: ValidationStrictness }> =>
  authFetch('/api/settings/validation', jbody({ strictness }, 'PUT'))
    .then((r) => okJson<{ strictness: ValidationStrictness }>(r, 'set validation strictness'));

export interface HealthCheckResult { status: string; latencyMs: number; detail?: string }
export interface HealthReport { status: string; checks: Record<string, HealthCheckResult> }
export const fetchHealth = (): Promise<HealthReport> =>
  authFetch('/health').then((r) => r.json() as Promise<HealthReport>);

// Audit
export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorType: 'user' | 'system' | 'cli';
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}
export interface AuditQuery {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  filters?: ParsedFilter[];
  sorts?: ParsedSort[];
}
export const queryAudit = (q: AuditQuery): Promise<{ events: AuditEvent[]; total: number }> => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === '') continue;
    p.set(k, k === 'filters' || k === 'sorts' ? JSON.stringify(v) : String(v));
  }
  return apiGet(`/api/audit?${p.toString()}`, 'query audit');
};
export const getAuditEvent = (id: string): Promise<AuditEvent> => apiGet(`/api/audit/${id}`, 'get audit event');

// Users
export interface User {
  id: string;
  subject: string | null;
  username: string;
  displayName: string | null;
  email: string | null;
  roles: string[];
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string | null;
}
export interface CreateUserInput {
  username: string;
  displayName?: string | null;
  email?: string | null;
  roles?: string[];
}
export const USER_ROLES = ['lab_admin', 'lab_manager', 'lab_technician', 'data_analyst', 'system_auditor'] as const;

/** SP6 composed model: Keycloak identity + local profile extras. */
export interface UserSummary {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  roles: string[];
  createdAt: string | null;
  extras: Record<string, string>;
  formSchemaId: string | null;
  formVersion: number | null;
}

export type CreateUserPayload = {
  username: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  roles?: string[];
  password?: string;
  extras?: Record<string, { value: string; fhirPath: string | null }>;
  formSchemaId?: string | null;
  formVersion?: number | null;
};

export const listUsers = (): Promise<UserSummary[]> => apiGet('/api/users', 'list users');
export const createUser = (i: CreateUserPayload): Promise<UserSummary> =>
  authFetch('/api/users', jbody(i, 'POST')).then((r) => okJson<UserSummary>(r, 'create user'));
export const updateUser = (id: string, i: Partial<CreateUserPayload>): Promise<UserSummary> =>
  authFetch(`/api/users/${id}`, jbody(i, 'PUT')).then((r) => okJson<UserSummary>(r, 'update user'));
export const setUserStatus = (id: string, enabled: boolean): Promise<UserSummary> =>
  authFetch(`/api/users/${id}/status`, jbody({ enabled }, 'POST')).then((r) => okJson<UserSummary>(r, 'set user status'));
export const listPublishedForms = (targetPage: string): Promise<FormSummary[]> =>
  apiGet(`/api/forms/published?targetPage=${encodeURIComponent(targetPage)}`, 'list published forms');

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string | null;
  roles: string[];
}
export const getMe = (): Promise<CurrentUser> =>
  authFetch('/api/me').then((res) => okJson<CurrentUser>(res, 'get current user'));
export const resetUserPassword = (id: string, password: string, temporary: boolean): Promise<void> =>
  authFetch(`/api/users/${id}/reset-password`, jbody({ password, temporary }, 'POST')).then((r) => { if (!r.ok) throw new Error(`reset password failed: ${r.status}`); });
export const sendUserResetEmail = (id: string): Promise<void> =>
  authFetch(`/api/users/${id}/send-reset-email`, { method: 'POST' }).then((r) => { if (!r.ok) throw new Error(`send reset email failed: ${r.status}`); });
export const forceUserLogout = (id: string): Promise<void> =>
  authFetch(`/api/users/${id}/force-logout`, { method: 'POST' }).then((r) => { if (!r.ok) throw new Error(`force logout failed: ${r.status}`); });

// ── Facility registry (hand entry via the Users pattern) ──────────────────────
// Mirrors the server's FacilityRecord (packages/db/src/facility-registry-store.ts) as returned
// verbatim by GET/POST/PUT /api/facilities.
export interface Facility {
  id: string;
  /** The register this facility is listed in, by canonical URI. With `facilityCode`, its identity. */
  facilitySystem: string | null;
  /** The code that register carries for it. */
  facilityCode: string | null;
  /** @deprecated Superseded by `facilityCode` (migration 086); still served through the transition. */
  localCode: string | null;
  /** @deprecated Superseded by `facilitySystem`. */
  nationalSystem: string | null;
  /** @deprecated Superseded by `facilityCode`. */
  nationalCode: string | null;
  name: string;
  level: string | null;
  ownership: string | null;
  status: string | null;
  country: string | null;
  zone: string | null;
  region: string | null;
  district: string | null;
  council: string | null;
  ward: string | null;
  village: string | null;
  addressText: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Fields the Facility form added beyond the core columns above. */
  extras: Record<string, unknown>;
  /** NULL = lab-local, 'central' = central-managed and replaceable by down-sync. */
  managedOrigin: string | null;
  source: 'manual' | 'import';
  /** Task 10: registry MEMBERSHIP — `in_register` / `dropped` / `not_registered` (migration 081's
   *  `FACILITY_REGISTER_STATE_*` constants) — distinct from `status` above, which is operational
   *  only. Always present on a real response (the column is `NOT NULL DEFAULT 'not_registered'`
   *  and `toRecord()` — packages/db/src/facility-registry-store.ts — reads it back on every row),
   *  unlike `health`/`mappingCount` below, which genuinely are list()-only. */
  registerState: string;
  /** Task 4 (scale): mapping/projection health, derived per row — see `FacilityHealth`
   *  (`@openldr/db`, aliased above as `FacilityRowHealth`) and `FacilityListRow.health`
   *  (facility-registry-store.ts). Optional, not just theoretically: `list()` computes it via a
   *  join, but `get`/`create`/`update` (facility-registry-store.ts's `get`/`upsert`) resolve a
   *  plain `FacilityRecord`, which carries neither field — so a `Facility` this app just created or
   *  edited (see `Facilities.tsx`'s `upsert()`) genuinely does not have one until the next list page
   *  reload. Required fields here would be a promise this type cannot keep for every caller. */
  health?: FacilityRowHealth;
  /** How many active mappings currently resolve to this facility. Same list()-only availability as
   *  `health` above, and for the same reason. */
  mappingCount?: number;
}

export interface FacilitySubmit {
  answers: Record<string, unknown>;
  /** The form-DEFINITION id (not the schema's own slug) — the server resolves this via
   *  ctx.forms.get() to read the field list back out and decide which answers are core columns. */
  formSchemaId: string | null;
  formVersion: number | null;
}

// Task 4 (scale): GET /api/facilities is now a real paged endpoint (Task 3) — `list()`
// (facility-registry-store.ts) returns an EXACT `total` alongside one page of rows, so the client
// requests a bounded page instead of a client-side cap on how many rows to fetch at once (the
// previous `FACILITIES_LIST_LIMIT = 2000` approach this replaced, and the `truncated` banner that
// went with it — see Facilities.tsx's PAGE_SIZE for why paging, not virtualization, is what makes a
// 10-15k-row register usable here).
export interface FacilityListQuery {
  q?: string;
  country?: string; zone?: string; region?: string; district?: string; council?: string;
  status?: string; level?: string; ownership?: string;
  nationalSystem?: string; source?: string; managedOrigin?: string;
  /** Task 10: registry membership — `in_register` / `dropped` / `not_registered`. */
  registerState?: string;
  health?: FacilityRowHealth;
  limit?: number; offset?: number;
}
/** Mirrors the route's own return shape (facilities-routes.ts's `GET /api/facilities`): `limit`
 *  echoes the store's own default (`DEFAULT_LIST_LIMIT`) when the caller sent none, never the
 *  possibly-shorter `rows.length` — see that route's comment on why. `number`, not `number | null`
 *  (M4, whole-branch review): the route always returns `limit: limit ?? DEFAULT_LIST_LIMIT`, which
 *  is never null — a `number | null` type here claimed a possibility the wire shape doesn't have. */
export interface FacilityPage { rows: Facility[]; total: number; limit: number; offset: number }

export const listFacilities = (query: FacilityListQuery = {}): Promise<FacilityPage> => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const qs = p.toString();
  return apiGet(`/api/facilities${qs ? `?${qs}` : ''}`, 'list facilities');
};
export const createFacility = (body: FacilitySubmit): Promise<Facility> =>
  authFetch('/api/facilities', jbody(body, 'POST')).then((r) => okJson<Facility>(r, 'create facility'));
export const updateFacility = (id: string, body: FacilitySubmit): Promise<Facility> =>
  authFetch(`/api/facilities/${encodeURIComponent(id)}`, jbody(body, 'PUT')).then((r) => okJson<Facility>(r, 'update facility'));
// Scoped fix (Minor 1): the shared `apiDelete` helper collapses every failure to a bare
// "<what> failed: <status>", discarding the server's own JSON message. That helper is used by
// many other pages' delete calls, which are left untouched — only this one call is rewired to
// extract the response body (via the same errorDetail/formatApiError okJson already uses) so a
// 403 ("insufficient capability") or 404 from facilities-routes.ts reaches the operator verbatim
// instead of as "delete facility failed: 403".
export async function deleteFacility(id: string): Promise<void> {
  const res = await authFetch(`/api/facilities/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (res.ok || res.status === 204) return;
  throw new Error(formatApiError('delete facility', await errorDetail(res)));
}

/** Task 10: one entry from `GET /api/facilities/:id/history` (Task 8's read model over
 *  `audit_events` — apps/server/src/facilities-routes.ts). `before`/`after` are whatever the
 *  writer recorded — a full `FacilityRecord`-shaped object for `facility.create`/`facility.update`/
 *  `facility.import.row`, `null` for the missing half of a create (before) or a delete (after). Not
 *  typed any more precisely than `Record<string, unknown>` — this app mirrors the server's wire
 *  shape rather than sharing a type with it (the same "mirrored, not shared" reasoning `Facility`
 *  itself follows), and the actual key set moves with whatever the writer chose to record. */
export interface FacilityHistoryEntry {
  occurredAt: string;
  /** `null` for a system-authored write (e.g. an import) that never resolved an actor name. */
  actorName: string | null;
  /** One of 'facility.create' / 'facility.update' / 'facility.delete' / 'facility.import.row'.
   *  Not because those are the only actions written with `entityType: 'facility'` — ten distinct
   *  ones are, measured across apps/server, packages/cli and packages/bootstrap — but because the
   *  route also filters `entity_id` to the facility's own id, and only these four ever put a
   *  facility id there (see FacilityHistory.tsx's own comment for the full measurement). Left as
   *  `string`, not a union, for the same "the server is the source of truth for what it wrote"
   *  reasoning as `action` elsewhere in this file (e.g. `RecentPayload`). */
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** `GET /api/facilities/:id/history` (`facilities.view`) — newest first, `{ rows: [] }` for an id
 *  that never had one (including a deleted facility — see the route's own doc comment for why that
 *  is deliberately NOT a 404). */
export const getFacilityHistory = (id: string): Promise<{ rows: FacilityHistoryEntry[] }> =>
  apiGet(`/api/facilities/${encodeURIComponent(id)}/history`, 'get facility history');

// `FacilityAdminLevel` is IMPORTED (above, from `@openldr/db/facility-answers`), not
// hand-duplicated — that subpath is dependency-free (no Kysely/pg; see the comment at the top of
// facility-answers.ts), so importing the type doesn't pull the server DB engine into the web
// bundle the way importing `@openldr/db`'s root would. Re-exported here so this module stays the
// one place the rest of the studio app imports facility API types from.
export type { FacilityAdminLevel };

export interface FacilityAdminValueCount {
  /** The observed value, verbatim (never normalised/cased). */
  value: string;
  /** How many facility_registry rows carry this value for the requested level. */
  count: number;
}

/**
 * Distinct, already-seen values for one admin-area column, ranked by frequency with counts —
 * backs the `suggest` field type's suggestions (Task 1/5). `scope` filters by the OTHER admin
 * columns already chosen on the form (e.g. district suggestions scoped by the region already
 * picked); omit a key (or pass a blank value) for "unfiltered at that level". The server is the
 * actual authority on which `level` values are legal (a closed 4-column whitelist — see
 * facilities-routes.ts) — this function does no validation of its own, it only builds the request.
 */
export const listFacilityAdminValues = (
  level: FacilityAdminLevel,
  scope: Partial<Record<FacilityAdminLevel, string>> = {},
): Promise<FacilityAdminValueCount[]> => {
  const params = new URLSearchParams({ level });
  for (const [key, value] of Object.entries(scope)) {
    if (value) params.set(key, value);
  }
  return apiGet(`/api/facilities/admin-values?${params.toString()}`, 'list facility admin values');
};

// Task 4: CSV import (Settings/Facilities page upload). Mirrors the server's FacilityImportResult
// (packages/bootstrap/src/facility-import.ts) verbatim: every counter is always present,
// `duplicates: 0` on a clean import rather than absent, so a caller can never confuse "0 found"
// with "not reported".
// Task 5: a row whose field count did not match the header's — never mapped to columns (see the
// server's facility-csv.ts `QuarantinedRow`). Defined locally, not imported from
// `@openldr/terminology`: this app has no dependency on that package (see `FacilityImportResult`'s
// own doc comment above — the same "mirrored, not shared" reasoning as the rest of this interface).
export interface FacilityImportQuarantinedRow {
  line: number;
  /** The row exactly as it appeared in the operator's file, so they can find and fix it there. */
  raw: string;
  /** Widened to the full `QuarantinedRow['reason']` union (facility-csv.ts) — the CSV-only reasons
   *  (`too_few_fields`/`too_many_fields`) plus the JSONL-release ones a `format: 'jsonl'` request can
   *  also produce (`FacilityImportRequest.format` below). This sheet only ever renders the line/raw
   *  text, never branches on which reason it is, so accepting the wider union costs nothing here. */
  reason: 'too_few_fields' | 'too_many_fields' | 'malformed_json' | 'unknown_record_type' | 'duplicate_meta';
}

/** Mirrors the server's `RowError` (packages/terminology/src/facility-csv.ts): a coordinate the
 *  parser could not accept. One entry PER FIELD, not per row — see `FacilityImportResult.invalid`. */
export interface FacilityImportRowError {
  line: number;
  field: 'latitude' | 'longitude';
  reason: 'not_a_number' | 'out_of_range' | 'incomplete_pair';
  raw: string;
}

/** One row of a per-bucket reconciliation sample, identifying the facility without shipping the
 *  whole record — mirrors the server's `FacilitySample` (facility-import.ts). */
export interface FacilitySample {
  id: string;
  nationalCode: string | null;
  name: string;
}

/** A `changed` sample additionally carries which fields differ — mirrors the server's
 *  `FacilityChangeSample`. Only fields that actually differ appear here. */
export interface FacilityChangeSample extends FacilitySample {
  diff: { field: string; before: unknown; after: unknown }[];
}

// Task 7 (known gap closed): this used to stop at 'duplicate-columns' | 'quarantined-rows', which
// predates the column-map work — the server's own `FacilityImportBlockedReason`
// (packages/bootstrap/src/facility-import.ts) gained 'column-map' in Task 3. A hand-mirrored type
// like this one does not fail typecheck when the server adds a value; it only reads wrong at
// runtime, which is exactly the class of drift this mirror exists to avoid.
export type FacilityImportBlockedReason = 'duplicate-columns' | 'column-map' | 'quarantined-rows' | null;

/** Mirrors the server's `FacilityReleaseMeta` (packages/terminology/src/facility-release.ts) — a
 *  JSONL release's own header line, verbatim. Always `null` on `FacilityImportResult.meta` for a
 *  plain CSV import, which has no release header at all. */
export interface FacilityReleaseMeta {
  country: string | null;
  version: string | null;
  publishedAt: string | null;
  rowCount: number | null;
  deletionCount: number | null;
}

/** Mirrors the server's `ControlledField` (packages/bootstrap/src/facility-controlled-fields.ts) —
 *  the three facility columns rewritten to a canonical code via `term_mappings` on import. */
export type ControlledField = 'level' | 'status' | 'country';

// Task 7: mirrors the server's `ColumnMapError`/`ColumnMapErrorReason`/`FacilityColumnMap`
// (packages/terminology/src/facility-csv.ts) — "mirrored, not shared", same reasoning as
// `FacilityImportResult` below (this app has no dependency on that package).
export type ColumnMapErrorReason =
  | 'duplicate_target' | 'constant_collision' | 'unknown_target' | 'missing_required';

/** One problem with a `FacilityColumnMap`, reported so an operator can fix it without a second
 *  round trip — `validateColumnMap` (server-side) always returns every problem, never just the
 *  first. */
export interface ColumnMapError {
  reason: ColumnMapErrorReason;
  /** The header (or, for a constant/required error, the field) the problem is about, spelled as
   *  the operator wrote it. */
  subject: string;
  /** The contract field involved. */
  target: string;
  /** The other header/field, when the problem is a collision between two things. */
  other?: string;
}

/** How a file's own headers map onto the 16-field import contract. `columns` keys are headers AS
 *  THEY APPEAR IN THE FILE — the operator matches what they see, not a lowercased copy. */
export interface FacilityColumnMap {
  /** file header -> contract field */
  columns: Record<string, string>;
  /** contract field -> literal value written on every row (e.g. `country: 'ZMB'`) */
  constants?: Record<string, string>;
  /** file headers deliberately carried into `extras` rather than mapped */
  extras?: string[];
}

// A2a (FAC-P1-03/05, whole-branch review): this interface used to stop at `created`/`updated` —
// flat counts a dry-run preview reported as `0` before this task, which read as "nothing to do"
// rather than "not computed". It now mirrors the server's FacilityImportResult FIELD FOR FIELD
// (facility-import.ts) — see that file's own docblock on each field for the reasoning; this comment
// only records the ONE thing worth restating here: `conflict`/`absent` are `number | null`, and
// `null` means NOT EVALUATED. Rendering `null` as `0` anywhere in this app is exactly the defect
// this task exists to remove — see ImportFacilitiesSheet.tsx's rendering of these two fields.
export interface FacilityImportResult {
  parsed: number;
  skipped: number;
  unknownColumns: string[];
  /** Headers appearing more than once — see the server's `FacilityCsvResult.duplicateColumns`.
   *  Non-empty ⇒ apply is always blocked; there is no override (unlike `quarantined` below). */
  duplicateColumns: string[];
  /** Problems with the column map itself (Task 1's `validateColumnMap`), ALL of them, so one fix
   *  pass repairs the file. Non-empty ⇒ nothing imported, same reasoning as `duplicateColumns`
   *  above — `blockedReason` reads `'column-map'` whenever this is non-empty. Always `[]` when the
   *  request carried no `columnMap` at all. */
  columnMapErrors: ColumnMapError[];
  /** Structurally malformed rows, never mapped to columns — see `FacilityImportQuarantinedRow`.
   *  Non-empty ⇒ apply is blocked unless the caller sets `allowMalformedRows`. */
  quarantined: FacilityImportQuarantinedRow[];
  /** Per-field coordinate errors (facility-csv.ts's `RowError`). CT-3: rendered by
   *  ImportFacilitiesSheet.tsx with line numbers, alongside the `allowInvalidCoordinates` override —
   *  the same idiom as `unknownColumns`/`quarantined` above. */
  invalid: FacilityImportRowError[];
  duplicates: number;
  /** Whether the server refused to apply this file — the server's OWN answer, mirrored from
   *  `@openldr/bootstrap`'s `FacilityImportResult.blocked`. Read it; do not rebuild the predicate
   *  out of `duplicateColumns`/`quarantined` here (that is exactly what this field exists to stop). */
  blocked: boolean;
  /** Which of the two block reasons applied, or null when `blocked` is false. `'duplicate-columns'`
   *  has NO override; `'quarantined-rows'` is released by `allowMalformedRows`. */
  blockedReason: FacilityImportBlockedReason;

  // ── What this file would DO to the registry — computed on every call, preview and apply alike
  //    (facility-import.ts's `classifyFacilityRows`). See that file's docblock for the full story. ──
  /** Rows with no existing registry row for their id. */
  create: number;
  /** Existing rows at least one compared field of which differs from what this import would write. */
  changed: number;
  /** Existing rows this import would write nothing new to. */
  unchanged: number;
  /** Existing rows touched since the preview watermark. `null` means NOT EVALUATED — no `runId`
   *  linked this call to a prior preview — never "none". */
  conflict: number | null;
  /** Registry rows for this `nationalSystem` the file does not mention. `null` means NOT
   *  EVALUATED — the caller never declared `completeRelease` — never "none". */
  absent: number | null;
  /** Rows the publisher explicitly declared removed (JSONL only) AND that matched a row this
   *  registry actually holds. Always 0 for a plain CSV import. */
  deleted: number;

  /** Bounded per-bucket samples so an operator can see WHICH rows a count refers to. */
  samples: {
    create: FacilitySample[];
    changed: FacilityChangeSample[];
    conflict: FacilitySample[];
    absent: FacilitySample[];
    deleted: FacilitySample[];
  };

  /** What was actually WRITTEN, as opposed to what was classified above — all three 0 on a preview.
   *  ⛔ NESTED deliberately: `result.create` (classified) vs `result.written.created` (written) are
   *  easy to confuse if they sit at the same level — see facility-import.ts's docblock. Always read
   *  `written.created`/`written.updated`, never a flat `created`/`updated` (removed from this
   *  interface — the server no longer sends them at the top level).
   *
   *  `retired` is how many registry rows this apply actually flipped to `'inactive'` — the MUTATION,
   *  as distinct from `deleted`/`absent` above, which are what the file DESCRIBES. The two differ
   *  whenever policy says so: `onAbsent: 'report'` (the default) reports a non-zero `absent` and
   *  retires none of it. */
  written: { created: number; updated: number; retired: number };
  /** Echoes `FacilityImportRequest.runId` — null when the request carried none. An APPLY that wants
   *  `conflict` evaluated must send back the `runId` a prior PREVIEW returned here. */
  runId: string | null;
  /** False when this `nationalSystem` matches no existing registry row — i.e. this import creates a
   *  NEW register identity. Informational only; never blocks anything. */
  knownNationalSystem: boolean;

  // ── The release header, and what it declares (FAC-P1-03) — mirrors facility-import.ts. ──────────
  /** A JSONL release's `meta` line, verbatim. Always `null` for CSV, which has no release header. */
  meta: FacilityReleaseMeta | null;
  /** Where `meta`'s declared counts disagree with what was actually parsed — e.g. "the release
   *  declares 13 000 rows, we parsed 12 998". Reported, never fatal. Always `[]` for CSV. */
  countMismatch: { field: 'rowCount' | 'deletionCount'; declared: number; parsed: number }[];
  /** `FacilityImportRequest.releaseVersion` when the caller supplied one, otherwise the release's
   *  own `meta.version`, otherwise null. Provenance only. */
  releaseVersion: string | null;

  // ── Controlled fields (FAC-P1-05) — mirrors facility-import.ts. ──────────────────────────────────
  /** Per controlled field (`level`/`status`/`country`), the distinct raw source values that resolved
   *  to no canonical code. A warning, never a block — the raw value is still written as-is. */
  unmapped: Record<ControlledField, string[]>;
  /** Controlled fields whose canonical value set is not seeded on this install (or `deps.admin` was
   *  omitted server-side), so no value of theirs could be classified mapped/unmapped at all. */
  notValidated: ControlledField[];
}

// B1 Task 9: the picklist `ImportFacilitiesSheet`'s national-system `Select` renders — the ONLY
// spellings `POST /api/facilities/import` (and /import/upload) will accept from this point on (see
// `@openldr/db`'s `resolveFacilityRegisterForImport`). Mirrors `@openldr/db`'s `FacilityRegisterSource`
// field-for-field, same "mirrored, not shared" reasoning as `FacilityImportResult` above (this app
// has no dependency on `@openldr/db`).
export interface FacilityRegisterSource {
  id: string;
  /** The canonical URI — what the sheet actually SENDS as `nationalSystem`. Never the display
   *  `name` below; sending that would re-open the exact fork this slice exists to close (see
   *  ImportFacilitiesSheet.tsx's own comment on its Select). */
  url: string;
  name: string;
  code: string;
  version: string | null;
  jurisdiction: string | null;
  contact: string | null;
  publisherId: string | null;
  active: boolean;
}

/** The body `POST /api/facilities/import/sources` takes — the CREATE input, not the list shape
 *  above. `url` is the canonical URI the register will forever be known by (it is what every future
 *  import sends as `nationalSystem` and what `idFor` hashes into each facility's permanent id), so
 *  it is the one field here that can never be corrected later. `active` is absent deliberately: the
 *  route always creates an active register — see `createFacilityImportSource` below. */
export interface FacilityRegisterSourceInput {
  url: string;
  name: string;
  code: string;
  version?: string | null;
  jurisdiction?: string | null;
  contact?: string | null;
  publisherId?: string | null;
}

/** `GET /api/facilities/import/sources` — active registers only (the route's own default), ordered
 *  by name. Excludes an INACTIVE register — the picklist must never offer a spelling the import
 *  routes would then refuse. `createFacilityImportSource` below always writes a fresh row with
 *  `active: true` (mirroring `FacilityRegisterSourceStore.create`'s own hardcoded `active: true`),
 *  and this slice adds no route that can flip it back to `false` — so today the only way a row is
 *  ever excluded here is a register created before this app existed at all (a pre-existing
 *  `coding_systems` row this slice never touches) or a direct database edit, not anything this
 *  app's own UI can cause. */
export const listFacilityImportSources = (): Promise<FacilityRegisterSource[]> =>
  apiGet<{ rows: FacilityRegisterSource[] }>('/api/facilities/import/sources', 'list facility import sources')
    .then((r) => r.rows);

// ── Task 7: offline column-mapping suggestions (Task 4's route, Task 2's engine) ────────────────

/** Mirrors the server's `ColumnSuggestion` (packages/bootstrap/src/facility-mapping-suggest.ts). */
export interface ColumnSuggestion {
  /** The header exactly as it appears in the file. */
  header: string;
  /** Best first. EMPTY when the engine deliberately declined to guess — never render that as a
   *  failure, see that file's own docblock. */
  candidates: {
    target: string;
    display: string | null;
    score: number;
    confidence: 'exact' | 'likely' | 'weak';
  }[];
}

/** `POST /api/facilities/import/suggest-map` — only the file's first line is sent server-side to a
 *  pure, offline ranking function; nothing here writes anything. */
export const suggestColumnMap = (csv: string): Promise<{ headers: string[]; columns: ColumnSuggestion[] }> =>
  authFetch('/api/facilities/import/suggest-map', jbody({ csv }, 'POST'))
    .then((r) => okJson<{ headers: string[]; columns: ColumnSuggestion[] }>(r, 'suggest column map'));

// ── Task 8: value-mapping suggestions and writes (Task 4's route/Task 2's engine; Task 6's route) ──

/** Mirrors the server's `ValueSuggestion` (packages/bootstrap/src/facility-mapping-suggest.ts) — the
 *  same `Suggestion` candidate shape `ColumnSuggestion` above uses, but ranked against one
 *  controlled field's bound value set rather than the 16 contract fields. */
export interface ValueSuggestion {
  /** The raw source value exactly as it appears in the file. */
  value: string;
  /** Best first. EMPTY when the engine deliberately declined to guess — same meaning as
   *  `ColumnSuggestion.candidates`, never render an empty list as a failure. */
  candidates: {
    /** A code from the field's bound value set. */
    target: string;
    display: string | null;
    score: number;
    confidence: 'exact' | 'likely' | 'weak';
  }[];
}

/** `POST /api/facilities/import/suggest-values` — ranked candidates for one controlled field's
 *  unmapped raw values, drawn from that field's own bound value set expansion.
 *
 *  `notValidated` mirrors what it means on `FacilityImportResult.notValidated` for this one field:
 *  the value set is not seeded on this install, so nothing exists to rank against at all — every
 *  entry in `values` comes back with `candidates: []`, and that emptiness must be read as "could not
 *  be checked", never as "the engine tried and found nothing" (see `ColumnSuggestion`'s own note). */
export const suggestValueMappings = (
  field: ControlledField, values: string[],
): Promise<{ values: ValueSuggestion[]; notValidated: boolean }> =>
  authFetch('/api/facilities/import/suggest-values', jbody({ field, values }, 'POST'))
    .then((r) => okJson<{ values: ValueSuggestion[]; notValidated: boolean }>(r, 'suggest value mappings'));

/** Mirrors the server's `ValueMappingEntry` (packages/bootstrap/src/facility-value-mappings.ts) — one
 *  raw-string -> canonical-code decision. */
export interface ValueMappingEntry {
  field: ControlledField;
  /** The source value exactly as the parser produced it. `resolveControlledFields` looks it up by
   *  exact string, so a differently-spaced copy would never resolve. */
  rawValue: string;
  /** A code from the field's bound value set. */
  toCode: string;
}

/** `POST /api/facilities/import/value-mappings` — `ValueMapPanel`'s Save action. Validates every
 *  entry against its field's value set BEFORE writing any of them; refuses with 400 (writing
 *  nothing) on the first `toCode` that is not in that set. `written`/`superseded` mirror the server's
 *  `SaveValueMappingsResult` (facility-value-mappings.ts) — `superseded` lists the mapping ids
 *  deactivated because they were the previous active mapping for the same raw value. */
export const writeFacilityValueMappings = (
  nationalSystem: string, mappings: ValueMappingEntry[],
): Promise<{ written: number; superseded: string[] }> =>
  authFetch('/api/facilities/import/value-mappings', jbody({ nationalSystem, mappings }, 'POST'))
    .then((r) => okJson<{ written: number; superseded: string[] }>(r, 'write facility value mappings'));

/** `POST /api/facilities/import/sources` — the ONLY way a fresh install ever gets a register the
 *  import sheet's `Select` can offer (review fix, B1 Task 9: the route existed and was tested, but
 *  nothing in the studio ever called it, so a fresh install's picklist was permanently empty and
 *  facility import was unreachable from the UI). Backs the ⋯ menu's "Register a source" item
 *  (`RegisterSourceDialog.tsx`), never a standalone button — see ui-actions-in-dots-menu. */
export const createFacilityImportSource = (input: FacilityRegisterSourceInput): Promise<FacilityRegisterSource> =>
  authFetch('/api/facilities/import/sources', jbody(input, 'POST'))
    .then((r) => okJson<FacilityRegisterSource>(r, 'register a facility source'));

export interface FacilityImportRequest {
  csv: string;
  /** Which national register these codes belong to (HFR/MFL/etc). Required — the server never
   *  defaults this to a hardcoded register (see facilities-routes.ts). */
  nationalSystem: string;
  /** Import despite unrecognised columns, carrying them into each row's extras. */
  allowUnknownColumns?: boolean;
  /** Task 5: import despite structurally malformed (quarantined) rows — the explicit "I have seen
   *  the line numbers, import the rest" override, mirroring `allowUnknownColumns` above. There is
   *  no equivalent override for duplicate headers (see `FacilityImportResult.duplicateColumns`). */
  allowMalformedRows?: boolean;
  /** The caller opts IN to writing. Omitted/false ⇒ dry run: parse and report, write NOTHING. */
  apply?: boolean;
  /** A2a: links this call to the run a PRIOR standalone preview created (`FacilityImportResult.runId`
   *  echoed back on that preview's response). Omit on the preview call itself — the server mints the
   *  run then. An APPLY sent WITHOUT the linked `runId` reports `conflict: null` (not evaluated) —
   *  see the server route's own comment on why it never invents one on the caller's behalf. */
  runId?: string;
  /** Which shape `csv` is. Default `'csv'`. CT-3 (whole-branch review): the sheet now offers a
   *  CSV/JSONL format Select (ImportFacilitiesSheet.tsx) and sends this on every preview AND apply —
   *  it used to be mirrored-for-completeness only, never actually set by this app, which is exactly
   *  what made `completeRelease`/`onAbsent` below structurally unreachable from the browser. */
  format?: 'csv' | 'jsonl';
  /** Declares `csv` a COMPLETE release of this register — only then can a row's absence from it mean
   *  anything (`FacilityImportResult.absent`). CT-3: the sheet now offers a "this file is a complete
   *  release" checkbox and sends this on every preview AND apply, so `absent` is populated whenever
   *  the operator actually declares one. */
  completeRelease?: boolean;
  /** What to do with rows this file explicitly declared removed (JSONL only). */
  onDeleted?: 'retire' | 'report';
  /** What to do with rows merely absent from a complete release. */
  onAbsent?: 'retire' | 'report';
  /** What to do with a row the server classified `conflict` — touched by someone else between the
   *  preview this apply's `runId` points at and this apply itself. Default `'skip'`.
   *
   *  ⛔ A fresh PREVIEW's own `conflict` is ALWAYS `null` — `previewedAt` is only ever set from a
   *  PRIOR preview's watermark (see `runId` above), and a standalone preview has none to compare
   *  against. Gating this control on "`conflict` is a non-zero number" (the shape this comment used
   *  to describe) could therefore never actually show it: that number never arrives until AFTER an
   *  apply has already run. The sheet instead offers the `onConflict` select whenever a preview has
   *  minted a `runId` at all — the operator picks skip/overwrite BEFORE applying, since only the
   *  apply itself (carrying that `runId`) can discover whether a conflict exists (see
   *  ImportFacilitiesSheet.tsx's `onConflict` select, shown beside the `onDeleted`/`onAbsent` ones,
   *  and the apply-result rendering of `FacilityImportResult.conflict`/`samples.conflict`). */
  onConflict?: 'skip' | 'overwrite';
  /** Recorded on the run for its own history; never read by `importFacilities` itself. The sheet's
   *  optional "release version" input (ImportFacilitiesSheet.tsx) feeds this. */
  releaseVersion?: string;
  /** CT-3 (whole-branch review): the third member of the `allowUnknownColumns`/`allowMalformedRows`
   *  override family — see `@openldr/bootstrap`'s `FacilityImportOptions.allowInvalidCoordinates` for
   *  why a row failing coordinate validation is otherwise dropped from the parse entirely. Unlike
   *  `allowMalformedRows`, toggling this DOES re-run the preview (mirroring `allowUnknownColumns`):
   *  it changes which rows land in `records` and therefore `create`/`changed`/`unchanged`, not merely
   *  whether Apply is allowed to proceed. */
  allowInvalidCoordinates?: boolean;
  /** Task 8: how this file's own headers map onto the 16-field contract (`ColumnMapStep.tsx`) —
   *  CSV only, per `FacilityColumnMap`'s own doc comment; a JSONL release is already in the
   *  contract's shape and the parser ignores this for one rather than erroring. Sent on every
   *  preview AND every apply, same discipline `format`/`completeRelease` already follow: a preview
   *  and an apply that parse the file differently is a bug this sheet has learned before (see
   *  `ImportFacilitiesSheet.tsx`'s own comment on `format`). Omitted rather than sent empty when the
   *  operator has not actually mapped, constant-filled or extra'd anything yet — an empty-but-present
   *  map would still trip `missing_required` for `national_code`/`name` the moment the server honours
   *  this field, which is a decision nobody made. */
  columnMap?: FacilityColumnMap;
}

export const importFacilitiesCsv = (body: FacilityImportRequest): Promise<FacilityImportResult> =>
  authFetch('/api/facilities/import', jbody(body, 'POST')).then((r) => okJson<FacilityImportResult>(r, 'import facilities'));

// ── A2b: the BACKGROUND import (upload → validate → confirm → apply) ──────────────────────────────
//
// The second door into the same importer. `importFacilitiesCsv` above carries the register in a JSON
// body and does the whole job inside one HTTP request, which is why the server bounds it (8 MB, and
// 2 000 rows for an apply). This path streams the file to blob storage, mints a run row, and lets a
// worker do the work — so a national register is not bounded by a request deadline at all.

/** Mirrors `@openldr/db`'s `FacilityImportRunStatus` (packages/db/src/facility-import-run-states.ts)
 *  — the whole lifecycle, `previewed` included. `previewed` is the INLINE path's own state and an
 *  uploaded run never enters it; it is listed because `GET /api/facilities/import/runs/:id` answers
 *  for both kinds of run. */
export type FacilityImportRunStatus =
  | 'queued' | 'validating' | 'awaiting_confirmation' | 'confirmed' | 'applying'
  | 'previewed' | 'applied' | 'failed' | 'cancelled';

/** One `facility_import_runs` row as `GET /api/facilities/import/runs/:id` returns it — mirrors the
 *  server's `FacilityImportRun` field for field, the same "mirrored, not shared" reasoning as
 *  `FacilityImportResult` above (this app has no dependency on `@openldr/db`).
 *
 *  ⚠ `summary` is typed `unknown` server-side, and both writers put a `FacilityImportResult` there:
 *  the validate phase stores `importFacilities`' dry-run result, the apply phase stores its applied
 *  one (see packages/bootstrap/src/facility-import-worker.ts's `completeValidation`/`finish` calls).
 *  It is `null` on a run that has not reached either point, and on a `failed`/`cancelled` run.
 *
 *  ⚠ `total` stays null until a worker knows one, and the apply worker publishes counts ONLY for a
 *  register of at least 5 000 rows (its measured `PER_ROW_PROGRESS_MIN_ROWS`). For most runs there
 *  is no denominator at all — `phase` is the field that is always there. */
export interface FacilityImportRunView {
  id: string;
  nationalSystem: string;
  sourceFormat: 'csv' | 'jsonl';
  /** Where the uploaded file lives; null for an inline preview, which stores nothing. */
  blobKey: string | null;
  fileHash: string;
  byteSize: number;
  releaseVersion: string | null;
  releasePublishedAt: string | null;
  declaredRowCount: number | null;
  declaredDeletionCount: number | null;
  status: FacilityImportRunStatus;
  /** Free text the worker chooses ('validating', 'applying', …) — not a translated token. */
  phase: string | null;
  processed: number;
  total: number | null;
  previewedAt: string | null;
  summary: FacilityImportResult | null;
  options: Record<string, unknown> | null;
  error: string | null;
  /** The operator asked for a cancel. By itself this stops NOTHING — a worker observes it at its
   *  next phase boundary and cannot interrupt a running transaction. */
  cancelRequested: boolean;
  requestedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Stream a register file to `POST /api/facilities/import/upload` and get back the run it minted.
 *
 *  ⛔ THE FILE IS THE REQUEST BODY — never `await file.text()` and never a JSON envelope. A national
 *  register is tens of megabytes; reading it into a string to POST it puts the whole thing in the
 *  tab's memory, which is exactly what this path exists to avoid. The parameters ride the query
 *  string for that reason (the same shape `uploadTerminologyDistribution` above uses).
 *
 *  XHR rather than `fetch` for the one thing fetch cannot do: upload progress.
 *
 *  ⚠ Deliberately UNLIKE `uploadTerminologyDistribution`, which resolves `{ jobId: '' }` when it
 *  cannot parse a 2xx body — a caller then polls a job id that does not exist and sees nothing. A
 *  2xx with no usable run id is a failure here and is reported as one.
 *
 *  `onProgress` is called with a fraction in [0, 1] while the browser can measure the transfer, and
 *  with `null` when it cannot (`ProgressEvent.lengthComputable` false — no `Content-Length` the
 *  browser will admit to). ⛔ `null` is NOT `0`: a caller that collapsed the two would sit on
 *  "Uploading… 0%" for the whole of a 64 MiB transfer, which is a measurement nobody took rendered
 *  as one that was. */
export function uploadFacilityImport(
  p: {
    file: File; nationalSystem: string; format: 'csv' | 'jsonl'; releaseVersion?: string | null;
    /** Declares the file a COMPLETE release of this register — see `FacilityImportRequest.
     *  completeRelease`. Sent on the query string and stored in the run's `options`, where the
     *  worker's validate spreads it into `importFacilities`; without it a background run reports
     *  `absent: null` (NOT EVALUATED) whatever the file actually is. */
    completeRelease?: boolean;
    /** The two overrides that change how the file PARSES, and they belong to the UPLOAD for the same
     *  reason `completeRelease` does: the worker's validate is what turns records into the summary an
     *  operator reads, so a flag arriving at CONFIRM time would make the apply classify a different
     *  record set than the one that was approved — which the confirm route refuses outright (see its
     *  parse-override gate). Sending them here is the only way the browser can ever apply a register
     *  that needs one. `allowMalformedRows` is deliberately NOT here: it changes only the `blocked`
     *  verdict, never the parse, so it stays the confirm's. */
    allowUnknownColumns?: boolean;
    allowInvalidCoordinates?: boolean;
    /** Task 8b: how this file's own headers map onto the 16-field contract — the SAME parse-changing
     *  family as the two flags above, and belongs here for the identical reason: the route reads it
     *  off the query string, JSON-encoded (`facilities-routes.ts`'s `columnMapRaw`/`ColumnMapSchema`),
     *  and stores it on the run's `options` before validate ever runs. Sent only when the caller has
     *  a real map to send — `ImportFacilitiesSheet.tsx`'s `hasColumnMapContent` decides that, the same
     *  guard `confirmOptionsFor` already applies to the inline door's own `columnMap`. */
    columnMap?: FacilityColumnMap;
  },
  onProgress?: (fraction: number | null) => void,
): Promise<{ runId: string }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ nationalSystem: p.nationalSystem, format: p.format });
    if (p.releaseVersion) params.set('releaseVersion', p.releaseVersion);
    // Sent only when the operator actually declared one. The route reads this parameter
    // three-valued (`ownBoolean`, facilities-routes.ts) and leaves the key out of the run's stored
    // `options` entirely when it is absent — so an undeclared release records no declaration at all
    // rather than a `false` nobody chose.
    if (p.completeRelease) params.set('completeRelease', 'true');
    // Same three-valued idiom, same reason: an override nobody asked for must leave no key in the
    // run's stored `options` at all, because that record is what the confirm gate later compares
    // against — a `false` written there is a decision nobody made.
    if (p.allowUnknownColumns) params.set('allowUnknownColumns', 'true');
    if (p.allowInvalidCoordinates) params.set('allowInvalidCoordinates', 'true');
    // JSON-encoded, matching `columnMapRaw`'s `JSON.parse` on the server. Omitted entirely when the
    // caller has no map — an empty object is not the same as no map (see `hasColumnMapContent`).
    if (p.columnMap) params.set('columnMap', JSON.stringify(p.columnMap));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/facilities/import/upload?${params.toString()}`);
    // Both are accepted by the route's passthrough parser; naming the real one keeps the stored
    // object's content type honest for anyone who later reads it out of the bucket.
    xhr.setRequestHeader('content-type', p.format === 'csv' ? 'text/csv' : 'application/octet-stream');
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // `null` when the browser cannot measure the transfer — see this function's doc comment. The
    // caller renders an indeterminate "Uploading…" for that, never a frozen 0%.
    xhr.upload.onprogress = (e) => { onProgress?.(e.lengthComputable ? e.loaded / e.total : null); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { runId?: unknown };
          if (typeof body.runId === 'string' && body.runId !== '') { resolve({ runId: body.runId }); return; }
        } catch { /* fall through to the rejection below */ }
        reject(new Error('the upload was accepted but no import run id came back'));
        return;
      }
      // The server's own message where there is one — the 413 body ("…exceeds the N-byte upload
      // limit") is what the sheet turns into plain language.
      let msg = `upload failed (${xhr.status})`;
      try {
        const j = JSON.parse(xhr.responseText) as { error?: unknown };
        if (typeof j?.error === 'string' && j.error !== '') msg = j.error;
      } catch { /* keep the status-code fallback */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.send(p.file);
  });
}

export const getFacilityImportRun = (id: string): Promise<FacilityImportRunView> =>
  apiGet(`/api/facilities/import/runs/${encodeURIComponent(id)}`, 'get facility import run');

/** The operator's decision, as `POST /api/facilities/import/runs/:id/confirm` takes it.
 *
 *  ⛔ EVERY FIELD IS OPTIONAL AND STAYS OPTIONAL. The server records only the keys the request
 *  actually carried, precisely so a choice nobody made is never stored as though they had — see that
 *  route's own note. `importFacilities` defaults each of them anyway. */
export interface FacilityImportConfirmOptions {
  onDeleted?: 'retire' | 'report';
  onAbsent?: 'retire' | 'report';
  onConflict?: 'skip' | 'overwrite';
  allowUnknownColumns?: boolean;
  allowMalformedRows?: boolean;
  allowInvalidCoordinates?: boolean;
  /** Task 8: the same map the INLINE door's own VALIDATE parsed the file with
   *  (`ImportFacilitiesSheet.tsx`'s `confirmOptionsFor`) — sent for the reason `allowMalformedRows`
   *  above is: a confirmed apply that re-parses the file without the map it was validated with would
   *  read raw headers instead and refuse the file (`missing_required`), the same class of bug the
   *  file's own comment on `allowMalformedRows` documents.
   *
   *  ⚠ The server's confirm route (`ConfirmSchema`) has no `columnMap` key, deliberately — see that
   *  route's own comment: a map arriving at confirm time would let an apply authorise a record set the
   *  operator never reviewed. `confirmOptionsFor` still sends this key on a background run's confirm
   *  (`ImportFacilitiesSheet.tsx`'s `handleConfirmRun`), but zod strips what it does not know, so it
   *  reaches the server and is silently dropped there — inert, not refused with an error. The map that
   *  actually governs a background run's validate travels on `uploadFacilityImport`'s own `columnMap`
   *  query parameter instead, stored on the run's `options` before validate ever runs — Task 8b closed
   *  that gap for the door that needed it. */
  columnMap?: FacilityColumnMap;
}

/** 202 — the register has NOT been imported when this resolves; a worker will do that. */
export const confirmFacilityImportRun = (
  id: string, options: FacilityImportConfirmOptions,
): Promise<{ runId: string; status: FacilityImportRunStatus }> =>
  authFetch(`/api/facilities/import/runs/${encodeURIComponent(id)}/confirm`, jbody(options, 'POST'))
    .then((r) => okJson<{ runId: string; status: FacilityImportRunStatus }>(r, 'confirm facility import'));

/** Ask a run to stop. ⛔ THE TWO OUTCOMES ARE NOT THE SAME ANSWER and a caller must not blur them:
 *
 *  - `'cancelled'` (HTTP 200) — the run was in a state no worker claims, so the server carried the
 *    cancellation out itself. It really is cancelled and its register is released.
 *  - `'requested'` (HTTP 202) — a worker holds the run. The flag is observed only at phase boundaries
 *    and CANNOT interrupt the running transaction, so the import may still finish `applied`.
 *
 *  The outcome is read off the body rather than the status code because both are 2xx and `okJson`
 *  does not expose which one arrived. */
export const cancelFacilityImportRun = (
  id: string,
): Promise<{ runId: string; outcome: 'cancelled' | 'requested' }> =>
  authFetch(`/api/facilities/import/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
    .then((r) => okJson<{ runId: string; outcome: 'cancelled' | 'requested' }>(r, 'cancel facility import'));

// Task 9: observed-facility reconciliation (the Observed tab). Mirrors the server's
// `ResolvedFacility` (packages/bootstrap/src/facility-reconcile.ts) 1:1 — `reportCount` is a field
// on `ResolvedFacility` itself (Task 11, whole-branch review round 2: `resolveObservedFacilities`
// sums it while folding raw groups, so the route no longer runs a second query to join it in). See
// facilities-routes.ts's GET /api/facilities/observed. Already ordered by `reportCount` descending
// server-side; this client does not re-sort.
export interface ObservedFacility {
  /** `diagnostic_reports.source_system` — the ingestion feed, e.g. `webhook-ingest`. Unrelated to
   *  the coding system mappings are authored against (see `resolvedVia` below). */
  sourceSystem: string;
  /** The performer string EXACTLY as it arrived. Never normalised. */
  sourceCode: string;
  /** `DiagnosticReport.performer[0].display` as observed on the wire (e.g. "Aga Khan") — the human
   *  name for `sourceCode`, distinct from `name` below (the RESOLVED registry facility's name).
   *  Null when the source never supplied one. */
  sourceDisplay: string | null;
  /** `facilities.region`/`facilities.district` (`Organization.address[0].state`/`.district`) for
   *  `sourceCode`, WITHIN `sourceSystem` — location CE already knows about the OBSERVED facility
   *  itself, independent of any curated registry mapping. Lets an operator tell apart DISA's five
   *  facility codes sharing the display "Aga Khan" by district BEFORE mapping any of them. Null
   *  when `facilities` holds no matching row (the common case — most codes arrive with no
   *  `Organization` alongside them) or that row's own address omitted the part. */
  sourceRegion: string | null;
  sourceDistrict: string | null;
  reportCount: number;
  registryId: string | null;
  /** `facility_registry.facility_code` of the resolved row. Disambiguates similarly-named facilities
   *  (e.g. "Dodoma Regional Referral" vs "Dodoma Zonal Lab"). */
  facilityCode: string | null;
  name: string | null;
  level: string | null;
  status: string | null;
  region: string | null;
  district: string | null;
  council: string | null;
  nationalSystem: string | null;
  nationalCode: string | null;
  resolvedVia: 'registry' | 'national' | null;
  /** A GENUINE facility-route mapping (registry, or a proven national register) was authored but
   *  resolves to no live registry row. ⛔ Means exactly this one thing — never true for
   *  `nonFacilityTarget` below (self-mapping report, Fix 1). */
  targetMissing: boolean;
  /** A mapping exists, but its target SYSTEM is not a facility register at all (a self-mapping to
   *  the observed system itself, or an unrelated active system such as LOINC/ICD-10/UCUM). Distinct
   *  from `targetMissing` (a genuine facility-register mapping whose CODE doesn't resolve) and from
   *  "never mapped". See `ResolvedFacility.nonFacilityTarget` in
   *  packages/bootstrap/src/facility-reconcile.ts for the bug this split fixes. */
  nonFacilityTarget: boolean;
  /** Task 10: ACTIVE `SAME-AS` mappings on this code name more than one DISTINCT facility, so
   *  NOTHING resolves — the resolver never picks an arbitrary winner. Duplicate mappings naming the
   *  SAME facility are not a conflict and resolve normally. Mutually exclusive with `resolvedVia`,
   *  and never set alongside `targetMissing`/`nonFacilityTarget`. See `ResolvedFacility.ambiguous`
   *  in packages/bootstrap/src/facility-reconcile.ts. */
  ambiguous: boolean;
}

export const listObservedFacilities = (): Promise<ObservedFacility[]> =>
  apiGet('/api/facilities/observed', 'list observed facilities');

// Mirrors the server's ScanResult/PublishResult (packages/bootstrap/src/facility-reconcile.ts).
// `apply` is opt-in on both — omitted/false is a dry run that writes nothing. Task 9b dropped
// `system` — scan/publish now cover every ingest feed's own coding system in one call.
export interface ScanObservedRequest { apply?: boolean }
export interface ScanObservedResult { discovered: number; created: number; updated: number; systemRegistered: boolean }
export const scanObservedFacilities = (body: ScanObservedRequest = {}): Promise<ScanObservedResult> =>
  authFetch('/api/facilities/scan-observed', jbody(body, 'POST')).then((r) => okJson<ScanObservedResult>(r, 'scan observed facilities'));

export interface PublishFacilitiesRequest { apply?: boolean }
export interface PublishFacilitiesResult {
  resolved: number; unmapped: number; targetMissing: number;
  /** Fix 1: rows filed under `ResolvedFacility.nonFacilityTarget` — counted separately so
   *  `unmapped` never silently absorbs them. */
  nonFacilityTarget: number;
  /** Task 10: rows filed under `ResolvedFacility.ambiguous` — competing active SAME-AS mappings, so
   *  nothing resolved. Counted separately for the same reason as `nonFacilityTarget`. */
  ambiguous: number;
  written: number;
}
export const publishFacilities = (body: PublishFacilitiesRequest = {}): Promise<PublishFacilitiesResult> =>
  authFetch('/api/facilities/publish', jbody(body, 'POST')).then((r) => okJson<PublishFacilitiesResult>(r, 'publish facilities'));

// Task 11: what the Facilities chip reads. Mirrors the server's FacilityHealth
// (packages/bootstrap/src/facility-health.ts) 1:1, as returned verbatim by GET /api/facilities/health.
export type FacilityDimensionState = 'current' | 'updating' | 'failed' | 'stale';
export interface FacilityHealth {
  reportDimension: {
    state: FacilityDimensionState;
    lastSuccessAt: string | null;
    rows: number | null;
    error: string | null;
    /** The failed `facility-map-rebuild` job's id — present only when `state === 'failed'`. This is
     *  the ONLY place the chip can get an id to retry: the route this hits has no other listing
     *  endpoint that exposes `facility_jobs` ids. */
    jobId: string | null;
  };
  projection: {
    /** Always `failed.length` — the server derives it from the rows below rather than counting
     *  separately, so the badge and the list behind it cannot disagree. */
    failedCount: number;
    /** One entry per facility whose concept projection is broken, each carrying the job id needed to
     *  retry it. A count alone named no job, so a failed projection could be SEEN but not repaired
     *  from anywhere. */
    failed: { id: string; registryId: string | null; lastError: string | null }[];
  };
}
export const getFacilityHealth = (): Promise<FacilityHealth> =>
  apiGet('/api/facilities/health', 'get facility health');
export const retryFacilityJob = (jobId: string): Promise<void> =>
  authFetch(`/api/facilities/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' })
    .then((r) => okJson<{ ok: boolean }>(r, 'retry facility job')).then(() => undefined);

// Roles / capabilities (capability-based RBAC)
export interface RoleRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  locked: boolean;
  capabilities: string[];
  memberCount: number;
}
export interface CapabilityMeta { key: string; group: string; label: string; description: string }
export interface CapabilityGroup { key: string; label: string; capabilities: CapabilityMeta[] }

export const getMyCapabilities = (): Promise<string[]> =>
  authFetch('/api/me/capabilities').then((r) => okJson<{ capabilities: string[] }>(r, 'get capabilities')).then((x) => x.capabilities);
export const listRoles = (): Promise<RoleRecord[]> => apiGet('/api/roles', 'list roles');
export const getRoleCatalog = (): Promise<{ groups: CapabilityGroup[] }> => apiGet('/api/roles/catalog', 'role catalog');
export const getRole = (id: string): Promise<RoleRecord> => apiGet(`/api/roles/${id}`, 'get role');
export const createRole = (input: { name: string; slug?: string; description?: string | null; capabilities: string[] }): Promise<RoleRecord> =>
  authFetch('/api/roles', jbody(input, 'POST')).then((r) => okJson<RoleRecord>(r, 'create role'));
export const updateRole = (id: string, input: { name?: string; description?: string | null; capabilities?: string[] }): Promise<RoleRecord> =>
  authFetch(`/api/roles/${id}`, jbody(input, 'PUT')).then((r) => okJson<RoleRecord>(r, 'update role'));
export const deleteRole = (id: string): Promise<void> =>
  authFetch(`/api/roles/${id}`, { method: 'DELETE' }).then((r) => { if (!r.ok) throw new Error(`delete role failed: ${r.status}`); });
export const getUserRoles = (id: string): Promise<RoleRecord[]> => apiGet(`/api/users/${id}/roles`, 'get user roles');
export const setUserRoles = (id: string, roleIds: string[]): Promise<RoleRecord[]> =>
  authFetch(`/api/users/${id}/roles`, jbody({ roleIds }, 'PUT')).then((r) => okJson<RoleRecord[]>(r, 'set user roles'));

// Forms
export type FormStatus = 'draft' | 'published' | 'archived';
export interface FormSummary {
  id: string;
  name: string;
  versionLabel: string | null;
  status: FormStatus;
  active: boolean;
  fhirResourceType: string | null;
  targetPages: string[] | null;
  fieldCount: number;
  updatedAt: string;
}
export interface FormDefinition {
  id: string;
  name: string;
  versionLabel: string | null;
  fhirResourceType: string | null;
  fhirVersion?: string | null;
  fhirProfileUrl?: string | null;
  facilityId?: string | null;
  status: FormStatus;
  active: boolean;
  schema: unknown;
  targetPages: string[] | null;
  createdAt: string;
  updatedAt: string;
}
export interface CreateFormInput {
  name: string;
  schema: unknown;
  fhirResourceType?: string | null;
  fhirVersion?: string | null;
  fhirProfileUrl?: string | null;
  facilityId?: string | null;
  versionLabel?: string | null;
  targetPages?: string[] | null;
}
export type UpdateFormInput = CreateFormInput;
export interface PublishFormInput {
  versionLabel?: string | null;
}
export interface FormVersionSummary {
  id: string;
  formId: string;
  version: number;
  versionLabel: string | null;
  name: string;
  fhirResourceType: string | null;
  targetPages: string[] | null;
  publishedAt: string;
  publishedBy: string | null;
}
export interface FormVersion extends FormVersionSummary {
  schema: unknown;
  questionnaire: unknown;
}
export const listForms = (): Promise<FormSummary[]> => apiGet('/api/forms', 'list forms');
export const getForm = (id: string): Promise<FormDefinition> => apiGet(`/api/forms/${id}`, 'get form');
export const createForm = (i: CreateFormInput): Promise<FormDefinition> =>
  authFetch('/api/forms', jbody(i, 'POST')).then((r) => okJson<FormDefinition>(r, 'create form'));
export const updateForm = (id: string, i: UpdateFormInput): Promise<FormDefinition> =>
  authFetch(`/api/forms/${id}`, jbody(i, 'PUT')).then((r) => okJson<FormDefinition>(r, 'update form'));
export const publishForm = (id: string, i: PublishFormInput = {}): Promise<FormDefinition> =>
  authFetch(`/api/forms/${id}/publish`, jbody(i, 'POST')).then((r) => okJson<FormDefinition>(r, 'publish form'));
export const duplicateForm = (id: string): Promise<FormDefinition> =>
  authFetch(`/api/forms/${id}/duplicate`, jbody({}, 'POST')).then((r) => okJson<FormDefinition>(r, 'duplicate form'));
export const listFormVersions = (id: string): Promise<FormVersionSummary[]> =>
  apiGet(`/api/forms/${id}/versions`, 'list form versions');
export const getFormVersion = (id: string, version: number): Promise<FormVersion> =>
  apiGet(`/api/forms/${id}/versions/${version}`, 'get form version');
export const setFormStatus = (id: string, status: FormStatus): Promise<FormDefinition> =>
  authFetch(`/api/forms/${id}/status`, jbody({ status }, 'POST')).then((r) => okJson<FormDefinition>(r, 'set form status'));
export const deleteForm = (id: string): Promise<void> => apiDelete(`/api/forms/${id}`, 'delete form');
export const formQuestionnaireUrl = (id: string): string => `/api/forms/${id}/questionnaire`;
export async function exportFormBundle(id: string): Promise<void> {
  const r = await authFetch(`/api/forms/${encodeURIComponent(id)}/export-bundle`, { method: 'GET' });
  if (!r.ok) throw new Error(`export failed: ${r.status}`);
  const blob = await r.blob();
  const disposition = r.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `${id}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
export const submitFormResponse = (id: string, answers: unknown): Promise<unknown> =>
  authFetch(`/api/forms/${id}/responses`, jbody({ answers }, 'POST')).then((r) => okJson<unknown>(r, 'submit form response'));

// ── Reference search (form reference pickers) ────────────────────────────────────
export interface CodingRow { system: string; code: string; display: string | null }
export interface EntityRow { reference: string; display: string; secondary: string | null }
export type ReferenceSearchResponse =
  | { kind: 'coding'; rows: CodingRow[]; total: number }
  | { kind: 'entity'; rows: EntityRow[]; total: number };

export const referenceSearch = (
  formId: string, fieldId: string, p: { q: string; limit?: number; offset?: number },
): Promise<ReferenceSearchResponse> => {
  const qs = new URLSearchParams({ q: p.q, limit: String(p.limit ?? 20), offset: String(p.offset ?? 0) });
  return authFetch(
    `/api/forms/${encodeURIComponent(formId)}/fields/${encodeURIComponent(fieldId)}/reference-search?${qs}`,
  ).then((r) => okJson<ReferenceSearchResponse>(r, 'reference search'));
};

/** Builder-only: search against an unsaved field. Requires forms.edit. */
export const referenceSearchPreview = (
  field: unknown, p: { q: string; limit?: number },
): Promise<ReferenceSearchResponse> =>
  authFetch('/api/forms/reference-search/preview', jbody({ field, q: p.q, limit: p.limit ?? 20 }, 'POST'))
    .then((r) => okJson<ReferenceSearchResponse>(r, 'reference search preview'));

// ── Report designs (Report Designer) ─────────────────────────────────────────
export const listReportDesigns = (): Promise<ReportDesign[]> =>
  authFetch('/api/report-designs').then((r) => okJson<ReportDesign[]>(r, 'list report designs'));
export const getReportDesign = (id: string): Promise<ReportDesign> =>
  apiGet(`/api/report-designs/${encodeURIComponent(id)}`, 'get report design');
export const createReportDesign = (d: ReportDesign): Promise<ReportDesign> =>
  authFetch('/api/report-designs', jbody(d, 'POST')).then((r) => okJson<ReportDesign>(r, 'create report design'));
export const updateReportDesign = (id: string, d: ReportDesign): Promise<ReportDesign> =>
  authFetch(`/api/report-designs/${encodeURIComponent(id)}`, jbody(d, 'PUT')).then((r) => okJson<ReportDesign>(r, 'save report design'));
export const deleteReportDesign = (id: string): Promise<void> =>
  apiDelete(`/api/report-designs/${encodeURIComponent(id)}`, 'delete report design');
export const publishReportDesign = (id: string): Promise<ReportDesign> =>
  authFetch(`/api/report-designs/${encodeURIComponent(id)}/publish`, { method: 'POST' }).then((r) => okJson<ReportDesign>(r, 'publish report design'));
export const previewReportDesign = (design: ReportDesign): Promise<Blob> =>
  authFetch('/api/report-designs/preview', jbody(design, 'POST')).then((r) => {
    if (!r.ok) throw new Error(`preview failed: ${r.status}`);
    return r.blob();
  });

/** Render the (working) design via the preview endpoint and download it as a PDF file. */
export async function downloadReportDesignPdf(design: ReportDesign): Promise<void> {
  const blob = await previewReportDesign(design);
  const safeName = (design.name || 'report-design').replace(/[^\w.-]+/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Terminology admin types & client ─────────────────────────────────────────
export type PublisherRole = 'local' | 'standard' | 'external';
export interface Publisher { id: string; name: string; role: PublisherRole; icon: string | null; seeded: boolean; sortOrder: number }
export interface PublisherInput { name: string; role: PublisherRole; icon?: string | null }
export interface CodingSystem {
  id: string; systemCode: string; systemName: string; url: string | null;
  systemVersion: string | null; description: string | null; active: boolean;
  publisherId: string | null; seeded: boolean;
}
export interface CodingSystemInput {
  systemCode: string; systemName: string; url?: string | null; systemVersion?: string | null;
  description?: string | null; active: boolean; publisherId?: string | null;
}

const jbody = (body: unknown, method: string) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
interface ApiErrorDetail { message: string; code?: string; correlationId?: string }

async function errorDetail(res: Response): Promise<ApiErrorDetail> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => null) as { error?: unknown; message?: unknown; code?: unknown; correlationId?: unknown } | null;
    const detail = body?.error ?? body?.message;
    const message = typeof detail === 'string' && detail.trim() ? detail.trim() : String(res.status);
    return {
      message,
      code: typeof body?.code === 'string' ? body.code : undefined,
      correlationId: typeof body?.correlationId === 'string' ? body.correlationId : undefined,
    };
  }
  const text = await res.text().catch(() => '');
  return { message: text.trim() || String(res.status) };
}

/** Format a failed API call into a single user-facing string: "<what> failed: <message> · <code> · <id>". */
export function formatApiError(what: string, detail: ApiErrorDetail): string {
  const parts = [detail.message];
  if (detail.code) parts.push(detail.code);
  if (detail.correlationId) parts.push(detail.correlationId);
  return `${what} failed: ${parts.join(' · ')}`;
}

async function okJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(formatApiError(what, await errorDetail(res)));
  return res.json() as Promise<T>;
}
const apiGet = <T>(url: string, what: string): Promise<T> => authFetch(url).then((res) => okJson<T>(res, what));
async function apiDelete(url: string, what: string): Promise<void> {
  const res = await authFetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`${what} failed: ${res.status}`);
}

export const listPublishers = () => authFetch('/api/terminology/publishers').then((r) => okJson<Publisher[]>(r, 'list publishers'));
export const createPublisher = (i: PublisherInput) => authFetch('/api/terminology/publishers', jbody(i, 'POST')).then((r) => okJson<Publisher>(r, 'create publisher'));
export const updatePublisher = (id: string, i: PublisherInput) => authFetch(`/api/terminology/publishers/${id}`, jbody(i, 'PUT')).then((r) => okJson<Publisher>(r, 'update publisher'));
export async function deletePublisher(id: string): Promise<void> {
  const r = await authFetch(`/api/terminology/publishers/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete publisher failed: ${r.status}`);
}
export const publisherDeletionImpact = (id: string) => authFetch(`/api/terminology/publishers/${id}/deletion-impact`).then((r) => okJson<{ systemCount: number; termCount: number }>(r, 'impact'));

export const listCodingSystems = (publisher?: string) => authFetch(`/api/terminology/systems${publisher ? `?publisher=${encodeURIComponent(publisher)}` : ''}`).then((r) => okJson<CodingSystem[]>(r, 'list systems'));
export const createCodingSystem = (i: CodingSystemInput) => authFetch('/api/terminology/systems', jbody(i, 'POST')).then((r) => okJson<CodingSystem>(r, 'create system'));
export const updateCodingSystem = (id: string, i: CodingSystemInput) => authFetch(`/api/terminology/systems/${id}`, jbody(i, 'PUT')).then((r) => okJson<CodingSystem>(r, 'update system'));
export async function deleteCodingSystem(id: string): Promise<void> {
  const r = await authFetch(`/api/terminology/systems/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) {
    let msg = `delete system failed: ${r.status}`;
    try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* keep status fallback */ }
    throw new Error(msg);
  }
}
// `facilityCount` is non-zero only for a facility register (`coding_systems.kind`): the facilities
// whose permanent ids were hashed from this system's url. A register carries no terms and usually no
// concept-map elements, so without this the dialog reads "0 term(s) and 0 mapping(s)" over a delete
// the server now refuses.
export const systemDeletionImpact = (id: string) => authFetch(`/api/terminology/systems/${id}/deletion-impact`).then((r) => okJson<{ termCount: number; mappingCount: number; facilityCount: number }>(r, 'impact'));

// Value sets (SP3)
export interface ValueSetComposeConcept { code: string; display?: string }
export interface ValueSetComposeClause {
  system?: string; version?: string;
  concept?: ValueSetComposeConcept[];
  filter?: { property: string; op: string; value: string }[];
  valueSet?: string[];
}
export interface ValueSetCompose { include?: ValueSetComposeClause[]; exclude?: ValueSetComposeClause[] }
export interface ValueSet {
  id: string; url: string; version: string | null; name: string | null; title: string | null;
  status: string; experimental: boolean; description: string | null; compose: ValueSetCompose;
  immutable: boolean; category: string | null; publisherId: string | null;
}
export interface ValueSetCatalogImportResult {
  imported: number;
  skipped: number;
  valueSet: ValueSet | null;
}
export interface ValueSetSummary {
  id: string; url: string; name: string | null; title: string | null; version: string | null;
  status: string; immutable: boolean; publisherId: string | null; category: string | null;
  codeCount: number; primarySystem: string | null;
}
export interface ValueSetInput {
  url: string; version?: string | null; name?: string | null; title?: string | null;
  status: string; experimental?: boolean; description?: string | null; compose: ValueSetCompose;
  publisherId?: string | null; category?: string | null;
}
export interface ExpandedCode { system: string; code: string; display: string | null }

export const listValueSets = (publisherId?: string): Promise<ValueSetSummary[]> =>
  authFetch(`/api/terminology/valuesets${publisherId ? `?publisherId=${encodeURIComponent(publisherId)}` : ''}`).then((r) => okJson<ValueSetSummary[]>(r, 'list value sets'));
export const getValueSet = (id: string): Promise<ValueSet> => authFetch(`/api/terminology/valuesets/${id}`).then((r) => okJson<ValueSet>(r, 'get value set'));
export const saveValueSet = (input: ValueSetInput): Promise<ValueSet> => authFetch('/api/terminology/valuesets', jbody(input, 'POST')).then((r) => okJson<ValueSet>(r, 'save value set'));
export async function deleteValueSet(id: string): Promise<void> {
  const r = await authFetch(`/api/terminology/valuesets/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete value set failed: ${r.status}`);
}
export const duplicateValueSet = (id: string): Promise<ValueSet> => authFetch(`/api/terminology/valuesets/${id}/duplicate`, jbody({}, 'POST')).then((r) => okJson<ValueSet>(r, 'duplicate value set'));
export const expandValueSet = (id: string, activeOnly = true): Promise<{ codes: ExpandedCode[]; total: number }> =>
  authFetch(`/api/terminology/valuesets/${id}/expand?activeOnly=${activeOnly}`).then((r) => okJson<{ codes: ExpandedCode[]; total: number }>(r, 'expand value set'));
export const importValueSet = (resource: unknown | Blob): Promise<ValueSet | ValueSetCatalogImportResult> => {
  const init = resource instanceof Blob
    ? {
      method: 'POST',
      headers: { 'content-type': 'name' in resource && typeof resource.name === 'string' && resource.name.endsWith('.gz') ? 'application/gzip' : 'application/fhir+json' },
      body: resource,
    }
    : jbody(resource, 'POST');
  return authFetch('/api/terminology/valuesets/import', init).then((r) => okJson<ValueSet | ValueSetCatalogImportResult>(r, 'import value set'));
};
export const valueSetExportUrl = (id: string): string => `/api/terminology/valuesets/${id}/export`;

export interface TerminologyIngestJobView {
  id: string; status: 'queued' | 'running' | 'ready' | 'failed';
  phase: string | null; processed: number; total: number | null; error: string | null;
  version: string | null; finishedAt: string | null;
}

/** Stream a distribution zip to the server with upload progress. Uses XHR (fetch has no upload
 *  progress). Auth mirrors authFetch: bearer from getAccessToken(). */
export function uploadTerminologyDistribution(
  publisherId: string, systemType: string, file: File, acceptLicense: boolean, version: string | null,
  onProgress?: (fraction: number) => void,
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ systemType, acceptLicense: String(acceptLicense) });
    if (version) params.set('version', version);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/terminology/publishers/${encodeURIComponent(publisherId)}/distribution?${params.toString()}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ jobId: '' }); }
      } else {
        let msg = `upload failed (${xhr.status})`;
        try { const j = JSON.parse(xhr.responseText); if (j?.error) msg = j.error; } catch { /* ignore */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.send(file);
  });
}

export const getTerminologyIngestJob = (publisherId: string, systemType: string): Promise<TerminologyIngestJobView> =>
  authFetch(`/api/terminology/publishers/${encodeURIComponent(publisherId)}/distribution/job?systemType=${systemType}`)
    .then((r) => okJson<TerminologyIngestJobView>(r, 'get import job'));

export const purgeTerminologyDistribution = (publisherId: string, systemType: string): Promise<void> =>
  authFetch(`/api/terminology/publishers/${encodeURIComponent(publisherId)}/distribution?systemType=${systemType}`, { method: 'DELETE' }).then(() => undefined);

/** Rebuild an upload-managed coding system by re-ingesting its retained distribution zip from the
 *  blob store (concepts + ontology). Returns the queued job id; progress flows through the same
 *  job-status poll + bell as an upload. */
export const reingestTerminologyDistribution = (codingSystemId: string): Promise<{ jobId: string }> =>
  authFetch(`/api/terminology/systems/${encodeURIComponent(codingSystemId)}/distribution/reingest`, { method: 'POST' })
    .then((r) => okJson<{ jobId: string }>(r, 'rebuild distribution'));

// ── Terms + mappings (SP2) ───────────────────────────────────────────────────
export type TermStatus = 'ACTIVE' | 'DRAFT' | 'DEPRECATED' | 'DISABLED';
export type MapType = 'SAME-AS' | 'NARROWER-THAN' | 'BROADER-THAN' | 'RELATED-TO' | 'UNMAPPED-FROM';
export interface Term { system: string; code: string; display: string | null; status: string; shortName: string | null; class: string | null; unit: string | null; replacedBy: string | null; metadata: Record<string, unknown> | null; mappingCount: number }
export interface TermInput { code: string; display: string; status: TermStatus; shortName?: string | null; class?: string | null; unit?: string | null; replacedBy?: string | null; metadata?: Record<string, unknown> | null }
export interface TermMapping { id: string; fromSystem: string; fromCode: string; toSystem: string; toCode: string; toDisplay: string | null; mapType: MapType; relationship: string | null; owner: string | null; isActive: boolean }
export interface TermMappingInput { fromSystem: string; fromCode: string; toSystem: string; toCode: string; toDisplay: string | null; mapType: MapType; relationship?: string | null; owner?: string | null; isActive: boolean }

// `systemId` is a SINGLE path segment and may be either a coding-system id (`cs-url-LOINC`) or a
// canonical system URL (`http://loinc.org`) — the server resolves both. It MUST be percent-encoded:
// an unencoded URL injects extra `/` and the request can never match `/systems/:id/terms`, which is
// why binding a form field to LOINC 404'd with "search terms failed: Not Found".
// `status` may be one status or several. Several are sent as a REPEATED param
// (`?status=ACTIVE&status=DRAFT`), which Fastify 5's default query parser (`fast-querystring`)
// turns back into an array for the route's status filter. One status sends one `status=`,
// exactly as before.
export const searchTerms = (systemId: string, p: { q?: string; status?: string | string[]; limit?: number; offset?: number }) => {
  const qs = new URLSearchParams();
  if (p.q) qs.set('q', p.q);
  for (const s of Array.isArray(p.status) ? p.status : p.status ? [p.status] : []) qs.append('status', s);
  qs.set('limit', String(p.limit ?? 50));
  qs.set('offset', String(p.offset ?? 0));
  return authFetch(`/api/terminology/systems/${encodeURIComponent(systemId)}/terms?${qs}`).then((r) => okJson<{ rows: Term[]; total: number }>(r, 'search terms'));
};
export const createTerm = (systemId: string, i: TermInput) => authFetch(`/api/terminology/systems/${encodeURIComponent(systemId)}/terms`, jbody(i, 'POST')).then((r) => okJson<Term>(r, 'create term'));
export const updateTerm = (systemId: string, code: string, i: TermInput) => authFetch(`/api/terminology/systems/${encodeURIComponent(systemId)}/terms/${encodeURIComponent(code)}`, jbody(i, 'PUT')).then((r) => okJson<Term>(r, 'update term'));
export async function deleteTerm(systemId: string, code: string): Promise<void> {
  const r = await authFetch(`/api/terminology/systems/${encodeURIComponent(systemId)}/terms/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete term failed: ${r.status}`);
}
export const importTerms = (systemId: string, source: string | Blob) => {
  const init = source instanceof Blob
    ? { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: source }
    : jbody({ text: source }, 'POST');
  return authFetch(`/api/terminology/systems/${encodeURIComponent(systemId)}/terms/import`, init).then((r) => okJson<{ imported: number }>(r, 'import terms'));
};
export const termsTemplateUrl = (systemId: string) => `/api/terminology/systems/${encodeURIComponent(systemId)}/terms/template.csv`;

export const listTermMappings = (system: string, code: string) =>
  authFetch(`/api/terminology/terms/${encodeURIComponent(system)}/${encodeURIComponent(code)}/mappings`).then((r) => okJson<{ outgoing: TermMapping[]; reverse: TermMapping[] }>(r, 'list mappings'));
export const createTermMapping = (system: string, code: string, i: Omit<TermMappingInput, 'fromSystem' | 'fromCode'>) =>
  authFetch(`/api/terminology/terms/${encodeURIComponent(system)}/${encodeURIComponent(code)}/mappings`, jbody(i, 'POST')).then((r) => okJson<{ mapping: TermMapping; draftCreated: boolean }>(r, 'create mapping'));
export const updateTermMapping = (id: string, i: TermMappingInput) => authFetch(`/api/terminology/mappings/${id}`, jbody(i, 'PUT')).then((r) => okJson<TermMapping>(r, 'update mapping'));
export async function deleteTermMapping(id: string): Promise<void> {
  const r = await authFetch(`/api/terminology/mappings/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`delete mapping failed: ${r.status}`);
}

// Ontology browser (SP4)
export type OntologyType = 'loinc' | 'snomed' | 'rxnorm';
export interface OntologyNode {
  code: string;
  display: string;
  kind: string;
  extra: Record<string, unknown> | null;
  childCount: number;
  group: string | null;
}
export interface OntologyBreadcrumb {
  code: string;
  display: string;
}
export interface OntologyDistribution {
  codingSystemId: string;
  ontologyType: OntologyType;
  sourcePath: string;
  indexStatus: string;
  indexError: string | null;
  nodeCount: number | null;
  edgeCount: number | null;
  builtAt: string | null;
  updatedAt: string;
  stale?: boolean;
}
export interface OntologyBuildProgress {
  codingSystemId: string;
  phase: string;
  processed: number;
  total: number | null;
}
export interface PanelMember {
  panelLoinc: string;
  memberLoinc: string;
  memberName: string;
  displayName: string;
  sequence: number;
  required: boolean;
}
export interface AnswerOption {
  value: string;
  label: string;
}
export interface SpecimenCode {
  snomedCode: string;
  equivalence: string;
}

export const listOntologyDistributions = (): Promise<OntologyDistribution[]> =>
  apiGet('/api/terminology/ontology/distributions', 'list ontology distributions');
export const getOntologyDistribution = (id: string): Promise<(OntologyDistribution & { stale: boolean }) | null> =>
  apiGet(`/api/terminology/ontology/distributions/${id}`, 'get ontology distribution');
export const unlinkOntologyDistribution = (id: string): Promise<void> =>
  apiDelete(`/api/terminology/ontology/distributions/${id}`, 'unlink ontology distribution');
export const ontologyRoots = (id: string): Promise<OntologyNode[]> =>
  apiGet(`/api/terminology/ontology/${id}/roots`, 'ontology roots');
export const ontologyChildren = (id: string, parent: string): Promise<OntologyNode[]> =>
  apiGet(`/api/terminology/ontology/${id}/children?parent=${encodeURIComponent(parent)}`, 'ontology children');
export const ontologyNodeDetail = (id: string, code: string): Promise<OntologyNode | null> =>
  apiGet(`/api/terminology/ontology/${id}/node?code=${encodeURIComponent(code)}`, 'ontology node');
export const ontologySearch = (id: string, query: string): Promise<OntologyNode[]> =>
  apiGet(`/api/terminology/ontology/${id}/search?q=${encodeURIComponent(query)}`, 'ontology search');
export const ontologyPath = (id: string, code: string): Promise<OntologyBreadcrumb[]> =>
  apiGet(`/api/terminology/ontology/${id}/path?code=${encodeURIComponent(code)}`, 'ontology path');
export const ontologyPanelMembers = (id: string, loinc: string): Promise<PanelMember[]> =>
  apiGet(`/api/terminology/ontology/${id}/panels?loinc=${encodeURIComponent(loinc)}`, 'ontology panel members');
export const ontologyAnswerOptions = (id: string, loinc: string): Promise<AnswerOption[]> =>
  apiGet(`/api/terminology/ontology/${id}/answers?loinc=${encodeURIComponent(loinc)}`, 'ontology answer options');
export const ontologySpecimenCodes = (id: string, loinc: string): Promise<SpecimenCode[]> =>
  apiGet(`/api/terminology/ontology/${id}/specimens?loinc=${encodeURIComponent(loinc)}`, 'ontology specimen codes');

// ── Marketplace (SP-4) ─────────────────────────────────────────────────────────
export interface AvailableArtifact {
  ref: string;
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  capabilities?: unknown[];
  compatibility?: { ceVersion: string };
  valid?: boolean;
  /** When valid === false, the specific check that failed (so the UI shows the real cause). */
  invalidReason?: 'fingerprint-mismatch' | 'payload-hash-mismatch' | 'ui-hash-mismatch' | 'bad-signature';
  description?: string;
  license?: string;
  summary?: string;
  signatureFingerprint?: string;
  versions?: { version: string; ref: string }[];
  registryName?: string;
}
export interface ArtifactPayloadMeta {
  kind: string;
  entrypoint?: string;
  wasmSha256?: string;
  wasi?: boolean;
  limits?: { memoryMb: number; timeoutMs: number };
  [k: string]: unknown;
}
export interface AvailableArtifactDetail extends AvailableArtifact {
  compatible: boolean;
  ceVersion: string;
  readme?: string;
  payload: ArtifactPayloadMeta;
}
export interface InstalledArtifact {
  id: string;
  version: string;
  active: boolean;
  enabled: boolean;
  approvedBy: string | null;
  type: string;
  publisher: unknown;
  description?: string | null;
  license?: string | null;
  payload?: ArtifactPayloadMeta | null;
  capabilities: unknown[];
  legacy: boolean;
  drifted?: boolean;
  targetFormId?: string;
}

export const listInstalledArtifacts = (): Promise<InstalledArtifact[]> =>
  apiGet('/api/marketplace/installed', 'list installed artifacts');

export const listAvailableArtifacts = (): Promise<{ configured: boolean; source: 'local' | 'http' | null; host: string | null; bundles: AvailableArtifact[]; error?: string }> =>
  apiGet('/api/marketplace/available', 'list available artifacts');

export async function refreshRegistry(): Promise<void> {
  const r = await authFetch('/api/marketplace/refresh', { method: 'POST' });
  if (!r.ok) throw new Error(`refresh failed: ${r.status}`);
}

export const getAvailableArtifact = (ref: string): Promise<AvailableArtifactDetail> =>
  apiGet(`/api/marketplace/available/${encodeURIComponent(ref)}`, 'get available artifact');

/** Rich detail for an installed plugin (readme/payload/compatibility), read from its
 *  stored manifest — the installed analogue of getAvailableArtifact. */
export interface InstalledArtifactDetail {
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  description?: string | null;
  readme?: string;
  license?: string | null;
  payload?: ArtifactPayloadMeta | null;
  capabilities: unknown[];
  compatible: boolean;
  ceVersion: string;
  compatibility?: { ceVersion: string };
  valid?: boolean;
  invalidReason?: AvailableArtifact['invalidReason'];
}

export const getInstalledArtifact = (id: string): Promise<InstalledArtifactDetail> =>
  apiGet(`/api/marketplace/installed/${encodeURIComponent(id)}`, 'get installed artifact');

export const installArtifact = (ref: string, acknowledgedCapabilities: unknown[]): Promise<{ id: string; version: string }> =>
  authFetch('/api/marketplace/install', jbody({ ref, acknowledgedCapabilities }, 'POST')).then((r) => okJson<{ id: string; version: string }>(r, 'install artifact'));

export const getPublishStatus = (): Promise<{ configured: boolean; repo: string | null }> =>
  apiGet('/api/marketplace/publish/status', 'get publish status');

export const publishArtifact = (ref: string): Promise<{ prUrl: string; prNumber: number }> =>
  authFetch('/api/marketplace/publish', jbody({ ref }, 'POST')).then((r) => okJson<{ prUrl: string; prNumber: number }>(r, 'publish artifact'));

export async function setArtifactEnabled(id: string, enabled: boolean): Promise<void> {
  const endpoint = enabled ? 'enable' : 'disable';
  const r = await authFetch(`/api/marketplace/${encodeURIComponent(id)}/${endpoint}`, { method: 'POST' });
  if (!r.ok) throw new Error(`set artifact ${endpoint} failed: ${r.status}`);
}

export const rollbackArtifact = (id: string, version: string): Promise<void> =>
  authFetch(`/api/marketplace/${encodeURIComponent(id)}/rollback`, jbody({ version }, 'POST')).then(async (r) => {
    if (!r.ok) throw new Error(`rollback artifact failed: ${r.status}`);
  });

export async function removeArtifact(id: string, version?: string): Promise<void> {
  const qs = version ? `?version=${encodeURIComponent(version)}` : '';
  await apiDelete(`/api/marketplace/${encodeURIComponent(id)}${qs}`, 'remove artifact');
}

export async function detachArtifact(id: string): Promise<void> {
  const r = await authFetch(`/api/marketplace/${encodeURIComponent(id)}/detach`, { method: 'POST' });
  if (!r.ok) throw new Error(`detach failed: ${r.status}`);
}

// ── Marketplace registries (SP-C) ──────────────────────────────────────────────
export interface MarketplaceRegistry { id: string; name: string; kind: 'local' | 'http'; location: string; enabled: boolean; createdAt: string; updatedAt: string }
export interface RegistryInput { name: string; kind: 'local' | 'http'; location: string; enabled?: boolean }
export const listRegistries = (): Promise<MarketplaceRegistry[]> => apiGet('/api/marketplace/registries', 'list registries');
export const createRegistry = (i: RegistryInput): Promise<MarketplaceRegistry> => authFetch('/api/marketplace/registries', jbody(i, 'POST')).then((r) => okJson<MarketplaceRegistry>(r, 'create registry'));
export const updateRegistry = (id: string, i: Partial<RegistryInput>): Promise<MarketplaceRegistry> => authFetch(`/api/marketplace/registries/${encodeURIComponent(id)}`, jbody(i, 'PUT')).then((r) => okJson<MarketplaceRegistry>(r, 'update registry'));
export async function deleteRegistry(id: string): Promise<void> { const r = await authFetch(`/api/marketplace/registries/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!r.ok && r.status !== 204) throw new Error(`delete registry failed: ${r.status}`); }

export function buildOntology(
  id: string,
  opts: { path?: string; rebuild?: boolean },
  onProgress: (progress: OntologyBuildProgress) => void,
): { promise: Promise<OntologyDistribution>; cancel: () => void } {
  const token = getAccessToken();
  const tokenParam = token ? `${opts.rebuild ? '?' : '&'}access_token=${encodeURIComponent(token)}` : '';
  const url = (opts.rebuild
    ? `/api/terminology/ontology/${id}/rebuild`
    : `/api/terminology/ontology/${id}/build?path=${encodeURIComponent(opts.path ?? '')}`) + tokenParam;
  const eventSource = new EventSource(url);
  const promise = new Promise<OntologyDistribution>((resolve, reject) => {
    eventSource.addEventListener('progress', (event) => {
      try {
        onProgress(JSON.parse((event as MessageEvent).data) as OntologyBuildProgress);
      } catch {
        // Ignore malformed progress events; the terminal done/error event decides the outcome.
      }
    });
    eventSource.addEventListener('done', (event) => {
      eventSource.close();
      resolve(JSON.parse((event as MessageEvent).data) as OntologyDistribution);
    });
    eventSource.addEventListener('error', (event) => {
      const data = (event as MessageEvent).data;
      eventSource.close();
      reject(new Error(data ? ((JSON.parse(data) as { message?: string }).message ?? 'build failed') : 'connection lost'));
    });
  });
  return { promise, cancel: () => eventSource.close() };
}

// ── Workflow types & API client ───────────────────────────────────────────────

// ── Workflow node catalog (plugin-contributed + host) ──────────────────────────
export interface WorkflowNodeConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'file' | 'json';
  required?: boolean;
  default?: unknown;
  options?: { value: string; label: string }[];
  optionsSource?: string;
  detailSource?: string;
}
export interface WorkflowNodeDescriptor {
  id: string;                 // composite `${pluginId}:${declId}` for plugin nodes
  source: 'host' | 'plugin';
  pluginId?: string;
  label: string;
  kind: 'source' | 'transform' | 'sink';
  description: string;
  entrypoint?: string;
  ports: { inputs: { name: string }[]; outputs: { name: string }[] };
  capabilities: string[];
  config: WorkflowNodeConfigField[];
  /** Wire ABI for plugin nodes: 'items' = JSON {items,config} (default); 'bytes' = raw binary. */
  abi?: 'items' | 'bytes';
  /** For abi:'bytes' — the binary field name on the trigger item (default 'file'). */
  binaryField?: string;
}
export interface WorkflowNodeOption { value: string; label: string }

export async function fetchWorkflowNodes(): Promise<WorkflowNodeDescriptor[]> {
  const r = await authFetch('/api/workflows/nodes');
  if (!r.ok) throw new Error(`workflow nodes failed: ${r.status}`);
  const body = (await r.json()) as { nodes: WorkflowNodeDescriptor[] };
  return body.nodes;
}
export async function fetchNodeOptions(source: string, pluginId?: string): Promise<WorkflowNodeOption[]> {
  const q = pluginId ? `?pluginId=${encodeURIComponent(pluginId)}` : '';
  const r = await authFetch(`/api/workflows/node-options/${encodeURIComponent(source)}${q}`);
  if (!r.ok) return [];
  return (await r.json()) as WorkflowNodeOption[];
}
export async function fetchNodeDetail(source: string, value: string): Promise<Record<string, unknown>> {
  const r = await authFetch(`/api/workflows/node-detail/${encodeURIComponent(source)}?value=${encodeURIComponent(value)}`);
  if (!r.ok) return {};
  return (await r.json()) as Record<string, unknown>;
}
/** The bare decl id for a plugin descriptor (strip the `${pluginId}:` prefix). */
export function pluginNodeDeclId(d: WorkflowNodeDescriptor): string {
  return d.pluginId && d.id.startsWith(`${d.pluginId}:`) ? d.id.slice(d.pluginId.length + 1) : d.id;
}

/** A server-side binary reference returned by the upload endpoint. */
export interface WorkflowBinaryRef {
  objectKey: string;
  contentType: string;
  fileName?: string;
  byteSize: number;
}

/**
 * Upload a file as an octet-stream body, scoped to a specific workflow.
 * Returns a `WorkflowBinaryRef` that can be passed to `executeWorkflowStream`
 * as a `files` entry so the engine seeds it onto the trigger item.
 */
export async function uploadWorkflowFile(workflowId: string, file: File): Promise<WorkflowBinaryRef> {
  const r = await authFetch(
    `/api/workflows/${encodeURIComponent(workflowId)}/uploads?filename=${encodeURIComponent(file.name)}`,
    { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file },
  );
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  return r.json() as Promise<WorkflowBinaryRef>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  definition: { nodes: unknown[]; edges: unknown[] };
  enabled: boolean;
  createdBy: string | null;
  createdAt?: string;
  updatedAt?: string;
  protected?: boolean;
}

/**
 * An opaque reference to a server-side workflow secret (SEC-06). The detail
 * fetch (`GET /api/workflows/:id`) returns these in place of plaintext secrets
 * (webhook `data.secret`, HTTP node `data.config.headers`) — the value is
 * write-only, so the builder shows a masked "secret is set" state and round-trips
 * an untouched ref back unchanged on save. Mirrors `SecretValue` in
 * `@openldr/workflows` (secret-fields.ts).
 */
export type SecretRef = { secretRef: string };

/** A secret field value: plaintext (new/edited) or an opaque store reference (unchanged). */
export type SecretValue = string | SecretRef;

/** Type guard: is this value an opaque secret-store reference (vs. plaintext)? */
export function isSecretRef(v: unknown): v is SecretRef {
  return !!v && typeof v === 'object' && typeof (v as { secretRef?: unknown }).secretRef === 'string';
}

// Per-node execution event protocol (mirrors @openldr/workflows RunEvent on the server).
export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  nodeId: string;
  level: LogLevel;
  message: string;
  ts: number;
}

export interface NodeRunResult {
  nodeId: string;
  type: string;
  label?: string;
  status: 'success' | 'error' | 'skipped';
  output?: unknown;
  /** Structured result metadata (e.g. a plugin sink's import summary). Undefined for most nodes. */
  meta?: unknown;
  error?: string;
  durationMs: number;
  logs?: LogEntry[];
}

export interface ExecuteResponse {
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  results: NodeRunResult[];
}

export type RunEvent =
  | { type: 'node:start'; nodeId: string; nodeType: string }
  | { type: 'node:log'; entry: LogEntry }
  | { type: 'node:success'; nodeId: string; nodeType: string; input: unknown; output: unknown; durationMs: number; meta?: unknown }
  | { type: 'node:error'; nodeId: string; nodeType: string; error: string; durationMs: number }
  | { type: 'workflow:done'; status: 'completed' | 'failed' };

export async function fetchWorkflows(): Promise<Workflow[]> {
  const res = await authFetch('/api/workflows');
  if (!res.ok) throw new Error(`workflows list failed: ${res.status}`);
  return res.json() as Promise<Workflow[]>;
}

export async function fetchWorkflow(id: string): Promise<Workflow> {
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`workflow ${id} failed: ${res.status}`);
  return res.json() as Promise<Workflow>;
}

export async function createWorkflow(body: Omit<Workflow, 'createdAt' | 'updatedAt'>): Promise<Workflow> {
  const res = await authFetch('/api/workflows', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create workflow failed: ${res.status}`);
  return res.json() as Promise<Workflow>;
}

export async function updateWorkflow(id: string, body: Omit<Workflow, 'createdAt' | 'updatedAt'>): Promise<Workflow> {
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`update workflow failed: ${res.status}`);
  return res.json() as Promise<Workflow>;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete workflow failed: ${res.status}`);
}

/** Restore a seeded system workflow to its default definition. The webhook secret is preserved
 *  server-side whenever there is one to keep — whether it was stored as a `{ secretRef }` or, on
 *  an unsealed graph, as plaintext. `secretPreserved: false` means the stored graph held no
 *  webhook secret at all, so a placeholder was minted; it CANNOT be handed out (workflow secrets
 *  are write-only, SEC-06), so the operator must set a new one on the trigger and distribute that. */
export async function resetWorkflow(id: string): Promise<{ ok: true; secretPreserved: boolean }> {
  return authFetch(`/api/workflows/${encodeURIComponent(id)}/reset`, jbody({}, 'POST'))
    .then((r) => okJson<{ ok: true; secretPreserved: boolean }>(r, 'reset workflow'));
}

/**
 * Stream execution events. `onEvent` receives each per-node RunEvent; the final
 * `event: done` frame carries the batch summary, which is returned to the caller
 * (mirrors the standalone `workflowApi.executeStream`). The `event: error` frame
 * throws.
 */
export async function executeWorkflowStream(
  id: string,
  onEvent: (evt: RunEvent) => void,
  opts: { input?: unknown; signal?: AbortSignal; files?: Record<string, WorkflowBinaryRef> } = {},
): Promise<ExecuteResponse | null> {
  const token = getAccessToken();
  const body: Record<string, unknown> = { input: opts.input };
  if (opts.files) body.files = opts.files;
  const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/execute-stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`execute failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: ExecuteResponse | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      let eventType = 'message';
      const dataLines: string[] = [];
      for (const l of frame.split('\n')) {
        if (l.startsWith('event:')) eventType = l.slice(6).trim();
        else if (l.startsWith('data:')) dataLines.push(l.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(dataLines.join('\n')); } catch { continue; /* skip malformed frame */ }
      if (eventType === 'done') {
        finalResult = parsed as ExecuteResponse;
      } else if (eventType === 'error') {
        const msg = parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : 'Stream error';
        throw new Error(msg);
      } else {
        onEvent(parsed as RunEvent);
      }
    }
  }
  return finalResult;
}

// ── Workflow run history ───────────────────────────────────────────────────────

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  triggerSource: 'manual' | 'schedule' | 'webhook' | 'ingest' | 'event';
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  error: string | null;
  result: unknown;
}

export async function fetchWorkflowRuns(
  id: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<WorkflowRunSummary[]> {
  const qs = new URLSearchParams();
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}/runs${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`workflow runs failed: ${res.status}`);
  return res.json() as Promise<WorkflowRunSummary[]>;
}

export async function fetchWorkflowRun(runId: string): Promise<WorkflowRunSummary> {
  const res = await authFetch(`/api/workflows/runs/${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error(`workflow run failed: ${res.status}`);
  return res.json() as Promise<WorkflowRunSummary>;
}

export interface WorkflowDatasetSummary {
  name: string;
  rowCount: number;
  workflowId: string | null;
  updatedAt?: string;
  publishedTable?: string | null;
}

export async function fetchWorkflowDatasets(): Promise<WorkflowDatasetSummary[]> {
  const res = await authFetch('/api/workflows/datasets');
  if (!res.ok) throw new Error(`datasets failed: ${res.status}`);
  return res.json() as Promise<WorkflowDatasetSummary[]>;
}

// ── Connectors (SP-5b) ─────────────────────────────────────────────────────────
export interface Connector {
  id: string;
  name: string;
  pluginId: string | null;
  type: string | null;
  kind: string;
  allowedHost: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SinkPluginRef { id: string; version: string; enabled: boolean }
export interface ConnectorMetadataCounts {
  dataElements: number; orgUnits: number; categoryOptionCombos: number; programs: number; programStages: number;
}
export type ConnectorTestResult =
  | { ok: true; metadata?: ConnectorMetadataCounts }
  | { ok: false; error: string };
export interface ConnectorCreateInput {
  name: string; pluginId?: string; type?: string; config: Record<string, string>; allowedHost?: string;
}
export interface ConnectorUpdateInput {
  name?: string; config?: Record<string, string>; allowedHost?: string | null; enabled?: boolean;
}

export const listConnectors = (): Promise<Connector[]> =>
  apiGet<Connector[]>('/api/connectors', 'list connectors');
export const listSinkPlugins = (): Promise<SinkPluginRef[]> =>
  apiGet<SinkPluginRef[]>('/api/connectors/sink-plugins', 'list sink plugins');
export const createConnector = (input: ConnectorCreateInput): Promise<Connector> =>
  authFetch('/api/connectors', jbody(input, 'POST')).then((r) => okJson<Connector>(r, 'create connector'));
export const updateConnector = (id: string, input: ConnectorUpdateInput): Promise<Connector> =>
  authFetch(`/api/connectors/${encodeURIComponent(id)}`, jbody(input, 'PUT')).then((r) => okJson<Connector>(r, 'update connector'));
export const deleteConnector = (id: string): Promise<void> =>
  apiDelete(`/api/connectors/${encodeURIComponent(id)}`, 'delete connector');
export const testConnector = (id: string): Promise<ConnectorTestResult> =>
  authFetch(`/api/connectors/${encodeURIComponent(id)}/test`, { method: 'POST' }).then((r) => okJson<ConnectorTestResult>(r, 'test connector'));

/** Authenticated download of a produced workflow artifact (objectKey under workflow-artifacts/). */
export async function downloadWorkflowArtifact(objectKey: string, fileName: string): Promise<void> {
  const path = objectKey.split('/').map(encodeURIComponent).join('/');
  const r = await authFetch(`/api/workflows/artifacts/${path}`);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── Payload lifecycle activity (S4) ────────────────────────────────────────────
export interface LifecycleStageEntry { stage: string; status: string; at: string; runId?: string; detail?: string }
export interface Lifecycle { correlationId: string; status: string; stages: LifecycleStageEntry[]; runIds: string[] }
export interface RecentPayload { correlationId: string; workflowId: string; source: string | null; startedAt: string; currentStage: string; status: string }

export const fetchActivity = (limit = 200): Promise<RecentPayload[]> =>
  authFetch(`/api/activity?limit=${limit}`).then((r) => okJson<RecentPayload[]>(r, 'list activity'));
export const fetchLifecycle = (id: string): Promise<Lifecycle> =>
  authFetch(`/api/activity/${encodeURIComponent(id)}`).then((r) => okJson<Lifecycle>(r, 'load lifecycle'));

// ── Plugin UI surface (SP-A1b) ─────────────────────────────────────────────────

export interface PluginUiEntry {
  id: string;
  version: string;
  nav: { label: string; icon: string; section: string };
  uiSdkVersion: string;
  hasWebview: boolean;
  hasDeclarative: boolean;
  declarative: unknown | null;
}

export const listPluginUis = (): Promise<PluginUiEntry[]> =>
  apiGet<PluginUiEntry[]>('/api/plugins/ui', 'list plugin UIs');

export const pluginUiAssetUrl = (id: string): string => `/api/plugins/${encodeURIComponent(id)}/ui/asset`;

export const pluginBrokerCall = (id: string, op: PluginBrokerOp): Promise<PluginRpcResult> =>
  authFetch(`/api/plugins/${encodeURIComponent(id)}/broker`, jbody({ op }, 'POST'))
    .then((r) => okJson<PluginRpcResult>(r, 'plugin broker call'));

// ── Update check ────────────────────────────────────────────────────────────
// Mirrors UpdateState in @openldr/bootstrap (update-check.ts). Nothing here starts
// an upgrade — the studio only reads the cached state and owns the on/off switch.

export interface UpdateState {
  enabled: boolean;
  running: string;
  latestVersion: string | null;
  releasedAt: string | null;
  notesUrl: string | null;
  firstSeenAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  updateAvailable: boolean;
}

export const fetchUpdateState = (): Promise<UpdateState> =>
  apiGet<UpdateState>('/api/update', 'update state');

export const setUpdateCheckEnabled = (enabled: boolean): Promise<{ enabled: boolean }> =>
  authFetch('/api/settings/update', jbody({ enabled }, 'PUT'))
    .then((r) => okJson<{ enabled: boolean }>(r, 'update check'));

// ── Notifications (bell) ────────────────────────────────────────────────────

export type NotificationPriority = 'info' | 'warning' | 'critical';
// Mirrors NotificationType in @openldr/bootstrap (notifications.ts). Adding a type
// here is only step 1 of 3: NOTIFICATION_TYPES in pages/Notifications.tsx drives the
// Type filter, TRIGGER_TYPES in pages/settings/NotificationPreferences.tsx drives the
// on/off rows AND the saved payload, and both need i18n
// `notifications.triggers.<type>` + `notifications.body.<type>` keys in en/fr/pt.
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

export interface NotificationListParams {
  limit?: number; offset?: number; unreadOnly?: boolean; type?: string; priority?: string;
}

export async function listNotifications(
  params: NotificationListParams = {},
): Promise<{ notifications: Notification[]; unreadCount: number; total: number }> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  if (params.unreadOnly) qs.set('unreadOnly', 'true');
  if (params.type) qs.set('type', params.type);
  if (params.priority) qs.set('priority', params.priority);
  const res = await authFetch(`/api/notifications?${qs.toString()}`);
  if (!res.ok) throw new Error(`notifications list failed: ${res.status}`);
  return res.json() as Promise<{ notifications: Notification[]; unreadCount: number; total: number }>;
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  await authFetch('/api/notifications/read', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await authFetch('/api/notifications/read-all', { method: 'POST' });
}

export async function getNotificationPrefs(): Promise<{ disabled: string[]; minPriority: NotificationPriority }> {
  const res = await authFetch('/api/notifications/preferences');
  if (!res.ok) return { disabled: [], minPriority: 'info' };
  return res.json() as Promise<{ disabled: string[]; minPriority: NotificationPriority }>;
}

export async function saveNotificationPrefs(
  prefs: { type: string; enabled: boolean }[], minPriority?: NotificationPriority,
): Promise<void> {
  const res = await authFetch('/api/notifications/preferences', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs, minPriority }),
  });
  if (!res.ok) throw new Error('save preferences failed: ' + res.status);
}
