import { useCallback, useEffect, useState } from 'react';
import { MoreHorizontal, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_OBSERVED_FACILITY_SYSTEM } from '@openldr/db/facility-observed';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
      // Look up any mapping ALREADY authored for this observed code so the dialog opens in edit
      // mode against it, rather than creating a second, ambiguous candidate row alongside it —
      // `resolveObservedFacilities` has no tiebreak for two active mappings on the same code.
      const [systems, mappings] = await Promise.all([
        listCodingSystems(),
        listTermMappings(DEFAULT_OBSERVED_FACILITY_SYSTEM, row.sourceCode),
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

  const mappingSystemCode = mappingSystems.find((s) => s.url === DEFAULT_OBSERVED_FACILITY_SYSTEM)?.systemCode ?? '';

  if (loading) {
    return <LoadingState className="flex-1" label={t('common.loading')} />;
  }

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
              {rows.map((row) => (
                <TableRow key={`${row.sourceSystem}|${row.sourceCode}`}>
                  <TableCell className="max-w-[220px] text-xs">
                    <TruncatedText text={row.sourceCode} />
                  </TableCell>
                  <TableCell className="text-right text-xs">{row.reportCount}</TableCell>
                  <TableCell className="text-xs">
                    {row.targetMissing ? (
                      <span className="font-medium text-destructive">{t('facilities.observed.targetMissing')}</span>
                    ) : row.resolvedVia ? (
                      <div className="flex flex-col">
                        <span>{row.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {row.resolvedVia === 'registry' ? t('facilities.observed.viaRegistry') : t('facilities.observed.viaNational')}
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
        ) : (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={t('facilities.observed.empty')}
            body={t('facilities.observed.emptyHelp')}
          />
        )}
      </div>

      {mappingRow && (
        <TermMappingDialog
          open={mappingDialogOpen}
          onOpenChange={(o) => { setMappingDialogOpen(o); if (!o) setMappingRow(null); }}
          fromTerm={{
            system: DEFAULT_OBSERVED_FACILITY_SYSTEM,
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
