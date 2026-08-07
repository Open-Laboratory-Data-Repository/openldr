import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_OBSERVED_FACILITY_SYSTEM, FACILITY_REGISTRY_SYSTEM, observedSystemForFeed } from '@openldr/db/facility-observed';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { TruncatedText } from '@/components/ui/truncated-text';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/auth/AuthProvider';
import {
  listObservedFacilities,
  scanObservedFacilities,
  publishFacilities,
  listCodingSystems,
  listTermMappings,
  deleteTermMapping,
  type ObservedFacility,
  type CodingSystem,
  type TermMapping,
} from '@/api';
import { TermMappingDialog } from '@/terminology/TermMappingDialog';

/** `district, region` (both known), or just whichever of the two is known, or `null` when
 *  neither is — never a stray leading/trailing/doubled separator. Shared by the resolved-facility
 *  detail line below and the observed-facility (pre-mapping) location line, so the two admin-area
 *  renderings can never drift apart on formatting. */
function adminAreaLine(district: string | null, region: string | null): string | null {
  return district && region ? `${district}, ${region}` : (district || region || null);
}

/**
 * The operator-visible second line under a resolved facility's name: local code (only when it
 * differs from the observed code already shown in column 1), level, and admin area
 * (district/region — whichever are populated), then the resolution route. Each part is OMITTED
 * (not rendered as an empty separator) when null — an operator disambiguating "Dodoma Regional
 * Referral" from "Dodoma Zonal Lab" needs `Hospital · Dodoma Urban, Dodoma`, not `· · Dodoma`.
 *
 * `localCode` (`facility_registry.local_code`) is single-valued and UNIQUE — the one canonical
 * short code for the facility. `row.sourceCode` (the observed string, column 1) is per-FEED: one
 * facility can be observed under several codes from several feeds. They coincide today because
 * this install only has one feed and the CSV importer never populates `local_code` at all — but
 * they are not the same thing, and once a second feed sends a different code the two will diverge
 * and BOTH are worth showing. The comparison is deliberately exact (`!==`, not case-insensitive or
 * trimmed): the observed code is stored byte-for-byte on purpose, and a normalising comparison
 * here would hide a genuine case-only difference between two codes.
 */
function facilityDetailLine(row: ObservedFacility, viaLabel: string): string {
  const adminArea = adminAreaLine(row.district, row.region);
  const localCode = row.localCode && row.localCode !== row.sourceCode ? row.localCode : null;
  return [localCode, row.level, adminArea, viaLabel].filter((part): part is string => !!part).join(' · ');
}

/**
 * The Observed tab (Facilities page). Impact-ordered view of facility strings observed in
 * ingested reports (`diagnostic_reports.performer`) — the reason this exists over the generic
 * `/terminology` page is that it can rank `Dodoma` (247 reports) ahead of `Mpwapwa` (2), which a
 * plain code list cannot. The mapping itself opens the shipped `TermMappingDialog` — no new
 * mapping UI is built here.
 *
 * Self-contained: fetches its own data, exactly like `Facilities.tsx` fetches the registry — the
 * page just switches which of the two is mounted (Radix `Tabs` unmounts the inactive one).
 */
export interface ObservedTabProps {
  /**
   * Task: `Facilities.tsx` hosts a single `⋯` on the shared tab strip instead of every tab wasting
   * a second header row purely to host its own — this is that strip's portal target.
   *
   * Three states, deliberately distinguished (not just truthy/falsy):
   * - `undefined` (prop omitted): standalone mode. Renders the OLD self-contained header row
   *   (title + menu) exactly as before, so `ObservedTab` stays a fully self-sufficient component —
   *   this is what keeps this file's own test suite (which renders `<ObservedTab />` with no
   *   parent page at all) working unchanged.
   * - `null`: integrated mode, but the parent's portal container hasn't mounted yet (its `ref`
   *   callback fires during commit, one render after the parent's own first pass) — render
   *   NEITHER the header row NOR the menu, rather than flashing the standalone header in for one
   *   frame and then tearing it back out.
   * - an `HTMLElement`: integrated mode, ready — portal ONLY the menu (no title span; the parent
   *   already dropped that row entirely) into it.
   */
  actionsPortalTarget?: HTMLElement | null;
}

export function ObservedTab({ actionsPortalTarget }: ObservedTabProps = {}): JSX.Element {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  // data_analyst/system_auditor hold facilities.view WITHOUT facilities.manage (see
  // packages/rbac/src/presets.ts) — every write affordance (scan, publish, map) must check this
  // separately from the page-level view gate, or those roles get menus that only 403 on click.
  const canManage = hasCapability('facilities.manage');

  const [rows, setRows] = useState<ObservedFacility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Client-side pagination: GET /api/facilities/observed returns the whole (already
  // reportCount-ordered) array unpaginated, so paging happens here against the fetched rows.
  // `TablePagination` is the shared primitive (components/ui/table-pagination.tsx); no bespoke
  // pager here — see Sites.tsx for the same client-side slice pattern.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // F1's fix, reapplied here: a plain `reload()` flips `loading`, and the render below swaps in a
  // full-page `LoadingState` that unmounts everything else — including a just-opened mapping
  // dialog or a scan/publish result banner the operator hasn't read yet. `background: true` skips
  // that so a refresh after a write never blanks the screen mid-confirmation.
  const reload = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    try {
      const data = await listObservedFacilities();
      setRows(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // ── Scan / Publish (header ⋯ menu) ──────────────────────────────────────────
  const [scanning, setScanning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      // `apply: true` — the operator already sees the impact-ordered table before choosing this
      // action, unlike a CSV upload whose CONTENT they haven't seen yet, so there is no separate
      // preview step here (see the CSV import sheet for that pattern).
      const result = await scanObservedFacilities({ apply: true });
      // Branch on the COUNTERS, never the HTTP status — a scan that discovers zero new codes is
      // still a 200, and the banner must say so honestly rather than a bare "done".
      setActionResult(t('facilities.observed.scanDone', { ...result }));
      // The underlying row set just changed (new codes discovered) — an operator sitting on page 3
      // must not be stranded past the new last page.
      setPage(0);
      await reload({ background: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [reload, t]);

  const runPublish = useCallback(async () => {
    setPublishing(true);
    setError(null);
    try {
      const result = await publishFacilities({ apply: true });
      setActionResult(t('facilities.observed.publishDone', { ...result }));
      setPage(0);
      await reload({ background: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }, [reload, t]);

  // ── Map / Edit mapping (row ⋯ menu → shipped TermMappingDialog) ─────────────
  const [mappingRow, setMappingRow] = useState<ObservedFacility | null>(null);
  // The FULL active coding_systems list — used ONLY to look up the FROM term's own `systemCode`
  // (below), which must resolve regardless of whether that system is a valid mapping TARGET (the
  // row's own observed system, e.g. a CDR feed's system, is never itself a facility register).
  const [mappingSystems, setMappingSystems] = useState<CodingSystem[]>([]);
  // The ONE system `TermMappingDialog` is allowed to offer as a mapping target: "we know we are
  // only linking to FACILITY_REGISTRY" — a facility mapping is never authored against anything
  // else, so the dialog gets no choice to make at all (see `TermMappingDialog`'s `lockedTargetSystem`
  // prop). This SUPERSEDES the earlier "registry plus known national registers" dropdown — a
  // national code is now an attribute of a registry row, not a separate mapping target an operator
  // picks. `resolveObservedFacilities` still resolves the national route for mappings authored
  // before this change (see that function's `knownNationalSystems`); this dialog just stops
  // offering it going forward.
  const [mappingTargetSystem, setMappingTargetSystem] = useState<CodingSystem | null>(null);
  const [mappingExisting, setMappingExisting] = useState<TermMapping | null>(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);

  const openMapping = useCallback(async (row: ObservedFacility) => {
    if (mappingLoading) return;
    setMappingLoading(true);
    setError(null);
    try {
      // Each row belongs to its OWN ingest feed (`row.sourceSystem`), and Task 9b binds every feed
      // to its own coding system — `observedSystemForFeed` derives it the same way the resolver
      // does. Looking this up under the DEFAULT system unconditionally would author a non-default
      // feed's mapping where the resolver can never find it (see the module banner on
      // `observedSystemForFeed` for the full precedence story).
      const system = observedSystemForFeed(row.sourceSystem);
      // Look up any mapping ALREADY authored for this observed code (under ITS system) so the
      // dialog opens in edit mode against it, rather than creating a second candidate row alongside
      // it — `resolveObservedFacilities` has no tiebreak for two active mappings that name
      // DIFFERENT facilities; it reports them as `ambiguous` and resolves neither.
      const [systems, mappings] = await Promise.all([
        listCodingSystems(),
        listTermMappings(system, row.sourceCode),
      ]);
      const registrySystem = systems.find((s) => s.url === FACILITY_REGISTRY_SYSTEM) ?? null;
      if (!registrySystem) {
        // Defensive only — `ensureRegistrySystemActive` (packages/bootstrap) keeps this coding_system
        // row active on every scan/publish, so a live install never reaches this branch.
        throw new Error('facility registry coding system is not active');
      }
      setMappingSystems(systems);
      setMappingTargetSystem(registrySystem);
      setMappingExisting(mappings.outgoing[0] ?? null);
      setMappingRow(row);
      setMappingDialogOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMappingLoading(false);
    }
  }, [mappingLoading]);

  // The system the currently-open row's mapping is authored against — derived from ITS
  // `sourceSystem`, not the default. Falls back to the default system's url before a row is picked
  // (dialog closed), which is harmless since `mappingSystems.find` then simply returns undefined.
  // Looks up the FULL `mappingSystems` list (not the target-restricted one) — the FROM term's own
  // system is very often NOT a valid mapping target (an observed feed's system is never itself a
  // facility register) but must still display its real code, not blank out.
  const mappingSystemUrl = mappingRow ? observedSystemForFeed(mappingRow.sourceSystem) : DEFAULT_OBSERVED_FACILITY_SYSTEM;
  const mappingSystemCode = mappingSystems.find((s) => s.url === mappingSystemUrl)?.systemCode ?? '';

  // ── Remove mapping (row ⋯ menu → ConfirmDialog, no dialog reuse) ────────────
  // The gap this closes: today the ONLY way to clear a bad mapping (e.g. the bug report's BALAB
  // self-mapping) is /terminology's own Mappings tab — an operator who spots it HERE, on the tab
  // that told them it was wrong, has no way to act on it without leaving the page.
  const [removingRow, setRemovingRow] = useState<ObservedFacility | null>(null);

  // What the confirmation names as "currently resolves to" — reuses the SAME set of states the
  // resolves-to column already renders (ambiguous / targetMissing / nonFacilityTarget / a real
  // name), so the confirmation never contradicts what the operator is looking at. The four are
  // mutually exclusive on a row (see `ResolvedFacility` in packages/bootstrap), so the order these
  // are tested in does not affect the answer. `row.name` is non-null exactly when `resolvedVia` is
  // set (the only remaining case once the others are excluded).
  const removeMappingTarget = (row: ObservedFacility): string => {
    if (row.ambiguous) return t('facilities.observed.ambiguous');
    if (row.nonFacilityTarget) return t('facilities.observed.nonFacilityTarget');
    if (row.targetMissing) return t('facilities.observed.targetMissing');
    return row.name ?? t('facilities.observed.unmapped');
  };

  // ⚠ `resolveObservedFacilities` (packages/bootstrap/src/facility-reconcile.ts) reads a LIST of
  // candidate mappings per (system, code) and resolves through at most ONE of them (registry route
  // beats a proven national route; two candidates within one route kind resolve to NOTHING and set
  // `ambiguous`; a mapping to neither kind sets `nonFacilityTarget`) — a code can carry MORE than
  // one active `term_mappings` row. Deleting only the candidate that won resolution would leave the
  // others behind, so the row could still show a (different, equally wrong) target right after the
  // operator was told "removed". Decision: "Remove mapping" clears the row back to fully unmapped by
  // deleting EVERY active outgoing candidate for that code — never just one — while leaving any
  // already-inactive mapping alone (it plays no part in resolution, and the operator never asked
  // about it).
  const doRemoveMapping = useCallback(async () => {
    if (!removingRow) return;
    const row = removingRow;
    setRemovingRow(null);
    setError(null);
    try {
      const system = observedSystemForFeed(row.sourceSystem);
      const { outgoing } = await listTermMappings(system, row.sourceCode);
      const activeIds = outgoing.filter((m) => m.isActive).map((m) => m.id);
      await Promise.all(activeIds.map((id) => deleteTermMapping(id)));
      // Background reload — see the module banner above `reload` itself: a bare `reload()` flips
      // `loading` and unmounts this panel, blanking the just-closed confirmation.
      await reload({ background: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [removingRow, reload]);

  if (loading) {
    return <LoadingState className="flex-1" label={t('common.loading')} />;
  }

  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

  // Shared between standalone (inline) and integrated (portaled) rendering below — see
  // `ObservedTabProps.actionsPortalTarget`'s doc comment for the three-state distinction.
  const actionsMenu = canManage ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('facilities.observed.actions')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={scanning} onSelect={() => void runScan()}>
          {scanning ? t('facilities.observed.scanning') : t('facilities.observed.scan')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={publishing} onSelect={() => void runPublish()}>
          {publishing ? t('facilities.observed.publishing') : t('facilities.observed.publish')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {actionsPortalTarget === undefined ? (
        // Standalone mode: no parent page supplied a portal target, so this stays the fully
        // self-contained header row it always was.
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-medium">{t('facilities.observed.title')}</span>
          {actionsMenu}
        </div>
      ) : (
        actionsPortalTarget && createPortal(actionsMenu, actionsPortalTarget)
      )}

      {error && (
        <div className="mx-4 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {actionResult && (
        <div className="mx-4 mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {actionResult}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {rows.length > 0 ? (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('facilities.observed.code')}</TableHead>
                <TableHead className="text-right">{t('facilities.observed.reports')}</TableHead>
                <TableHead>{t('facilities.observed.resolvesTo')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {pageRows.map((row) => {
                // Single source of truth for "this row already has a mapping" — same condition the
                // editMapping/map label switch below already uses, and now also the gate for
                // offering Remove mapping at all (a row with no mapping has nothing to remove).
                // Task 10: `ambiguous` counts as "has a mapping" — it means the row has two naming
                // DIFFERENT facilities, and Remove mapping (which deletes every active outgoing
                // candidate) is precisely the action the state calls for.
                //
                // ⚠ Known residual, deliberately not closed here: a row whose ONLY mappings are
                // non-SAME-AS has all four flags false (the resolver says nothing about such rows —
                // see `ResolvedFacility.ambiguous`'s ⚠ note), so it reads as "Map", not "Edit".
                // Closing it needs a NEW resolver field for the unsupported semantic, which is
                // Task 12's scope. Mitigated meanwhile: `openMapping` above passes
                // `mappings.outgoing[0]` regardless of these flags, so "Map" still opens the dialog
                // in EDIT mode against the existing row with the Map type select reachable.
                const hasMapping = !!(row.resolvedVia || row.targetMissing || row.nonFacilityTarget || row.ambiguous);
                // The location CE already knows about the OBSERVED facility itself
                // (`facilities.region`/`.district`, from `Organization.address`) — independent of any
                // curated mapping. THE point of this whole slice: DISA's five facility codes sharing
                // the display "Aga Khan" become distinguishable by district right here, BEFORE an
                // operator maps any of them. Null (renders nothing) when CE has no matching
                // `facilities` row — the common case today.
                const sourceLocation = adminAreaLine(row.sourceDistrict, row.sourceRegion);
                return (
                <TableRow key={`${row.sourceSystem}|${row.sourceCode}`}>
                  <TableCell
                    className="max-w-[220px] text-xs"
                    aria-label={
                      row.sourceDisplay && sourceLocation
                        ? t('facilities.observed.codeWithNameAndLocation', { code: row.sourceCode, name: row.sourceDisplay, location: sourceLocation })
                        : row.sourceDisplay
                          ? t('facilities.observed.codeWithName', { code: row.sourceCode, name: row.sourceDisplay })
                          : row.sourceCode
                    }
                  >
                    <div className="flex flex-col">
                      <TruncatedText text={row.sourceCode} />
                      {row.sourceDisplay && (
                        <span className="text-[11px] text-muted-foreground">{row.sourceDisplay}</span>
                      )}
                      {sourceLocation && (
                        <span className="text-[11px] text-muted-foreground">{sourceLocation}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs">{row.reportCount}</TableCell>
                  <TableCell className="text-xs">
                    {row.ambiguous ? (
                      // Task 10: active SAME-AS mappings naming DIFFERENT facilities, so the row
                      // resolves to NOTHING.
                      // Destructive styling like the other two failure states — an official report
                      // is currently missing this facility entirely, and only the operator can fix
                      // it by removing one of the mappings.
                      <span className="font-medium text-destructive">{t('facilities.observed.ambiguous')}</span>
                    ) : row.targetMissing ? (
                      <span className="font-medium text-destructive">{t('facilities.observed.targetMissing')}</span>
                    ) : row.nonFacilityTarget ? (
                      <span className="font-medium text-destructive">{t('facilities.observed.nonFacilityTarget')}</span>
                    ) : row.resolvedVia ? (
                      <div className="flex flex-col">
                        <span>{row.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {facilityDetailLine(
                            row,
                            row.resolvedVia === 'registry' ? t('facilities.observed.viaRegistry') : t('facilities.observed.viaNational'),
                          )}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{t('facilities.observed.unmapped')}</span>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`${t('facilities.observed.actions')} ${row.sourceCode}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={mappingLoading} onSelect={() => void openMapping(row)}>
                            {hasMapping ? t('facilities.observed.editMapping') : t('facilities.observed.map')}
                          </DropdownMenuItem>
                          {hasMapping && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setRemovingRow(row)}
                            >
                              {t('facilities.observed.removeMapping')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : error ? null : (
          // Mutually exclusive with the error banner above: "run a scan to discover facilities"
          // actively misdirects an operator whose load just failed for network reasons — there is
          // nothing to scan into fixing that. See ObservedTab.test.tsx's "surfaces a load error".
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={t('facilities.observed.empty')}
            body={t('facilities.observed.emptyHelp')}
          />
        )}
      </div>

      <TablePagination
        page={page}
        pageSize={pageSize}
        total={rows.length}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
        leftSlot={<span className="text-muted-foreground">{t('facilities.observed.count', { count: rows.length })}</span>}
      />

      {mappingRow && (
        <TermMappingDialog
          open={mappingDialogOpen}
          onOpenChange={(o) => { setMappingDialogOpen(o); if (!o) setMappingRow(null); }}
          fromTerm={{
            system: mappingSystemUrl,
            code: mappingRow.sourceCode,
            display: mappingRow.sourceCode,
            systemCode: mappingSystemCode,
          }}
          systems={mappingSystems}
          lockedTargetSystem={mappingTargetSystem}
          mapping={mappingExisting}
          onSaved={() => {
            setMappingDialogOpen(false);
            setMappingRow(null);
            void reload({ background: true });
          }}
        />
      )}

      {removingRow && (
        <ConfirmDialog
          open={removingRow !== null}
          onOpenChange={(o) => { if (!o) setRemovingRow(null); }}
          title={t('facilities.observed.removeMappingTitle', { code: removingRow.sourceCode })}
          description={t('facilities.observed.removeMappingBody', {
            code: removingRow.sourceCode,
            target: removeMappingTarget(removingRow),
          })}
          confirmLabel={t('facilities.observed.removeMapping')}
          cancelLabel={t('common.cancel')}
          destructive
          onConfirm={() => void doRemoveMapping()}
        />
      )}
    </div>
  );
}

export default ObservedTab;
