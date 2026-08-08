import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Building2, CheckCircle2, Loader2, XCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { useAuth } from '@/auth/AuthProvider';
import {
  listFacilities, deleteFacility, listPublishedForms, getFacilityHealth, retryFacilityJob,
  FACILITIES_LIST_LIMIT, type Facility, type FacilityHealth, type FacilityDimensionState,
} from '@/api';
import { FacilityDialog } from '@/facilities/FacilityDialog';
import { ImportFacilitiesSheet } from '@/facilities/ImportFacilitiesSheet';
import { ObservedTab } from '@/facilities/ObservedTab';

/** Task 11: icon for each `FacilityDimensionState` — status is never conveyed by colour alone, so
 *  every state pairs this icon with its own text label (see `FacilityHealthChip` below). */
const HEALTH_ICON: Record<FacilityDimensionState, typeof CheckCircle2> = {
  current: CheckCircle2,
  updating: Loader2,
  failed: XCircle,
  stale: AlertTriangle,
};

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
  health, canManage, retrying, onRetry,
}: {
  health: FacilityHealth;
  canManage: boolean;
  retrying: boolean;
  onRetry: () => void;
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
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={retrying} onClick={onRetry}>
          {retrying ? t('facilities.health.retrying') : t('facilities.health.retry')}
        </Button>
      )}
      {projection.failedCount > 0 && (
        <span className="flex items-center gap-1 text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          {t('facilities.health.failedProjections', { count: projection.failedCount })}
        </span>
      )}
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
  const [loading, setLoading] = useState(true);
  const [hasForm, setHasForm] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<Facility | null | undefined>(undefined); // undefined = closed
  const [confirming, setConfirming] = useState<Facility | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the last list() hit the client-requested cap (FACILITIES_LIST_LIMIT) — a CSV-imported
  // national register can run 10-15k rows, and presenting a capped page with no indication anything
  // was cut is its own defect distinct from "no rows at all". See listFacilities in api.ts.
  const [truncated, setTruncated] = useState(false);
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

  useEffect(() => { void reloadHealth(); }, [reloadHealth]);

  const retryHealthJob = useCallback(async () => {
    const jobId = health?.reportDimension.jobId;
    if (!jobId) return;
    setRetryingJobId(jobId);
    try {
      await retryFacilityJob(jobId);
      await reloadHealth();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetryingJobId(null);
    }
  }, [health, reloadHealth]);

  // F1 fix: a plain `reload()` flips `loading` to true, which the render below turns into a
  // full-page `LoadingState` that UNMOUNTS everything else on the page — including a currently-open
  // ImportFacilitiesSheet. That's fine (desirable, even) for the very first load, but the sheet's
  // own onImported callback also calls this after a successful Apply specifically so the operator
  // can see the sheet's own "Import complete" panel with its created/updated counts — a reload that
  // unmounts the sheet mid-callback destroys that confirmation before the operator ever sees it, and
  // the sheet then remounts fresh (no applyResult) once loading flips back to false. `background:
  // true` fetches the same data without touching `loading` at all, so the sheet — and everything
  // else already on screen — stays mounted through the refresh.
  const reload = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    try {
      const data = await listFacilities();
      setRows(data);
      setTruncated(data.length >= FACILITIES_LIST_LIMIT);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Rows already on screen (if any) are left as-is — they're from the last successful load, not
      // this failed one — but the truncated flag describes a specific fetched row count, and this
      // fetch produced none. Leaving a stale `true` here would keep claiming "showing the first N"
      // for data this attempt never actually saw, outliving the row set it was measured against.
      setTruncated(false);
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [confirming]);

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
                retrying={retryingJobId === health.reportDimension.jobId}
                onRetry={() => void retryHealthJob()}
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

        {error && (
          <div className="mx-4 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {truncated && (
          <div className="mx-4 mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            {t('facilities.truncated', { limit: FACILITIES_LIST_LIMIT })}
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

        {editing !== undefined && (
          <FacilityDialog
            open
            facility={editing}
            onOpenChange={(o) => { if (!o) setEditing(undefined); }}
            onSaved={(f) => { upsert(f); setEditing(undefined); }}
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
