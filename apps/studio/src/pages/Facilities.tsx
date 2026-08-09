import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Building2, CheckCircle2, Loader2, XCircle, AlertTriangle, SlidersHorizontal } from 'lucide-react';
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

/** Fix wave 1 / Finding 1: every filter dimension `GET /api/facilities` accepts (Task 3), minus
 *  paging — held as page state (below) and read from/written to the URL so a filtered view is
 *  linkable and survives reload. Previously only `q`/`health`/`source` were represented here; the
 *  rest of `FacilityListQuery` (country/zone/region/district/council/status/level/ownership/
 *  nationalSystem/managedOrigin) is now included too — see the toolbar JSX below for how each is
 *  presented and why. */
type FacilitiesUrlState = Pick<FacilityListQuery,
  | 'q' | 'health' | 'source' | 'country' | 'zone' | 'region' | 'district' | 'council'
  | 'status' | 'level' | 'ownership' | 'nationalSystem' | 'managedOrigin'
> & { offset: number };

/** Fix wave 1: the open-vocabulary filter keys — everything on `FacilitiesUrlState` besides `q`,
 *  the two closed-union fields (`health`/`source`, which keep their own dedicated
 *  `isHealthValue`/`isSourceValue` predicates), and `offset`. Declared once so `readUrlState`,
 *  `writeUrlState` and the "how many extra filters are active" badge count all iterate the exact
 *  same list instead of three hand-kept ones that could drift out of sync. */
const OPEN_VOCAB_FILTER_KEYS = [
  'country', 'zone', 'region', 'district', 'council', 'status', 'level', 'ownership',
  'nationalSystem', 'managedOrigin',
] as const satisfies readonly (keyof FacilitiesUrlState)[];

/** The three values `health` accepts on the wire — used to validate whatever `?health=` a restored
 *  URL carries, the same closed-whitelist reasoning as the server's own `isFacilityHealth`
 *  (facilities-routes.ts): an arbitrary query string must never reach `listFacilities` as a `health`
 *  value the store doesn't understand. */
const HEALTH_VALUES: readonly NonNullable<FacilityListQuery['health']>[] = ['mapped', 'unmapped', 'unprojected'];
function isHealthValue(v: string): v is NonNullable<FacilityListQuery['health']> {
  return (HEALTH_VALUES as readonly string[]).includes(v);
}
const SOURCE_VALUES: readonly NonNullable<Facility['source']>[] = ['manual', 'import'];
function isSourceValue(v: string): v is NonNullable<Facility['source']> {
  return (SOURCE_VALUES as readonly string[]).includes(v);
}

/** Read `q`/`health`/`source`/the open-vocabulary filters/`offset` back out of the current URL —
 *  the mirror of `writeUrlState` below. Used once, on mount, so a linked/reloaded filtered view
 *  restores exactly what it showed when it was shared. An invalid/absent `offset` (non-numeric,
 *  negative) falls back to 0 rather than throwing or passing NaN through to `listFacilities`. The
 *  open-vocabulary keys (country/zone/.../managedOrigin) have no compile-time union to validate
 *  against the way `health`/`source` do — unlike those two, an arbitrary `?zone=` value is not a
 *  security or correctness concern here: it is passed straight through as an exact-match `where`
 *  filter server-side (facility-registry-store.ts), so a value the registry has never seen simply
 *  matches zero rows rather than doing anything unsafe. */
function readUrlState(): FacilitiesUrlState {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  const health = params.get('health');
  const source = params.get('source');
  const offsetRaw = Number(params.get('offset'));
  const state: FacilitiesUrlState = {
    q: q ?? '',
    health: health != null && isHealthValue(health) ? health : undefined,
    source: source != null && isSourceValue(source) ? source : undefined,
    offset: Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0,
  };
  for (const key of OPEN_VOCAB_FILTER_KEYS) {
    const raw = params.get(key);
    if (raw) state[key] = raw;
  }
  return state;
}

/** Write `state` back to the URL via `history.replaceState` — a REPLACE, not a push, so paging
 *  through the registry does not fill the browser's back-button history with one entry per page. No
 *  key is ever written for an empty/default value (blank search, "All", offset 0), so the URL for
 *  the default view stays plain `/facilities` rather than `/facilities?q=&health=&offset=0`. */
function writeUrlState(state: FacilitiesUrlState): void {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.health) params.set('health', state.health);
  if (state.source) params.set('source', state.source);
  for (const key of OPEN_VOCAB_FILTER_KEYS) {
    const v = state[key];
    if (v) params.set(key, v);
  }
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
    <div className="flex items-center gap-2 text-xs">
      <Badge variant="outline" className="gap-1.5 font-medium">
        <Icon className={dim.state === 'updating' ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
        {t('facilities.health.chipLabel', { state: t(`facilities.health.states.${dim.state}`) })}
      </Badge>
      <span className="text-muted-foreground">
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
  // Fix wave 1 / Finding 1: whether the disclosure panel holding the ten open-vocabulary filters
  // (country/zone/region/district/council/status/level/ownership/nationalSystem/managedOrigin) is
  // expanded. Initialised open when a restored URL already carries one of them — a shared link with
  // `?zone=Dodoma` should show the filter that produced it, not hide it behind a closed toggle the
  // operator has to know to open. Otherwise collapsed by default: twelve always-visible controls
  // (the two closed-vocabulary selects plus these ten) would be its own usability defect.
  const [showMoreFilters, setShowMoreFilters] = useState(
    () => OPEN_VOCAB_FILTER_KEYS.some((key) => !!readUrlState()[key]),
  );
  const [loading, setLoading] = useState(true);
  const [hasForm, setHasForm] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<Facility | null | undefined>(undefined); // undefined = closed
  const [confirming, setConfirming] = useState<Facility | null>(null);
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
        q: urlState.q || undefined,
        health: urlState.health,
        source: urlState.source,
        country: urlState.country,
        zone: urlState.zone,
        region: urlState.region,
        district: urlState.district,
        council: urlState.council,
        status: urlState.status,
        level: urlState.level,
        ownership: urlState.ownership,
        nationalSystem: urlState.nationalSystem,
        managedOrigin: urlState.managedOrigin,
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
      if (reloadGenerationRef.current === myGeneration && !opts?.background) setLoading(false);
    }
  }, [reloadHealth, urlState]);

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
  useEffect(() => { writeUrlState(urlState); }, [urlState]);

  // Fix wave 1 / Finding 3: one `useDebouncedFilterField` per free-text filter — `q` plus the six
  // open-vocabulary fields that have no fixed vocabulary to back a Select (see the toolbar JSX
  // below for `zone`/`region`/`district`/`council`, which DO get one, populated from
  // `listFacilityAdminValues`). Each commit resets `offset` to 0: changing what's being searched
  // for invalidates whatever page of the OLD result set the operator was on, same as every other
  // filter on this page already does.
  const [searchDraft, onSearchDraftChange] = useDebouncedFilterField(
    urlState.q ?? '',
    (v) => setUrlState((s) => ({ ...s, q: v, offset: 0 })),
  );
  const [nationalSystemDraft, onNationalSystemDraftChange] = useDebouncedFilterField(
    urlState.nationalSystem ?? '',
    (v) => setUrlState((s) => ({ ...s, nationalSystem: v || undefined, offset: 0 })),
  );
  const [managedOriginDraft, onManagedOriginDraftChange] = useDebouncedFilterField(
    urlState.managedOrigin ?? '',
    (v) => setUrlState((s) => ({ ...s, managedOrigin: v || undefined, offset: 0 })),
  );
  const [ownershipDraft, onOwnershipDraftChange] = useDebouncedFilterField(
    urlState.ownership ?? '',
    (v) => setUrlState((s) => ({ ...s, ownership: v || undefined, offset: 0 })),
  );
  const [statusDraft, onStatusDraftChange] = useDebouncedFilterField(
    urlState.status ?? '',
    (v) => setUrlState((s) => ({ ...s, status: v || undefined, offset: 0 })),
  );
  const [levelDraft, onLevelDraftChange] = useDebouncedFilterField(
    urlState.level ?? '',
    (v) => setUrlState((s) => ({ ...s, level: v || undefined, offset: 0 })),
  );
  const [countryDraft, onCountryDraftChange] = useDebouncedFilterField(
    urlState.country ?? '',
    (v) => setUrlState((s) => ({ ...s, country: v || undefined, offset: 0 })),
  );

  // Fix wave 1 / Finding 1: option values for the four administrative-area filters come from the
  // existing `distinctAdminValues` store helper (via `listFacilityAdminValues`, already used by
  // `FacilityDialog` through `useFacilityAdminSuggestions`) — the mechanism §5 of the design names
  // explicitly, reused here rather than a second one. Not the hook itself: that hook cascades
  // options against a `FormSchema`'s `suggest` fields and an `onAnswersChange` callback, neither of
  // which exists on this page — reusing `listFacilityAdminValues` (the primitive the hook itself
  // calls) is what "reuse the mechanism" means here, without forcing a filter toolbar to pretend to
  // be a form. Cascading follows the same fixed hierarchy (zone < region < district < council) as
  // the form's own suggestions: a level's scope is every level ABOVE it, never itself or below —
  // Region is scoped by Zone alone, District by Zone+Region, Council by Zone+Region+District.
  //
  // Gated on `showMoreFilters`: these four fetches only run once the disclosure panel that shows
  // them has actually been opened, so the common case (panel collapsed, no admin-area filter in
  // play) never issues four requests a national-scale register would rather not pay for on every
  // page load. Re-opening the panel re-fetches (this does not cache "already open once") — a small,
  // accepted redundancy in exchange for not having to invent separate fetched-once bookkeeping for
  // four short, cheap lists.
  const [zoneOptions, setZoneOptions] = useState<string[]>([]);
  const [regionOptions, setRegionOptions] = useState<string[]>([]);
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);
  const [councilOptions, setCouncilOptions] = useState<string[]>([]);

  useEffect(() => {
    if (!showMoreFilters) return;
    let cancelled = false;
    listFacilityAdminValues('zone')
      .then((rows) => { if (!cancelled) setZoneOptions(rows.map((r) => r.value)); })
      .catch(() => { if (!cancelled) setZoneOptions([]); });
    return () => { cancelled = true; };
  }, [showMoreFilters]);

  useEffect(() => {
    if (!showMoreFilters) return;
    let cancelled = false;
    const scope: Partial<Record<FacilityAdminLevel, string>> = {};
    if (urlState.zone) scope.zone = urlState.zone;
    listFacilityAdminValues('region', scope)
      .then((rows) => { if (!cancelled) setRegionOptions(rows.map((r) => r.value)); })
      .catch(() => { if (!cancelled) setRegionOptions([]); });
    return () => { cancelled = true; };
  }, [showMoreFilters, urlState.zone]);

  useEffect(() => {
    if (!showMoreFilters) return;
    let cancelled = false;
    const scope: Partial<Record<FacilityAdminLevel, string>> = {};
    if (urlState.zone) scope.zone = urlState.zone;
    if (urlState.region) scope.region = urlState.region;
    listFacilityAdminValues('district', scope)
      .then((rows) => { if (!cancelled) setDistrictOptions(rows.map((r) => r.value)); })
      .catch(() => { if (!cancelled) setDistrictOptions([]); });
    return () => { cancelled = true; };
  }, [showMoreFilters, urlState.zone, urlState.region]);

  useEffect(() => {
    if (!showMoreFilters) return;
    let cancelled = false;
    const scope: Partial<Record<FacilityAdminLevel, string>> = {};
    if (urlState.zone) scope.zone = urlState.zone;
    if (urlState.region) scope.region = urlState.region;
    if (urlState.district) scope.district = urlState.district;
    listFacilityAdminValues('council', scope)
      .then((rows) => { if (!cancelled) setCouncilOptions(rows.map((r) => r.value)); })
      .catch(() => { if (!cancelled) setCouncilOptions([]); });
    return () => { cancelled = true; };
  }, [showMoreFilters, urlState.zone, urlState.region, urlState.district]);

  // How many of the ten open-vocabulary filters are currently active — shown as a badge on the
  // disclosure toggle so an operator who collapses the panel doesn't lose visibility that a filter
  // from it is still in effect.
  const extraFilterCount = OPEN_VOCAB_FILTER_KEYS.filter((key) => !!urlState[key]).length;

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
        <div className="flex items-center justify-between border-b border-border px-4">
          <TabsList className="border-b-0">
            <TabsTrigger value="registry">{t('facilities.tabs.registry')}</TabsTrigger>
            <TabsTrigger value="observed">{t('facilities.tabs.observed')}</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-3">
            {health && (
              <FacilityHealthChip
                health={health}
                canManage={canManage}
                retryingJobId={retryingJobId}
                onRetry={(jobId) => void retryHealthJob(jobId)}
              />
            )}
            {/* Portal target for whichever tab's `⋯` menu is currently mounted — see `actionsEl`'s
                doc comment above. */}
            <div ref={setActionsEl} className="flex items-center" />
          </div>
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

        {/* Fix wave 1 / Finding 1: search plus the two closed-vocabulary filters (`health`
            'mapped'/'unmapped'/'unprojected', a fixed union owned by facility-registry-store.ts,
            and `source` 'manual'/'import', `Facility.source`) stay on this always-visible row —
            they are the two most-used filters and the only ones with a real TypeScript union to
            drive a `Select` with zero extra fetch. Every other spec-named dimension
            (nationalSystem/managedOrigin/ownership/status/level/country/zone/region/district/
            council) now lives behind the disclosure toggle below rather than nowhere: twelve
            always-visible controls would be its own usability defect (per review), but zero of the
            other ten was worse — every one of them is reachable and round-trips through the URL
            exactly like these two already did. Every input resets `offset` to 0 on commit —
            changing what's being searched for invalidates whatever page of the OLD result set the
            operator was on. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <Input
            type="search"
            value={searchDraft}
            onChange={(e) => onSearchDraftChange(e.target.value)}
            placeholder={t('facilities.searchPlaceholder')}
            aria-label={t('facilities.searchPlaceholder')}
            className="h-8 w-60 text-xs"
          />
          <Select
            value={urlState.health ?? 'all'}
            // `isHealthValue` (not a cast): Radix types `onValueChange` as `(value: string) => void`
            // regardless of what the mounted `SelectItem`s actually offer, so TS cannot narrow `v` on
            // its own — the same closed-whitelist predicate `readUrlState` uses above narrows it for
            // real instead of asserting it.
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
          <Select
            value={urlState.source ?? 'all'}
            // Same reasoning as the health Select's `onValueChange` above.
            onValueChange={(v) => setUrlState((s) => ({ ...s, source: v !== 'all' && isSourceValue(v) ? v : undefined, offset: 0 }))}
          >
            <SelectTrigger aria-label={t('facilities.filters.sourceLabel')} className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('facilities.filters.sourceAll')}</SelectItem>
              <SelectItem value="manual">{t('facilities.filters.sourceManual')}</SelectItem>
              <SelectItem value="import">{t('facilities.filters.sourceImport')}</SelectItem>
            </SelectContent>
          </Select>
          {/* A disclosure toggle, not an action — it changes nothing about the data, only what's
              visible, the same category as the pager buttons beside it further down. Badge count
              (Finding 1) is what keeps an active filter from that panel visible even while the
              panel itself is collapsed. */}
          <Button
            type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
            onClick={() => setShowMoreFilters((v) => !v)}
            aria-expanded={showMoreFilters}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t('facilities.filters.moreFiltersToggle')}
            {extraFilterCount > 0 && (
              <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px]">{extraFilterCount}</Badge>
            )}
          </Button>
        </div>

        {/* Fix wave 1 / Finding 1: the ten open-vocabulary filters, behind the disclosure toggle
            above. `nationalSystem` — the audit's actual "registry source" per the design's own
            provenance table, distinct from `source` above ("how did this row get into OUR
            registry") — is deliberately NOT promoted to the always-visible row alongside it: it has
            no closed vocabulary (see ImportFacilitiesSheet's own National system field, which is
            free text for the same reason), so it gets an `Input` here rather than a `Select`, and a
            free-text control on the primary row would read as a second search box. `zone`/`region`/
            `district`/`council` get a `Select` because they DO have a source of real values —
            `listFacilityAdminValues`, fetched above once this panel is open. The rest
            (`status`/`level`/`ownership`/`country`/`managedOrigin`) have no vocabulary at all (same
            reasoning the store's own `FacilityListOptions.q` doc comment gives for the admin
            columns) and stay free text — a `Select` for any of them would mean hardcoding an option
            list this registry cannot promise is complete. */}
        {showMoreFilters && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-2">
            <Input
              value={nationalSystemDraft}
              onChange={(e) => onNationalSystemDraftChange(e.target.value)}
              placeholder={t('facilities.filters.nationalSystemPlaceholder')}
              aria-label={t('facilities.filters.nationalSystemLabel')}
              className="h-8 w-36 text-xs"
            />
            <Input
              value={managedOriginDraft}
              onChange={(e) => onManagedOriginDraftChange(e.target.value)}
              placeholder={t('facilities.filters.managedOriginPlaceholder')}
              aria-label={t('facilities.filters.managedOriginLabel')}
              className="h-8 w-36 text-xs"
            />
            <Input
              value={ownershipDraft}
              onChange={(e) => onOwnershipDraftChange(e.target.value)}
              placeholder={t('facilities.filters.ownershipPlaceholder')}
              aria-label={t('facilities.filters.ownershipLabel')}
              className="h-8 w-32 text-xs"
            />
            <Input
              value={statusDraft}
              onChange={(e) => onStatusDraftChange(e.target.value)}
              placeholder={t('facilities.filters.statusPlaceholder')}
              aria-label={t('facilities.filters.statusLabel')}
              className="h-8 w-32 text-xs"
            />
            <Input
              value={levelDraft}
              onChange={(e) => onLevelDraftChange(e.target.value)}
              placeholder={t('facilities.filters.levelPlaceholder')}
              aria-label={t('facilities.filters.levelLabel')}
              className="h-8 w-32 text-xs"
            />
            <Input
              value={countryDraft}
              onChange={(e) => onCountryDraftChange(e.target.value)}
              placeholder={t('facilities.filters.countryPlaceholder')}
              aria-label={t('facilities.filters.countryLabel')}
              className="h-8 w-24 text-xs"
            />
            <Select
              value={urlState.zone ?? 'all'}
              onValueChange={(v) => setUrlState((s) => ({ ...s, zone: v !== 'all' ? v : undefined, offset: 0 }))}
            >
              <SelectTrigger aria-label={t('facilities.filters.zoneLabel')} className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('facilities.filters.zoneAll')}</SelectItem>
                {zoneOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={urlState.region ?? 'all'}
              onValueChange={(v) => setUrlState((s) => ({ ...s, region: v !== 'all' ? v : undefined, offset: 0 }))}
            >
              <SelectTrigger aria-label={t('facilities.filters.regionLabel')} className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('facilities.filters.regionAll')}</SelectItem>
                {regionOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={urlState.district ?? 'all'}
              onValueChange={(v) => setUrlState((s) => ({ ...s, district: v !== 'all' ? v : undefined, offset: 0 }))}
            >
              <SelectTrigger aria-label={t('facilities.filters.districtLabel')} className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('facilities.filters.districtAll')}</SelectItem>
                {districtOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={urlState.council ?? 'all'}
              onValueChange={(v) => setUrlState((s) => ({ ...s, council: v !== 'all' ? v : undefined, offset: 0 }))}
            >
              <SelectTrigger aria-label={t('facilities.filters.councilLabel')} className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('facilities.filters.councilAll')}</SelectItem>
                {councilOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

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
                  <TableHead>{t('facilities.code')}</TableHead>
                  <TableHead>{t('facilities.name')}</TableHead>
                  <TableHead>{t('facilities.region')}</TableHead>
                  <TableHead>{t('facilities.district')}</TableHead>
                  <TableHead>{t('facilities.status')}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b">
                {rows.map((f) => (
                  <TableRow
                    key={f.id}
                    className={canEdit ? 'cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]' : undefined}
                    onClick={canEdit ? () => setEditing(f) : undefined}
                  >
                    <TableCell className="text-xs">{f.localCode ?? f.nationalCode ?? '—'}</TableCell>
                    <TableCell className="text-xs">{f.name}</TableCell>
                    <TableCell className="text-xs">{f.region ?? '—'}</TableCell>
                    <TableCell className="text-xs">{f.district ?? '—'}</TableCell>
                    <TableCell className="text-xs">{f.status ?? '—'}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`${t('facilities.actions')} ${f.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={!hasForm} onClick={() => setEditing(f)}>{t('common.edit')}</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirming(f)}>
                              {t('common.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
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
