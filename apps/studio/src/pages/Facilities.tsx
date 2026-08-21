import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Building2, CheckCircle2, Loader2, XCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import {
  ActiveFilterChips, DataTableToolbar, newId, useTableState,
  type ColumnDef, type FilterOperator, type FilterRule, type SortRule,
} from '@/components/data-table';
import { FACILITY_COLUMNS, type ParsedFilter, type ParsedSort } from '@openldr/table-query';
import { useAuth } from '@/auth/AuthProvider';
import {
  listFacilities, deleteFacility, listPublishedForms, getFacilityHealth, retryFacilityJob,
  listFacilityAdminValues,
  type Facility, type FacilityHealth, type FacilityDimensionState, type FacilityListQuery,
  type FacilityAdminLevel,
} from '@/api';
import { FacilityDialog } from '@/facilities/FacilityDialog';
import { ImportFacilitiesSheet } from '@/facilities/ImportFacilitiesSheet';
import { ObservedTab } from '@/facilities/ObservedTab';
import { FacilityHistory } from '@/facilities/FacilityHistory';
import { FACILITY_STATUS_VALUESET_ID, useCodeDisplayMap, displayFor } from '@/facilities/facility-code-labels';

/** Task 5: the filters `GET /api/facilities` accepts that have NO column in `FACILITY_COLUMNS`,
 *  so they cannot be expressed as grammar rules and keep their own named params and their own
 *  controls: `q` (a multi-column search the store spells out itself), `health` (a DERIVED mapping
 *  state, not a stored column) and `nationalSystem` (`national_system` is not on the grammar
 *  whitelist). Everything this type used to also carry - country/zone/region/district/council/
 *  status/level/ownership/source/managedOrigin/registerState - is a grammar column now and travels
 *  in `filters`/`sorts` instead, serialised into the URL as the same JSON the wire format uses, so
 *  a filtered view stays linkable exactly as it was before.
 *
 *  `offset` stays here too: this page keeps its own pager rather than `useTableState`'s `page`,
 *  because `useTableState` has no way to START on a page restored from a link. */
type FacilitiesUrlState = Pick<FacilityListQuery, 'q' | 'health' | 'nationalSystem'> & { offset: number };

/** The three values `health` accepts on the wire - used to validate whatever `?health=` a restored
 *  URL carries, the same closed-whitelist reasoning as the server's own `isFacilityHealth`
 *  (facilities-routes.ts): an arbitrary query string must never reach `listFacilities` as a `health`
 *  value the store doesn't understand. */
const HEALTH_VALUES: readonly NonNullable<FacilityListQuery['health']>[] = ['mapped', 'unmapped', 'unprojected'];
function isHealthValue(v: string): v is NonNullable<FacilityListQuery['health']> {
  return (HEALTH_VALUES as readonly string[]).includes(v);
}

/** `Facility.source`'s two values, backing the Source column's filter picker. Not clinical
 *  vocabulary (AGENTS.md section 8): this is the application's own record of how a row entered the
 *  registry, owned by `Facility['source']` in api.ts, not by the terminology service. */
const SOURCE_VALUES: readonly NonNullable<Facility['source']>[] = ['manual', 'import'];
const SOURCE_LABEL_KEYS: Record<NonNullable<Facility['source']>, string> = {
  manual: 'facilities.filters.sourceManual',
  import: 'facilities.filters.sourceImport',
};

/** Task 10: `facility_registry.register_state`'s three codes (migration 081's
 *  `FACILITY_REGISTER_STATE_*` constants, `@openldr/db`) - hand-duplicated here rather than
 *  imported, the same "closed vocabulary the client mirrors, not shares" reasoning `SOURCE_VALUES`
 *  above already follows: `@openldr/db`'s root export pulls in `kysely`/`pg`, which this browser
 *  bundle must not depend on. */
const REGISTER_STATE_VALUES = ['in_register', 'dropped', 'not_registered'] as const;

/** Each register-state code's i18n key, in the SAME fixed order the picker's options render in -
 *  a `Record` over `REGISTER_STATE_VALUES`'s own type (not a second hand-typed list) so the two
 *  cannot drift: dropping a value from `REGISTER_STATE_VALUES` makes this object's now-extra key
 *  fail to compile, and adding one there without a matching entry here does too. */
const REGISTER_STATE_LABEL_KEYS: Record<(typeof REGISTER_STATE_VALUES)[number], string> = {
  in_register: 'facilities.filters.registerStateInRegister',
  dropped: 'facilities.filters.registerStateDropped',
  not_registered: 'facilities.filters.registerStateNotRegistered',
};

/** One `?filters=`/`?sorts=` parameter, decoded to a plain array. Anything malformed - not JSON,
 *  not an array, truncated by a mail client - yields an empty list rather than throwing: a
 *  hand-edited or mangled link must degrade to "no filter", never to a blank page. */
function decodeRuleArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRuleValue(v: unknown): v is FilterRule['value'] {
  return typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
}

/** Rebuild the grammar filters a URL carries into `FilterRule`s. Validated against
 *  `FACILITY_COLUMNS` - the server's OWN whitelist, so this rejects exactly what the route's
 *  `parseTableQuery` would 400 on, and a link nobody can act on never reaches the network. The
 *  wire shape has no `id` (`ParsedFilter` is `Omit<FilterRule, 'id'>`), so one is minted here for
 *  React keys when the URL does not already carry it. */
function readFiltersFromUrl(raw: string | null): FilterRule[] {
  const out: FilterRule[] = [];
  for (const entry of decodeRuleArray(raw)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.column !== 'string' || !Object.prototype.hasOwnProperty.call(FACILITY_COLUMNS, r.column)) continue;
    const spec = FACILITY_COLUMNS[r.column]!;
    if (typeof r.operator !== 'string' || !spec.operators.includes(r.operator as FilterOperator)) continue;
    if (!isRuleValue(r.value)) continue;
    out.push({
      id: typeof r.id === 'string' ? r.id : newId('f'),
      column: r.column,
      operator: r.operator as FilterOperator,
      value: r.value,
      combine: r.combine === 'or' ? 'or' : 'and',
    });
  }
  return out;
}

/** The sort half of the same restore. A rule naming a column the server will not sort on is
 *  dropped for the same reason a bad filter is. */
function readSortsFromUrl(raw: string | null): SortRule[] {
  const out: SortRule[] = [];
  for (const entry of decodeRuleArray(raw)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.column !== 'string' || !Object.prototype.hasOwnProperty.call(FACILITY_COLUMNS, r.column)) continue;
    if (!FACILITY_COLUMNS[r.column]!.sortable) continue;
    out.push({ id: typeof r.id === 'string' ? r.id : newId('s'), column: r.column, ascending: r.ascending !== false });
  }
  return out;
}

/** Read the named params back out of the current URL - the mirror of `writeUrlState` below. Used
 *  once, on mount, so a linked/reloaded filtered view restores exactly what it showed when it was
 *  shared. An invalid/absent `offset` (non-numeric, negative) falls back to 0 rather than throwing
 *  or passing NaN through to `listFacilities`. */
function readUrlState(): FacilitiesUrlState {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  const health = params.get('health');
  const nationalSystem = params.get('nationalSystem');
  const offsetRaw = Number(params.get('offset'));
  return {
    q: q ?? '',
    health: health != null && isHealthValue(health) ? health : undefined,
    // No compile-time union to validate against, and none needed: this is passed straight through
    // as an exact-match `where` server-side (facility-registry-store.ts), so a value the registry
    // has never seen simply matches zero rows rather than doing anything unsafe.
    nationalSystem: nationalSystem || undefined,
    offset: Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0,
  };
}

/** Important 2 (Task 5 review): the named params this page USED to accept, each of which is a
 *  `FACILITY_COLUMNS` column now. Every param name here is also its column id, so this list IS the
 *  mapping.
 *
 *  ⛔ READ-SIDE ONLY. Nothing writes these back out: the JSON `filters` form is the going-forward
 *  format, and this is a compatibility shim so a link saved or bookmarked before Task 5 —
 *  `/facilities?zone=Central` — still opens filtered. Without it that link loads the entire
 *  register with nothing on screen saying a filter was dropped.
 *
 *  `q`, `health`, `nationalSystem` and `offset` are deliberately NOT in this list. They never
 *  became grammar columns; `readUrlState` above still reads them as named params, unchanged. */
const LEGACY_FILTER_PARAMS = [
  'source', 'country', 'zone', 'region', 'district', 'council',
  'status', 'level', 'ownership', 'managedOrigin', 'registerState',
] as const;

/** Turn any surviving legacy named param into the `eq` grammar rule it always meant — the named
 *  params were exact matches server-side (facility-registry-store.ts's `list`), so `eq` is what
 *  they translate to and nothing else. Validated against `FACILITY_COLUMNS` for the same reason
 *  `readFiltersFromUrl` is: a rule the route would 400 on must never reach the network. */
function readLegacyFiltersFromUrl(params: URLSearchParams, already: FilterRule[]): FilterRule[] {
  const out: FilterRule[] = [];
  for (const name of LEGACY_FILTER_PARAMS) {
    const raw = params.get(name);
    if (!raw) continue;
    const spec = FACILITY_COLUMNS[name];
    if (!spec || !spec.operators.includes('eq')) continue;
    // A URL carrying BOTH forms for one column can only be hand-assembled — nothing generates it.
    // The grammar rule wins: it is the newer and the more expressive of the two.
    if (already.some((f) => f.column === name)) continue;
    out.push({ id: newId('f'), column: name, operator: 'eq', value: raw, combine: 'and' });
  }
  return out;
}

/** The grammar half of the same mount-time restore. */
function readUrlGrammar(): { filters: FilterRule[]; sorts: SortRule[] } {
  const params = new URLSearchParams(window.location.search);
  const filters = readFiltersFromUrl(params.get('filters'));
  return {
    filters: [...filters, ...readLegacyFiltersFromUrl(params, filters)],
    sorts: readSortsFromUrl(params.get('sorts')),
  };
}

/** Minor 5 (Task 5 review): `FilterRule.id`/`SortRule.id` are CLIENT-ONLY React keys. The wire
 *  types are `ParsedFilter`/`ParsedSort` (`Omit<…, 'id'>`), but TypeScript's excess-property check
 *  does not fire on a non-literal, so passing `FilterRule[]` straight through compiled fine and put
 *  a `f_1755…_abc123` token in every request and every shared link. Stripped once, here, for both
 *  the request and the URL. */
const toWireFilters = (rules: FilterRule[]): ParsedFilter[] => rules.map(({ id: _id, ...rest }) => rest);
const toWireSorts = (rules: SortRule[]): ParsedSort[] => rules.map(({ id: _id, ...rest }) => rest);

/** Write the named params AND the grammar rules back to the URL via `history.replaceState` - a
 *  REPLACE, not a push, so paging through the registry does not fill the browser's back-button
 *  history with one entry per page. No key is ever written for an empty/default value (blank
 *  search, "All", offset 0, no rules), so the URL for the default view stays plain `/facilities`.
 *
 *  `filters`/`sorts` carry the SAME JSON `listFacilities` puts on the wire (api.ts), so a shared
 *  link is reproducible: what the URL says is exactly what the request sends — including Minor 5's
 *  id strip, so a link never carries a client-only React key either. Empty arrays are omitted
 *  rather than written as `[]`, same reasoning as the client. */
function writeUrlState(state: FacilitiesUrlState, filters: FilterRule[], sorts: SortRule[]): void {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.health) params.set('health', state.health);
  if (state.nationalSystem) params.set('nationalSystem', state.nationalSystem);
  if (filters.length > 0) params.set('filters', JSON.stringify(toWireFilters(filters)));
  if (sorts.length > 0) params.set('sorts', JSON.stringify(toWireSorts(sorts)));
  if (state.offset > 0) params.set('offset', String(state.offset));
  const qs = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

/** Fix wave 1 / Finding 3: debounce window for every free-text filter input — search plus the
 *  open-vocabulary filters added for Finding 1 (nationalSystem/managedOrigin/ownership/status/
 *  level/country). 250ms is the low end of the conventional 250-300ms range: long enough to
 *  collapse a typing burst into one request against a 13k-row table, short enough that results
 *  still feel live. Applied uniformly, not just to `q` — every one of these fields hits the same
 *  endpoint on every keystroke, so the rationale that motivated debouncing search applies equally
 *  to the rest; leaving them un-debounced would just move Finding 3's problem to six other inputs. */
const FILTER_DEBOUNCE_MS = 250;

/** Fix wave 1 / Finding 3: keeps a text filter input responsive to every keystroke while only
 *  committing into `urlState` (and therefore only firing `reload()`, via the effect below) after
 *  `FILTER_DEBOUNCE_MS` of inactivity. `committedValue` is `urlState`'s own field — the draft
 *  re-syncs to it whenever it changes from OUTSIDE this input (URL restore on mount is the only
 *  such case today), but never while a debounce is in flight, so that re-sync can never stomp a
 *  keystroke the operator is mid-typing.
 *
 *  ⚠ Debouncing narrows the WINDOW for two requests to race; it does not make an out-of-order
 *  response safe by itself — `reload()`'s own generation guard (Finding 2, below) is what actually
 *  protects `rows`/`total` from being overwritten by a stale response. The two are complementary,
 *  not substitutes for each other. */
function useDebouncedFilterField(
  committedValue: string,
  commit: (value: string) => void,
): [string, (value: string) => void] {
  const [draft, setDraft] = useState(committedValue);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (timerRef.current) return;
    setDraft(committedValue);
  }, [committedValue]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const onChange = (value: string) => {
    setDraft(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      commit(value);
    }, FILTER_DEBOUNCE_MS);
  };

  return [draft, onChange];
}

/** Task 11: icon for each `FacilityDimensionState` — status is never conveyed by colour alone, so
 *  every state pairs this icon with its own text label (see `FacilityHealthChip` below). */
const HEALTH_ICON: Record<FacilityDimensionState, typeof CheckCircle2> = {
  current: CheckCircle2,
  updating: Loader2,
  failed: XCircle,
  stale: AlertTriangle,
};

/** How often the health chip re-checks while a rebuild is in flight. Only ever armed while the state
 *  is `updating` (see the effect below), so this is not a background poll the page pays for at rest —
 *  it runs for the seconds a rebuild takes and then stops. Comfortably longer than the worker's own
 *  3s tick (packages/bootstrap/src/facility-job-worker.ts), so a typical rebuild resolves within one
 *  or two polls. */
const HEALTH_POLL_MS = 5000;

/** Task 4 (scale): rows requested per page. A national register runs 10-15k rows (Slice 1), so the
 *  registry table is server-paged rather than fetched-and-rendered whole (the previous
 *  `FACILITIES_LIST_LIMIT`/`truncated`-banner approach this replaced). Deliberately NOT paired with
 *  virtualization: the audit that raised this (FAC-P1-01) permits virtualization only as a
 *  rendering optimization on top of real server paging, never as a substitute for it — and at 50
 *  rows on screen at once, virtualizing the `<table>` buys nothing a browser can't already do
 *  natively; it would only add a dependency and a second thing to keep in sync with `rows`.
 *  50 itself is an unremarkable default, not derived from a measurement — comfortably small for a
 *  render, comfortably large that flipping pages to scan a register doesn't feel tedious. */
const PAGE_SIZE = 50;

/** Same formatting convention as Sites.tsx's own `formatDate` — locale-formatted, falling back to
 *  the raw ISO string if `Date` can't parse it rather than showing nothing. */
function formatBuildTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Task 11: what makes FAC-P0-08 observable — the report-facing `facility_map` dimension's own
 *  freshness, previously visible nowhere an operator could see it. `projection.failedCount` is
 *  rendered as its own element, deliberately never folded into the state chip: a failed
 *  per-facility projection must never make the WHOLE dimension read as failed (see
 *  packages/bootstrap/src/facility-health.ts). */
function FacilityHealthChip({
  health, canManage, retryingJobId, onRetry,
}: {
  health: FacilityHealth;
  canManage: boolean;
  /** The job id currently being retried, or null. Compared against a SPECIFIC id at every use — a
   *  bare `retrying` boolean read as true whenever both sides were null, which was harmless only
   *  because the one button that consumed it was already gated on a non-null `jobId`. */
  retryingJobId: string | null;
  onRetry: (jobId: string) => void;
}) {
  const { t } = useTranslation();
  const { reportDimension: dim, projection } = health;
  const Icon = HEALTH_ICON[dim.state];

  return (
    /* ⚠ `flex-wrap` plus `whitespace-nowrap` on each piece. In its own row on a phone this still
       needs two lines — the label and the timestamp do not fit in 328px together — but the break
       now falls BETWEEN them instead of inside the label, which read as
       "Facility data in reports: / Current". Wrapping as units, not mid-phrase. */
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <Badge variant="outline" className="gap-1.5 whitespace-nowrap font-medium">
        <Icon className={dim.state === 'updating' ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
        {t('facilities.health.chipLabel', { state: t(`facilities.health.states.${dim.state}`) })}
      </Badge>
      <span className="whitespace-nowrap text-muted-foreground">
        {dim.lastSuccessAt
          ? t('facilities.health.lastBuilt', { time: formatBuildTime(dim.lastSuccessAt) })
          : t('facilities.health.neverBuilt')}
      </span>
      {dim.state === 'failed' && canManage && dim.jobId && (
        <Button
          variant="outline" size="sm" className="h-6 px-2 text-xs"
          disabled={retryingJobId === dim.jobId}
          onClick={() => onRetry(dim.jobId!)}
        >
          {retryingJobId === dim.jobId ? t('facilities.health.retrying') : t('facilities.health.retry')}
        </Button>
      )}
      {/* ⛔ One Retry PER FAILED PROJECTION, not one for the group. Projection jobs coalesce per
          facility, so N broken facilities are N separate jobs with N separate ids — a single action
          could only ever repair one of them and would leave the rest permanently unfixable from
          here. The count keeps its own element (never folded into the state chip: a failed
          per-facility projection must not make the WHOLE dimension read as failed — see
          packages/bootstrap/src/facility-health.ts), and each row names the facility it is about so
          the operator can tell which lab is missing from the picker. */}
      {projection.failedCount > 0 && (
        <span className="flex items-center gap-1 text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          {t('facilities.health.failedProjections', { count: projection.failedCount })}
        </span>
      )}
      {canManage && projection.failed.map((job) => (
        <Button
          key={job.id}
          variant="outline" size="sm" className="h-6 px-2 text-xs"
          disabled={retryingJobId === job.id}
          onClick={() => onRetry(job.id)}
        >
          {retryingJobId === job.id
            ? t('facilities.health.retrying')
            : t('facilities.health.retryProjection', { facility: job.registryId ?? '—' })}
        </Button>
      ))}
    </div>
  );
}

export function Facilities() {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  // The route/nav are gated on facilities.view alone, so every viewer with view access reaches
  // this page — data_analyst and system_auditor hold facilities.view WITHOUT facilities.manage
  // (see packages/rbac/src/presets.ts). Add/Edit/Delete must check this separately, or those
  // roles get a full Add/Edit form experience that only 403s on the final Save.
  const canManage = hasCapability('facilities.manage');

  const [rows, setRows] = useState<Facility[]>([]);
  // Exact count matching the current search/filters (Task 3's `total`), independent of how many
  // rows this page actually got back — the pager's Next control and the "N of TOTAL" summary both
  // read this, not `rows.length`, so a short last page never misreports how much is left.
  const [total, setTotal] = useState(0);
  // Task 4 (scale): search/filter/page state — initialised from the URL ONCE on mount (a function
  // initialiser, not a plain default, so `readUrlState()` runs exactly once rather than on every
  // render) and written back to it whenever it changes (see the effect below `reload`). This is what
  // makes a filtered, paged view linkable and reload-safe.
  const [urlState, setUrlState] = useState<FacilitiesUrlState>(() => readUrlState());
  const [loading, setLoading] = useState(true);
  const [hasForm, setHasForm] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<Facility | null | undefined>(undefined); // undefined = closed
  const [confirming, setConfirming] = useState<Facility | null>(null);
  // Task 10: which row's History sheet is open, or `undefined` when closed — mirrors `editing`'s
  // own undefined-means-closed convention. Unlike `editing`, this is reachable to EVERY viewer who
  // reaches this page at all (facilities.view alone), not just `canManage` — see the per-row ⋯
  // menu below for why History rides that menu regardless of capability.
  const [viewingHistory, setViewingHistory] = useState<Facility | undefined>(undefined);
  // Task 10: the Status column's terminology display-label lookup — see facility-code-labels.ts's
  // own doc comment for why the ValueSet id is a frozen, hardcoded literal.
  const statusDisplayMap = useCodeDisplayMap(FACILITY_STATUS_VALUESET_ID);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Task: one `⋯` on the TAB STRIP itself, right-aligned, instead of each tab wasting a second
  // header row purely to host its own. The strip owns ONE portal target; whichever tab is actually
  // mounted (Radix unmounts the inactive `TabsContent`'s whole subtree — see the comment on
  // `TabsContent` below) is the only one that ever portals a menu into it, so the Registry menu and
  // the Observed tab's Scan/Publish menu can never both be present at once, and each keeps its own
  // items without merging into a combined menu (the operator's explicit instruction). A DOM node
  // (not a ref) because `createPortal` needs an actual element to target, and only `useState`'s
  // setter re-renders the children that are waiting on it — a plain `useRef` would leave them
  // permanently rendering against `null`.
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null);

  // Task 11: the report-dimension health chip's own data. Fetched independently of `reload()`
  // above — the chip describes the WAREHOUSE-side `facility_map` dimension, not the registry rows
  // `reload()` fetches, so the two are never coupled. `null` while unloaded/on a failed fetch: the
  // chip simply doesn't render rather than showing stale or fabricated state (this is a secondary
  // signal on the page, not something worth its own error banner).
  const [health, setHealth] = useState<FacilityHealth | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  const reloadHealth = useCallback(async () => {
    try {
      setHealth(await getFacilityHealth());
    } catch {
      setHealth(null);
    }
  }, []);

  // No dedicated mount effect for the chip: `reload()` below refreshes health and runs on mount, so
  // a second one here would only make every first paint issue two identical health requests.

  // ⛔ `Updating` is a TRANSIENT state, so a chip that only refreshes on mount and after a Retry can
  // never actually show it resolving: an operator who saves a facility, applies an import or edits a
  // mapping watches a frozen chip until they reload the page. The whole justification for
  // enqueue-plus-worker over an inline rebuild is that the stale window becomes visible and bounded
  // instead of silent — that only holds if this polls while the window is open.
  //
  // Bounded deliberately: the interval only exists while the state IS `updating`, and the cleanup
  // clears it both when the state leaves `updating` (the effect re-runs on the new state) and on
  // unmount. `cancelled` guards the in-flight fetch separately — clearInterval cannot recall a
  // request already in the air, and resolving it after unmount would set state on a dead component.
  useEffect(() => {
    if (health?.reportDimension.state !== 'updating') return;
    let cancelled = false;
    const timer = setInterval(() => { if (!cancelled) void reloadHealth(); }, HEALTH_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [health?.reportDimension.state, reloadHealth]);

  const retryHealthJob = useCallback(async (jobId: string) => {
    setRetryingJobId(jobId);
    try {
      await retryFacilityJob(jobId);
      await reloadHealth();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetryingJobId(null);
    }
  }, [reloadHealth]);

  // Option values for the four administrative-area filter pickers. Declared here, above the column
  // defs that consume them; the effects that fill them live further down, next to their own
  // explanation.
  const [zoneOptions, setZoneOptions] = useState<string[]>([]);
  const [regionOptions, setRegionOptions] = useState<string[]>([]);
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);
  const [councilOptions, setCouncilOptions] = useState<string[]>([]);

  /** Task 5: the registry's columns, for BOTH the table and the shared toolbar.
   *
   *  ⛔ `operators` comes from `FACILITY_COLUMNS`, never from `validOperators(type)`. That map is
   *  the server's own whitelist, so the Filter popover cannot offer an operator the route would
   *  400 on. `column-map-agreement.test.ts` pins that the map never exceeds what a type allows;
   *  taking `operators` from the map here is what makes that guarantee reach this page.
   *
   *  The six `defaultVisible` ones are exactly the table's previous `<TableHead>` list, so the
   *  visible table does not change shape. The rest are hidden by default but filterable and
   *  sortable — they are the dimensions the old "More filters" disclosure held, now reachable
   *  through the Filter popover and the Columns picker instead of a bespoke panel.
   *
   *  ⚠ `country`/`level`/`ownership`/`managedOrigin` are `type: 'text'` here while
   *  `FACILITY_COLUMNS` types them `enum`. Deliberate, and it changes nothing the server sees: the
   *  ColumnDef `type` only decides which VALUE WIDGET the popover renders, and `operators` is
   *  pinned to the map's enum list regardless. These four have no value set anywhere in this app —
   *  the panel they replace used a free-text `Input` for each — and an `enum` ColumnDef with no
   *  `enumOptions` renders an empty picker with nothing to choose. Inventing an option list for
   *  them would be hardcoding vocabulary this registry cannot promise is complete.
   *
   *  ⚠ C4 (whole-branch review): `zone`/`region`/`district`/`council` fall back to `text` when their
   *  option list is empty. `enum` IS right for these once populated — their options are the
   *  register's OWN distinct values, read back from `listFacilityAdminValues`, so a picked value
   *  always exists in the column. But each of the four effects below `.catch`es into `[]`, so one
   *  failed `GET /api/facilities/admin-values` used to leave all four rendering an empty Select with
   *  nothing to choose — the same dead end C1 was about, and two of the four (`region`, `district`)
   *  are default-visible columns. Only the failure path changes; a populated list still picks. */
  const columns: ColumnDef<Facility>[] = useMemo(() => ([
    {
      id: 'code', labelKey: 'facilities.code', type: 'text', defaultVisible: true, cellClassName: 'text-xs',
      // One code, no fallback. `localCode ?? nationalCode` lived here, and it is what let this
      // column show a code the Edit sheet could not bind — the defect this whole arc started from.
      accessor: (f) => f.facilityCode ?? '—',
      operators: FACILITY_COLUMNS.code!.operators,
    },
    {
      id: 'name', labelKey: 'facilities.name', type: 'text', defaultVisible: true, cellClassName: 'text-xs',
      accessor: (f) => f.name,
      operators: FACILITY_COLUMNS.name!.operators,
    },
    {
      // C4: `enum` only while the register actually returned distinct values — see the note above.
      id: 'region', labelKey: 'facilities.region', type: regionOptions.length > 0 ? 'enum' : 'text', defaultVisible: true, cellClassName: 'text-xs',
      accessor: (f) => f.region ?? '—',
      enumOptions: regionOptions.map((value) => ({ value, label: value })),
      operators: FACILITY_COLUMNS.region!.operators,
    },
    {
      // C4: `enum` only while the register actually returned distinct values — see the note above.
      id: 'district', labelKey: 'facilities.district', type: districtOptions.length > 0 ? 'enum' : 'text', defaultVisible: true, cellClassName: 'text-xs',
      accessor: (f) => f.district ?? '—',
      enumOptions: districtOptions.map((value) => ({ value, label: value })),
      operators: FACILITY_COLUMNS.district!.operators,
    },
    {
      // Task 10: the terminology DISPLAY LABEL, never the stored code — `f.status` (e.g. 'active')
      // is a `location-status`-bound code, not something an operator scanning this list should have
      // to decode.
      //
      // ⛔ `text`, ALWAYS — never the `vs-location-status` expansion as a picker.
      //
      // C1 (whole-branch review): a real register stores what it was imported with. Measured on the
      // live 3 789-row register: `Functional` (3 771), `Permanent closure` (11), `Closed` (5),
      // `Active` (1), `Temporarily closure` (1). The value set expands to `active`/`suspended`/
      // `inactive`. `packages/table-query/src/columns.ts` types `status` as `enum`, so the only
      // operators are `eq`/`ne`/`in`/`is_null` — no `like` — and the SQL is a case-sensitive
      // `coalesce(status::text,'') = $1`. So an enum picker built from the value set offered three
      // values and EVERY ONE of them returned zero rows, while the column on screen said
      // `Functional`. Status was a free-text box before this branch and typing `Functional` worked.
      //
      // Not a data defect: `packages/bootstrap/src/facility-controlled-fields.ts` deliberately keeps
      // an unmapped controlled value exactly as imported, so a mixed column is designed behaviour.
      //
      // This replaces Task 5's Minor-4 conditional (`statusOptions.length > 0 ? 'enum' : 'text'`),
      // which had it backwards: text is the right widget when terminology is UP, not only when it
      // is down. Same reasoning as `country`/`level`/`ownership`/`managedOrigin` above — see the
      // block comment on this array. Server-side nothing changes: `type` here only picks the value
      // WIDGET, and `operators` stays pinned to the `FACILITY_COLUMNS` enum list either way.
      //
      // `displayFor` stays on the cell, so the column still shows the friendly label wherever
      // terminology has one.
      id: 'status', labelKey: 'facilities.status',
      type: 'text',
      defaultVisible: true, cellClassName: 'text-xs',
      accessor: (f) => displayFor(statusDisplayMap, f.status),
      operators: FACILITY_COLUMNS.status!.operators,
    },
    {
      // Task 10: "where a facility came from" — Manual/Imported, at a glance in the list.
      id: 'source', labelKey: 'facilities.filters.sourceLabel', type: 'enum', defaultVisible: true, cellClassName: 'text-xs',
      accessor: (f) => (
        <Badge variant={f.source === 'import' ? 'default' : 'secondary'}>
          {f.source === 'import' ? t('facilities.filters.sourceImport') : t('facilities.filters.sourceManual')}
        </Badge>
      ),
      enumOptions: SOURCE_VALUES.map((value) => ({ value, labelKey: SOURCE_LABEL_KEYS[value] })),
      operators: FACILITY_COLUMNS.source!.operators,
    },
    {
      // C4: `enum` only while the register actually returned distinct values — see the note above.
      id: 'zone', labelKey: 'facilities.filters.zoneLabel', type: zoneOptions.length > 0 ? 'enum' : 'text', defaultVisible: false, cellClassName: 'text-xs',
      accessor: (f) => f.zone ?? '—',
      enumOptions: zoneOptions.map((value) => ({ value, label: value })),
      operators: FACILITY_COLUMNS.zone!.operators,
    },
    {
      // C4: `enum` only while the register actually returned distinct values — see the note above.
      id: 'council', labelKey: 'facilities.filters.councilLabel', type: councilOptions.length > 0 ? 'enum' : 'text', defaultVisible: false, cellClassName: 'text-xs',
      accessor: (f) => f.council ?? '—',
      enumOptions: councilOptions.map((value) => ({ value, label: value })),
      operators: FACILITY_COLUMNS.council!.operators,
    },
    {
      id: 'country', labelKey: 'facilities.filters.countryLabel', type: 'text', defaultVisible: false, cellClassName: 'text-xs',
      accessor: (f) => f.country ?? '—',
      operators: FACILITY_COLUMNS.country!.operators,
    },
    {
      id: 'level', labelKey: 'facilities.filters.levelLabel', type: 'text', defaultVisible: false, cellClassName: 'text-xs',
      accessor: (f) => f.level ?? '—',
      operators: FACILITY_COLUMNS.level!.operators,
    },
    {
      id: 'ownership', labelKey: 'facilities.filters.ownershipLabel', type: 'text', defaultVisible: false, cellClassName: 'text-xs',
      accessor: (f) => f.ownership ?? '—',
      operators: FACILITY_COLUMNS.ownership!.operators,
    },
    {
      id: 'managedOrigin', labelKey: 'facilities.filters.managedOriginLabel', type: 'text', defaultVisible: false, cellClassName: 'text-xs',
      accessor: (f) => f.managedOrigin ?? '—',
      operators: FACILITY_COLUMNS.managedOrigin!.operators,
    },
    {
      // Task 10: registry MEMBERSHIP — a closed, three-value vocabulary this app owns, so it keeps
      // a real picker.
      id: 'registerState', labelKey: 'facilities.filters.registerStateLabel', type: 'enum', defaultVisible: false, cellClassName: 'text-xs',
      accessor: (f) => {
        const key = REGISTER_STATE_LABEL_KEYS[f.registerState as (typeof REGISTER_STATE_VALUES)[number]];
        return key ? t(key) : f.registerState ?? '—';
      },
      enumOptions: REGISTER_STATE_VALUES.map((value) => ({ value, labelKey: REGISTER_STATE_LABEL_KEYS[value] })),
      operators: FACILITY_COLUMNS.registerState!.operators,
    },
    {
      // The per-row ⋯ menu. A `__`-prefixed id, which `useTableState`/`ColumnPickerPopover` treat as
      // always visible and never offer to hide, and neither filterable nor sortable — it is not a
      // column of the registry, it is the row's actions.
      //
      // Task 10: this menu is ALWAYS rendered, unlike Add/Import (still hard-gated on canManage) —
      // History rides it too, and `GET /api/facilities/:id/history` only requires `facilities.view`,
      // which every viewer reaching this page already holds. Edit/Delete stay inside their own
      // `canManage` guard, unchanged.
      id: '__actions', labelKey: 'facilities.actions', type: 'text', defaultVisible: true,
      filterable: false, sortable: false, headClassName: 'w-12',
      accessor: (f) => (
        // stopPropagation so opening the menu does not also fire the row's click-to-edit handler.
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`${t('facilities.actions')} ${f.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setViewingHistory(f)}>{t('facilities.history.menuItem')}</DropdownMenuItem>
              {canManage && (
                <>
                  <DropdownMenuItem disabled={!hasForm} onClick={() => setEditing(f)}>{t('common.edit')}</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirming(f)}>
                    {t('common.delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ]), [t, statusDisplayMap, zoneOptions, regionOptions, districtOptions, councilOptions, canManage, hasForm]);

  // Task 5: the shared table state. `defaultFilters`/`defaultSorts` come from the URL exactly once,
  // on mount, which is what makes a shared grammar-filtered link restore — and what `resetAll`
  // restores back to. Paging is NOT taken from here (see `FacilitiesUrlState`).
  const [initialGrammar] = useState(readUrlGrammar);
  const table = useTableState({
    columns, defaultPageSize: PAGE_SIZE,
    defaultFilters: initialGrammar.filters,
    defaultSorts: initialGrammar.sorts,
  });

  /** The value an `eq` grammar rule currently pins `column` to, or undefined. Only `eq` narrows a
   *  scope: `in`/`ne`/`is_null` do not name one value to cascade the next level's options by. */
  const eqFilterValue = (column: string): string | undefined => {
    const rule = table.filters.find((f) => f.column === column && f.operator === 'eq');
    return typeof rule?.value === 'string' && rule.value !== '' ? rule.value : undefined;
  };
  const zoneFilter = eqFilterValue('zone');
  const regionFilter = eqFilterValue('region');
  const districtFilter = eqFilterValue('district');

  // Applying a filter or a sort invalidates whatever page of the OLD result set the operator was
  // on — the same `offset` reset every named filter on this page already does.
  const applyFilters = (next: FilterRule[]) => { table.setFilters(next); setUrlState((s) => ({ ...s, offset: 0 })); };
  const applySorts = (next: SortRule[]) => { table.setSorts(next); setUrlState((s) => ({ ...s, offset: 0 })); };
  /** Minor 3 (Task 5 review): Reset clears EVERYTHING this page filters on, not just the grammar.
   *
   *  Deliberately not `table.resetAll()`. That restores `defaultFilters`, which on this page is
   *  whatever grammar the URL carried on mount (`useTableState.ts`) — so on a page opened from a
   *  filtered link, Reset put that link's filters back instead of clearing them. `setFilters([])`
   *  and `setSorts([])` clear outright; `resetColumns()` covers the visibility half that
   *  `resetAll` also did.
   *
   *  `q`, `health` and `nationalSystem` go with them. They are three more filters the operator can
   *  see applied, and a button labelled Reset that leaves them in effect reads as a bug. */
  const resetTable = () => {
    table.setFilters([]);
    table.setSorts([]);
    table.resetColumns();
    setUrlState({ q: '', health: undefined, nationalSystem: undefined, offset: 0 });
  };

  // F1 fix: a plain `reload()` flips `loading` to true, which the render below turns into a
  // full-page `LoadingState` that UNMOUNTS everything else on the page — including a currently-open
  // ImportFacilitiesSheet. That's fine (desirable, even) for the very first load, but the sheet's
  // own onImported callback also calls this after a successful Apply specifically so the operator
  // can see the sheet's own "Import complete" panel with its created/updated counts — a reload that
  // unmounts the sheet mid-callback destroys that confirmation before the operator ever sees it, and
  // the sheet then remounts fresh (no applyResult) once loading flips back to false. `background:
  // true` fetches the same data without touching `loading` at all, so the sheet — and everything
  // else already on screen — stays mounted through the refresh.
  //
  // Fix wave 1 / Finding 2: `reloadGenerationRef` is a per-call sequencing guard, not an
  // `AbortController` — `apiGet`/`authFetch` (api.ts) have no `signal` plumbing today, and adding
  // one would mean threading it through every caller of that shared helper, not just this one call
  // site. Every invocation of `reload()` — the mount effect, every `urlState` change (a keystroke
  // that survived its debounce, a filter pick, a page click), and the Import sheet's own
  // `onImported` background reload — bumps this ref and captures its own value in `myGeneration`. A
  // response is only applied to `rows`/`total`/`error` if the ref STILL holds that exact value when
  // it resolves; a later call bumps it first, so an out-of-order response (issued earlier, resolved
  // later — entirely plausible against a 13k-row table under load) is silently dropped instead of
  // overwriting fresher data the operator is already looking at. Debouncing the filter inputs
  // (`useDebouncedFilterField`, above) only narrows how often two requests are in flight at once —
  // it is this guard, not the debounce, that makes an actual race safe.
  const reloadGenerationRef = useRef(0);
  const reload = useCallback(async (opts?: { background?: boolean }) => {
    const myGeneration = ++reloadGenerationRef.current;
    if (!opts?.background) setLoading(true);
    // Every caller of `reload()` follows a mutation that makes the report dimension stale — a
    // create, an edit, a delete, or the import sheet's onImported — and each of those enqueues a
    // rebuild server-side. Refreshing the chip here is what lets the operator SEE that happen; it
    // used to run on mount and after a Retry only, so the chip sat frozen through every mutation on
    // the page. Deliberately not awaited into the same try: a health-endpoint outage must not be
    // reported as a failure to list facilities (`reloadHealth` contains its own errors).
    void reloadHealth();
    try {
      const page = await listFacilities({
        // The three named params with no grammar column (see `FacilitiesUrlState`). They are ANDed
        // with the grammar rules server-side, never replaced by them.
        q: urlState.q || undefined,
        health: urlState.health,
        nationalSystem: urlState.nationalSystem,
        // Task 5: the shared grammar. Applied by the server — this page is server-paginated, so it
        // must never filter or sort the fetched page in the browser: that would filter one page
        // while `total` kept claiming the unfiltered count. Minor 5: `toWireFilters`/`toWireSorts`
        // drop the client-only `id`, so what goes out matches the declared `ParsedFilter[]` type.
        filters: toWireFilters(table.filters),
        sorts: toWireSorts(table.sorts),
        limit: PAGE_SIZE,
        offset: urlState.offset,
      });
      // A later `reload()` call already superseded this one — e.g. this request was issued for an
      // earlier keystroke/filter and resolved after a subsequent one. Applying it now would
      // silently overwrite the subsequent (fresher) rows/total with stale ones while the URL and
      // the search box already show the newer query — exactly the mismatch Finding 2 named.
      if (reloadGenerationRef.current !== myGeneration) return;
      setRows(page.rows);
      setTotal(page.total);
      setError(null);
    } catch (e) {
      if (reloadGenerationRef.current !== myGeneration) return;
      setError(e instanceof Error ? e.message : String(e));
      // Rows/total already on screen (if any) are left as-is — they're from the last successful
      // load, not this failed one.
    } finally {
      // ⛔ Deliberately NOT `&& !opts?.background`. Only a non-background call ever SETS `loading`,
      // but any call may be the one that CLEARS it — the two are not symmetric, and pairing them
      // stranded the spinner permanently whenever a blocking reload was superseded by a background
      // one. The blocking call's guard fails here (a later generation exists), the background
      // successor declines to touch `loading` by design, and nothing else ever clears it: the panel
      // renders `LoadingState` forever while the rows sit fetched and discarded.
      //
      // That is not a rare race. `<StrictMode>` (apps/studio/src/main.tsx) runs every mount effect
      // TWICE and preserves refs across the simulated remount, so the second run reads
      // `isFirstLoad.current === false` and issues exactly that background successor — making this
      // reproduce on EVERY dev page load, not just under a filter-vs-first-load overlap (typing in
      // the search box before the first page lands hits it in production too).
      //
      // Clearing on whichever generation is still current is correct in both directions: if
      // `loading` was true, the newest response has just landed and been applied, which is precisely
      // when the spinner should go; if it was already false (a pure background refresh), this is a
      // no-op. Superseded calls still return early above, so a stale response can never clear a
      // spinner a fresher blocking call is legitimately still showing.
      if (reloadGenerationRef.current === myGeneration) setLoading(false);
    }
  }, [reloadHealth, urlState, table.filters, table.sorts]);

  // `reload` changes identity on every `urlState` change (search keystroke, filter pick, page
  // click), and this effect re-fires accordingly — but only the VERY FIRST call (the initial page
  // load) should be a blocking `loading` reload. Every later one is triggered while the operator is
  // actively using the search box or pager, and a blocking reload flips `registryLoading`, which
  // swaps the ENTIRE panel for a `LoadingState` — the search input included. That unmounted the box
  // the operator was mid-keystroke in, dropping every character typed after the first (measured:
  // this is exactly what made the "puts search state in the URL" test below flake on anything past
  // one character). `background: true` for every reload after the first keeps the table/toolbar
  // mounted and lets the new page's rows replace the old ones once they arrive, instead.
  const isFirstLoad = useRef(true);
  useEffect(() => {
    void reload({ background: !isFirstLoad.current });
    isFirstLoad.current = false;
  }, [reload]);

  // Task 4 (scale): mirror `urlState` into the URL on every change (search, filter, page) — see
  // `writeUrlState`'s own doc comment for why this is a `replaceState`, not a `pushState`. Separate
  // from the `reload()` effect above (which ALSO depends on `urlState` and re-fetches) so the two
  // stay independently readable: this one owns the URL, that one owns the network call.
  useEffect(() => { writeUrlState(urlState, table.filters, table.sorts); }, [urlState, table.filters, table.sorts]);

  // Fix wave 1 / Finding 3: one `useDebouncedFilterField` per free-text NAMED filter. Only two are
  // left — `q` and `nationalSystem`, the ones with no grammar column. Everything else that used to
  // need one now commits through the Filter popover's own Apply button, which fires once instead of
  // per keystroke. Each commit resets `offset` to 0: changing what is being searched for
  // invalidates whatever page of the OLD result set the operator was on.
  const [searchDraft, onSearchDraftChange] = useDebouncedFilterField(
    urlState.q ?? '',
    (v) => setUrlState((s) => ({ ...s, q: v, offset: 0 })),
  );
  const [nationalSystemDraft, onNationalSystemDraftChange] = useDebouncedFilterField(
    urlState.nationalSystem ?? '',
    (v) => setUrlState((s) => ({ ...s, nationalSystem: v || undefined, offset: 0 })),
  );

  // Fix wave 1 / Finding 1: option values for the four administrative-area filters come from the
  // existing `distinctAdminValues` store helper (via `listFacilityAdminValues`, already used by
  // `FacilityDialog` through `useFacilityAdminSuggestions`) — the mechanism the design names
  // explicitly, reused here rather than a second one. Not the hook itself: that hook cascades
  // options against a `FormSchema`'s `suggest` fields and an `onAnswersChange` callback, neither of
  // which exists on this page. Cascading follows the same fixed hierarchy (zone < region < district
  // < council) as the form's own suggestions: a level's scope is every level ABOVE it, never itself
  // or below.
  //
  // ⚠ WHEN THESE RUN, AND WHAT THAT COSTS. They used to be gated on the "More filters" disclosure
  // being open, so a page load with the panel collapsed paid nothing. That disclosure is gone, and
  // `DataTableToolbar` exposes no "the Filter popover opened" signal, so the options have to exist
  // BEFORE the popover renders its value picker or it renders an empty, unusable Select. So these
  // four run on MOUNT: four `SELECT DISTINCT` queries per page load against a national-scale
  // register, for a popover most page loads never open.
  //
  // ⛔ THAT COST IS A DECISION, NOT AN OVERSIGHT. The Task 5 review proposed re-gating them behind
  // an arming flag latched on the first pointer-down in the toolbar row. The operator declined it
  // and chose to keep the mount-time fetches. Do not add a gate here, do not add a prop to
  // `DataTableToolbar` (Audit shares it), and do not reopen the case without the operator.
  useEffect(() => {
    let cancelled = false;
    listFacilityAdminValues('zone')
      .then((rows) => { if (!cancelled) setZoneOptions(rows.map((r) => r.value)); })
      .catch(() => { if (!cancelled) setZoneOptions([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const scope: Partial<Record<FacilityAdminLevel, string>> = {};
    if (zoneFilter) scope.zone = zoneFilter;
    listFacilityAdminValues('region', scope)
      .then((rows) => { if (!cancelled) setRegionOptions(rows.map((r) => r.value)); })
      .catch(() => { if (!cancelled) setRegionOptions([]); });
    return () => { cancelled = true; };
  }, [zoneFilter]);

  useEffect(() => {
    let cancelled = false;
    const scope: Partial<Record<FacilityAdminLevel, string>> = {};
    if (zoneFilter) scope.zone = zoneFilter;
    if (regionFilter) scope.region = regionFilter;
    listFacilityAdminValues('district', scope)
      .then((rows) => { if (!cancelled) setDistrictOptions(rows.map((r) => r.value)); })
      .catch(() => { if (!cancelled) setDistrictOptions([]); });
    return () => { cancelled = true; };
  }, [zoneFilter, regionFilter]);

  useEffect(() => {
    let cancelled = false;
    const scope: Partial<Record<FacilityAdminLevel, string>> = {};
    if (zoneFilter) scope.zone = zoneFilter;
    if (regionFilter) scope.region = regionFilter;
    if (districtFilter) scope.district = districtFilter;
    listFacilityAdminValues('council', scope)
      .then((rows) => { if (!cancelled) setCouncilOptions(rows.map((r) => r.value)); })
      .catch(() => { if (!cancelled) setCouncilOptions([]); });
    return () => { cancelled = true; };
  }, [zoneFilter, regionFilter, districtFilter]);

  // Whether a published facilities form exists is a DIFFERENT empty state from having no
  // facilities. Three independent gates can each leave a lab with no usable form (page target
  // unavailable, a form that doesn't target `facilities`, or one still sitting as a draft) —
  // merging that into the plain "no facilities yet" message is how the misconfiguration stays
  // invisible, so it gets its own title that names the cause and a link to go fix it.
  useEffect(() => {
    let cancelled = false;
    void listPublishedForms('facilities')
      .then((forms) => { if (!cancelled) setHasForm(forms.length > 0); })
      .catch(() => { if (!cancelled) setHasForm(false); });
    return () => { cancelled = true; };
  }, []);

  const upsert = (f: Facility) => setRows((prev) => {
    const i = prev.findIndex((r) => r.id === f.id);
    if (i === -1) return [...prev, f];
    const next = [...prev]; next[i] = f; return next;
  });

  const doDelete = useCallback(async () => {
    if (!confirming) return;
    const f = confirming;
    setConfirming(null);
    try {
      await deleteFacility(f.id);
      setRows((prev) => prev.filter((r) => r.id !== f.id));
      setError(null);
      // A delete enqueues a rebuild server-side, so the dimension is now `updating`. This path
      // deliberately does NOT call `reload()` (it drops the row locally instead of refetching the
      // whole list), so it has to refresh the chip itself or the mutation stays invisible.
      void reloadHealth();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [confirming, reloadHealth]);

  // Registry-only loading gate: `hasForm === null` means the listPublishedForms() effect hasn't
  // settled yet. This used to gate the WHOLE page (return before Tabs even rendered), which meant a
  // slow/failing Registry fetch (e.g. a large CSV import in flight) blocked the operator from even
  // reaching the Observed tab's trigger — see the ⛔ review finding this replaced. The tab SHELL
  // (Tabs/TabsList) now always renders below; only the Registry panel's own body swaps in
  // LoadingState while this is true, so Observed stays reachable regardless.
  const registryLoading = loading || hasForm === null;

  // Whether the operator can actually open the edit form and save it: requires facilities.manage
  // AND a published form to target. The per-row Edit menu item is `disabled={!hasForm}` and the
  // row's own click-to-edit handler is gated on this same `canEdit`, so a lab with no published
  // Facility form still sees its registry (I5, below) but cannot open the edit dialog from it — the
  // banner further down names that cause instead of leaving Add/Edit silently greyed out.
  const canEdit = canManage && !!hasForm;

  return (
    <AppShell title={t('nav.facilities')} fullBleed>
      <Tabs defaultValue="registry" className="flex min-h-0 flex-1 flex-col">
        {/* fullBleed has zero page padding (unlike the p-4/p-6 settings pages `@/components/ui/
            bleed` exists for), so `px-4` on this row lines it up with the content below — there is
            no inset to negative-margin away. The row itself carries the ONE `border-b` rule for
            both the tab labels and the `⋯` slot; `TabsList` drops its own (`border-b-0`) so the
            two don't stack into a double line. */}
        {/* ⛔ A GRID below `sm`, the old flex row from `sm` up.
            The health chip is a long state badge, a full timestamp and up to N Retry buttons. Sharing
            one row with the tabs and the ⋯ made the strip 71px tall at 360px wide, with the chip
            wrapping and the tabs squeezed to 165px. Row one is now tabs + ⋯; the chip takes row two
            at full width.
            ⚠ The chip is rendered ONCE and MOVED, never duplicated per breakpoint: it holds live
            Retry buttons, one per failed projection, and a second copy would double every one of
            them. `sm:order-*` restores the desktop sequence (tabs, health, ⋯) instead. */}
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 border-b border-border px-4 sm:flex sm:items-center">
          <TabsList className="border-b-0 sm:order-1">
            <TabsTrigger value="registry">{t('facilities.tabs.registry')}</TabsTrigger>
            <TabsTrigger value="observed">{t('facilities.tabs.observed')}</TabsTrigger>
          </TabsList>
          {/* Portal target for whichever tab's `⋯` menu is currently mounted — see `actionsEl`'s
              doc comment above. */}
          <div ref={setActionsEl} className="flex items-center justify-self-end sm:order-3" />
          {health && (
            <div
              className="col-span-2 pb-2 sm:order-2 sm:ml-auto sm:pb-0"
              data-testid="facility-health-slot"
            >
              <FacilityHealthChip
                health={health}
                canManage={canManage}
                retryingJobId={retryingJobId}
                onRetry={(jobId) => void retryHealthJob(jobId)}
              />
            </div>
          )}
        </div>

        {/* The `TabsContent` primitive (components/ui/tabs.tsx) now defends against the
            flex-vs-[hidden] specificity trap (commit 5fc72756) itself via
            `data-[state=inactive]:hidden` (specificity 0,2,0, which beats a plain `.flex`
            utility at 0,1,0 regardless of source order), so TabsContent itself can safely be the
            flex container that hands height down to its children — without `flex flex-col`
            here, the inner wrappers' `flex-1`/`h-full` have no flex/definite-height context to
            resolve against, which is what left the Observed table sized to its content instead
            of filling the pane (pagination stranded above a blank region). */}
        <TabsContent value="registry" className="flex min-h-0 flex-1 flex-col">
        {registryLoading ? (
          <LoadingState className="flex-1" label={t('common.loading')} />
        ) : (
        <div className="flex min-h-0 h-full flex-col">
        {/* Task: the ⋯ now lives on the shared tab strip (see `actionsEl` above), not a second
            header row here — portaled only while THIS panel is actually mounted (Radix unmounts
            the inactive `TabsContent`, so the Observed tab's own menu can never be portaled into
            the same node at the same time; the two stay entirely separate menus, never merged). */}
        {canManage && actionsEl && createPortal(
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('facilities.actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!hasForm} onSelect={() => setEditing(null)}>
                {t('facilities.add')}
              </DropdownMenuItem>
              {/* No `!hasForm` gate here, unlike Add above — importing writes core facility
                  columns directly (@openldr/bootstrap's importFacilities), not through the
                  Facilities form, so a lab with rows already imported but its form later
                  archived can still re-import (e.g. a refreshed national register). */}
              <DropdownMenuItem onSelect={() => setImporting(true)}>
                {t('facilities.import.menuItem')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>,
          actionsEl,
        )}

        {/* Task 5: one shared toolbar — search, Filter, Sort, Columns, Reset — in place of this
            page's own twelve-control panel. Every dimension with a column in `FACILITY_COLUMNS`
            reaches the server as a grammar rule through the Filter popover; the two that have no
            such column keep their own controls on the row below it. The toolbar's `actions` slot is
            left empty on purpose: this page's ⋯ is portalled to the tab strip above (see
            `actionsEl`), so putting a second one here would give the Registry tab two. */}
        <div className="flex flex-col gap-2 border-b border-border px-4 py-2">
          <DataTableToolbar
            columns={columns}
            filters={table.filters}
            onFiltersChange={applyFilters}
            sorts={table.sorts}
            onSortsChange={applySorts}
            visibleIds={table.visibleIds}
            onVisibleIdsChange={table.setVisibleIds}
            onResetColumns={table.resetColumns}
            onResetAll={resetTable}
            searchValue={searchDraft}
            onSearchChange={onSearchDraftChange}
            searchPlaceholder={t('facilities.searchPlaceholder')}
          />
          {/* ⛔ The two filters with NO grammar column. `health` is a DERIVED mapping state, not a
              stored column, and `nationalSystem` is not on the grammar whitelist — both stay named
              params and keep their own controls beside the toolbar rather than being faked into the
              popover, where the server would reject them. */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={urlState.health ?? 'all'}
              // `isHealthValue` (not a cast): Radix types `onValueChange` as `(value: string) =>
              // void` regardless of what the mounted `SelectItem`s actually offer, so TS cannot
              // narrow `v` on its own — the same closed-whitelist predicate `readUrlState` uses.
              onValueChange={(v) => setUrlState((s) => ({ ...s, health: v !== 'all' && isHealthValue(v) ? v : undefined, offset: 0 }))}
            >
              <SelectTrigger aria-label={t('facilities.filters.healthLabel')} className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('facilities.filters.healthAll')}</SelectItem>
                <SelectItem value="mapped">{t('facilities.filters.healthMapped')}</SelectItem>
                <SelectItem value="unmapped">{t('facilities.filters.healthUnmapped')}</SelectItem>
                <SelectItem value="unprojected">{t('facilities.filters.healthUnprojected')}</SelectItem>
              </SelectContent>
            </Select>
            {/* An open `Input`, not a `Select`: a FILTER over already-stored rows must still match
                values written before the register picklist existed, or by a register since
                deactivated, so restricting it to the CURRENT active-source list would hide rows this
                registry genuinely holds. */}
            <Input
              value={nationalSystemDraft}
              onChange={(e) => onNationalSystemDraftChange(e.target.value)}
              placeholder={t('facilities.filters.nationalSystemPlaceholder')}
              aria-label={t('facilities.filters.nationalSystemLabel')}
              className="h-8 w-56 text-xs"
            />
          </div>
          {/* A sibling of the toolbar, not part of it — a page can render the toolbar and silently
              omit the chips, which is what `expectStandardTableToolbar` guards against. Renders
              nothing at all when no filter is set. */}
          <ActiveFilterChips columns={columns} filters={table.filters} onChange={applyFilters} />
        </div>

        {error && (
          <div className="mx-4 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Minor 4: a lab with rows already imported but no published form sees Add/Edit greyed
            out with no explanation anywhere else on the page — this names the cause and links to
            the fix. Reuses noFormHelp/openForms (not the `noForm` title) so this stays distinct
            from the dedicated no-form EMPTY state below: I5 depends on that title never appearing
            when rows are present. */}
        {!hasForm && rows.length > 0 && (
          <div className="mx-4 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            <span>{t('facilities.noFormHelp')}</span>
            <Link to="/forms" className="shrink-0 underline underline-offset-2">{t('facilities.openForms')}</Link>
          </div>
        )}

        {/* No padding here: the striped EmptyState below fills this wrapper, and the repo
            convention is that empty-state hatching and table borders bleed to the pane edges.
            A `p-4` here insets the stripes by 16px on every side (and Users.tsx, the page this
            mirrors, deliberately has none). */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {rows.length > 0 ? (
            <Table wrapperClassName="min-h-0 flex-1">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  {table.visibleColumns.map((c) => (
                    // `__actions` carries a label for the Columns picker's sake but shows no header
                    // text — same as the bare <TableHead className="w-12" /> it replaces.
                    <TableHead key={c.id} className={c.headClassName}>
                      {c.id.startsWith('__') ? null : t(c.labelKey)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b">
                {rows.map((f) => (
                  <TableRow
                    key={f.id}
                    className={canEdit ? 'cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]' : undefined}
                    onClick={canEdit ? () => setEditing(f) : undefined}
                  >
                    {table.visibleColumns.map((c) => (
                      <TableCell key={c.id} className={c.cellClassName}>{c.accessor(f)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : !hasForm ? (
            // No rows AND no published form: the no-form state must name its own cause (see the
            // ⛔ test) rather than fall into the same "no facilities yet" message a lab with a
            // working form and an empty registry would see.
            <EmptyState
              icon={<Building2 className="h-6 w-6" />}
              title={t('facilities.noForm')}
              body={t('facilities.noFormHelp')}
              action={<Link to="/forms" className="text-xs underline underline-offset-2">{t('facilities.openForms')}</Link>}
            />
          ) : (
            <EmptyState
              icon={<Building2 className="h-6 w-6" />}
              title={t('facilities.empty')}
              body={t('facilities.emptyHelp')}
              action={canManage ? <Button size="sm" onClick={() => setEditing(null)}>{t('facilities.add')}</Button> : undefined}
            />
          )}
        </div>

        {/* Task 4 (scale): the pager. Gated on `total > 0`, not `rows.length > 0` — a filter whose
            OFFSET has drifted past a now-smaller result set (e.g. the operator deleted rows on this
            page, or narrowed a filter) can leave `rows` empty with `total` still positive; the pager
            stays put in that case instead of vanishing along with the table, so Previous is still
            reachable to get back to real data. Steps by PAGE_SIZE, not by `page.limit` from the last
            response — this page always REQUESTS PAGE_SIZE, so the two never disagree, and stepping
            off the constant keeps this independent of the server's echo. */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs">
            <span className="text-muted-foreground">
              {t('facilities.pager.summary', {
                from: urlState.offset + 1,
                // M5 (whole-branch review): computed off `rows.length` (what THIS page actually
                // got back), not the requested `PAGE_SIZE`. A bookmarked `?offset=100` whose rows
                // were since deleted can leave `total` smaller than `offset` — with `PAGE_SIZE` here
                // that reads "101–50 of 50" above an empty table; `rows.length` (0 in that case)
                // keeps `to` from ever exceeding what was actually returned.
                to: Math.min(urlState.offset + rows.length, total),
                total,
              })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="sm" className="h-7 text-xs"
                onClick={() => setUrlState((s) => ({ ...s, offset: Math.max(0, s.offset - PAGE_SIZE) }))}
                disabled={urlState.offset === 0}
              >
                {t('common.previous')}
              </Button>
              <Button
                variant="outline" size="sm" className="h-7 text-xs"
                onClick={() => setUrlState((s) => ({ ...s, offset: s.offset + PAGE_SIZE }))}
                disabled={urlState.offset + PAGE_SIZE >= total}
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        )}

        {editing !== undefined && (
          <FacilityDialog
            open
            facility={editing}
            onOpenChange={(o) => { if (!o) setEditing(undefined); }}
            // Same reasoning as `doDelete` above: a create/edit enqueues a rebuild server-side, and
            // this path merges the saved row in locally rather than going through `reload()`, so the
            // chip has to be refreshed here or a save leaves it frozen.
            onSaved={(f) => { upsert(f); setEditing(undefined); void reloadHealth(); }}
          />
        )}

        {importing && (
          <ImportFacilitiesSheet
            open
            onOpenChange={setImporting}
            onImported={() => { void reload({ background: true }); }}
          />
        )}

        {viewingHistory !== undefined && (
          <FacilityHistory
            open
            onOpenChange={(o) => { if (!o) setViewingHistory(undefined); }}
            facilityId={viewingHistory.id}
            facilityName={viewingHistory.name}
          />
        )}

        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(o) => { if (!o) setConfirming(null); }}
          title={t('facilities.deleteTitle', { name: confirming?.name ?? '' })}
          description={t('facilities.deleteBody', { name: confirming?.name ?? '' })}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={() => { void doDelete(); }}
        />
        </div>
        )}
        </TabsContent>

        {/* ObservedTab supplies its own `flex min-h-0 flex-1 flex-col` root div, but that
            `flex-1` is inert unless ITS parent (this TabsContent) is a flex container — see the
            comment on the registry TabsContent above for why `flex flex-col` is safe here now
            that the primitive defends `[hidden]` itself. */}
        <TabsContent value="observed" className="flex min-h-0 flex-1 flex-col">
          <ObservedTab actionsPortalTarget={actionsEl} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

export default Facilities;
