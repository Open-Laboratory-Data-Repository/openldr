import { useCallback, useEffect, useState } from 'react';
import { MoreHorizontal, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_OBSERVED_FACILITY_SYSTEM, observedSystemForFeed } from '@openldr/db/facility-observed';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { TruncatedText } from '@/components/ui/truncated-text';
import { useAuth } from '@/auth/AuthProvider';
import {
  listObservedFacilities,
  scanObservedFacilities,
  publishFacilities,
  listCodingSystems,
  listTermMappings,
  type ObservedFacility,
  type CodingSystem,
  type TermMapping,
} from '@/api';
import { TermMappingDialog } from '@/terminology/TermMappingDialog';

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
  const adminArea = row.district && row.region
    ? `${row.district}, ${row.region}`
    : (row.district || row.region || null);
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
export function ObservedTab(): JSX.Element {
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
  const [mappingSystems, setMappingSystems] = useState<CodingSystem[]>([]);
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
      // dialog opens in edit mode against it, rather than creating a second, ambiguous candidate
      // row alongside it — `resolveObservedFacilities` has no tiebreak for two active mappings on
      // the same code.
      const [systems, mappings] = await Promise.all([
        listCodingSystems(),
        listTermMappings(system, row.sourceCode),
      ]);
      setMappingSystems(systems);
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
  const mappingSystemUrl = mappingRow ? observedSystemForFeed(mappingRow.sourceSystem) : DEFAULT_OBSERVED_FACILITY_SYSTEM;
  const mappingSystemCode = mappingSystems.find((s) => s.url === mappingSystemUrl)?.systemCode ?? '';

  if (loading) {
    return <LoadingState className="flex-1" label={t('common.loading')} />;
  }

  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">{t('facilities.observed.title')}</span>
        {canManage && (
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
        )}
      </div>

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
              {pageRows.map((row) => (
                <TableRow key={`${row.sourceSystem}|${row.sourceCode}`}>
                  <TableCell
                    className="max-w-[220px] text-xs"
                    aria-label={row.sourceDisplay ? t('facilities.observed.codeWithName', { code: row.sourceCode, name: row.sourceDisplay }) : row.sourceCode}
                  >
                    <div className="flex flex-col">
                      <TruncatedText text={row.sourceCode} />
                      {row.sourceDisplay && (
                        <span className="text-[11px] text-muted-foreground">{row.sourceDisplay}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs">{row.reportCount}</TableCell>
                  <TableCell className="text-xs">
                    {row.targetMissing ? (
                      <span className="font-medium text-destructive">{t('facilities.observed.targetMissing')}</span>
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
                            {row.resolvedVia || row.targetMissing ? t('facilities.observed.editMapping') : t('facilities.observed.map')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
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
          mapping={mappingExisting}
          onSaved={() => {
            setMappingDialogOpen(false);
            setMappingRow(null);
            void reload({ background: true });
          }}
        />
      )}
    </div>
  );
}

export default ObservedTab;
