import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { useIsNarrowViewport } from '@/lib/viewport';
import { readFacilityImportRows, type FacilityImportRows } from '@/api';

export interface DataGridStepProps {
  /** The stored run whose file this shows. */
  runId: string;
}

/** The uploaded file as a table, read only, one page at a time.
 *
 *  IT FETCHES ITS OWN PAGE. The sheet holds no rows, which is the point: a 64MB register must
 *  never enter this tab. Only the window on screen is ever in memory here.
 *
 *  READ ONLY, and that is not a placeholder for a later slice. Nothing has been mapped yet at
 *  this stage, so there is no contract field to validate a cell against and no way to tell a bad
 *  value from an unfamiliar one. Editing arrives with Mapping, where a target field exists.
 *
 *  ⛔ DESKTOP ONLY, AND IT SAYS SO. This is the one deliberate exception to AGENTS.md §6 item 4 in
 *  this wizard, recorded in the design (`docs/superpowers/specs/2026-09-08-facility-import-data-
 *  stage-design.md`, "Two deliberate exceptions"): a 21-column spreadsheet at 375px is not usable
 *  by anyone. The exception is only legitimate BECAUSE of the notice below. Rendering the grid
 *  anyway, to scroll sideways off the screen, is what the operator was promised would not happen.
 *  Steps 1, 3 and 4 stay usable on a phone, so the notice sends them on rather than stopping them. */
export function DataGridStep({ runId }: DataGridStepProps): JSX.Element {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [data, setData] = useState<FacilityImportRows | null>(null);
  /** The SERVER'S OWN WORDS, not a generic failure. It names the run and, for a file that cannot be
   *  parsed at all, the line. Kept because the copy this replaced ("check the connection") sent an
   *  operator to look at their network over a bad line in their own file. */
  const [failure, setFailure] = useState<string | null>(null);
  const narrow = useIsNarrowViewport();

  useEffect(() => {
    // No request at all on a phone: the notice below is the whole of this step there, and paging a
    // national register to render nothing is a download the operator did not ask for.
    if (narrow) return undefined;
    let cancelled = false;
    setFailure(null);
    readFacilityImportRows(runId, { offset: page * pageSize, limit: pageSize })
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFailure(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [runId, page, pageSize, narrow]);

  if (narrow) {
    return (
      <div className="mx-6 mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {t('facilities.import.rowsDesktopOnly')}
      </div>
    );
  }
  if (failure !== null) {
    return (
      <div className="mx-6 mt-4 space-y-1">
        <p className="text-sm text-destructive">{t('facilities.import.rowsFailed')}</p>
        <p className="text-sm text-muted-foreground">{failure}</p>
      </div>
    );
  }
  if (!data) return <LoadingState className="min-h-[16rem] flex-1" />;

  // The server caps how many line numbers it names (a file with 3 000 bad lines has one problem,
  // not 3 000), so the count and the list can disagree. The trailing marker says the list is
  // partial rather than letting the operator read it as the whole set.
  const skippedLines = (data.skippedLines ?? []).join(', ')
    + ((data.skippedLines ?? []).length < (data.skipped ?? 0) ? ', …' : '');

  if (data.rows.length === 0) {
    // ⛔ A FILE FULL OF UNREADABLE ROWS IS NOT AN EMPTY FILE. If every line was skipped, `rows` is
    // empty and this branch would otherwise fire before the skipped notice below ever rendered,
    // telling the operator their register had no rows when it had nothing but bad ones. The empty
    // state itself has to carry the skipped count and line numbers in that case.
    if ((data.skipped ?? 0) > 0) {
      return (
        <StripedEmpty className="min-h-[16rem] flex-1">
          {t('facilities.import.rowsEmptySkipped', { count: data.skipped, lines: skippedLines })}
        </StripedEmpty>
      );
    }
    return <StripedEmpty className="min-h-[16rem] flex-1">{t('facilities.import.rowsEmpty')}</StripedEmpty>;
  }

  // ⛔ THE TABLE BLEEDS, THE NOTICE DOES NOT. AGENTS.md §5: row rules read edge to edge while text
  // stays inset. The table's own cells carry their padding, so no margin at all puts the rules on
  // the pane edges without moving a single value.
  //
  // ⛔ NO `-mx-6` HERE, and that is deliberate. The sheet's scrolling body carries NO horizontal
  // padding of its own: every child adds its own `mx-6`. A negative margin would therefore push the
  // table 24px OUTSIDE the pane rather than onto its edge, and §5's own note warns that an
  // `overflow-auto` ancestor clips a bleeding element anyway. This body is `overflow-y-auto`.
  // The skipped-line notice keeps its inset, because it is prose and prose stays with the copy.
  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      {(data.skipped ?? 0) > 0 && (
        <div className="mx-6 mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          {t('facilities.import.rowsSkipped', { count: data.skipped, lines: skippedLines })}
        </div>
      )}
      <Table wrapperClassName="min-h-0 flex-1">
        <TableHeader>
          <TableRow>
            {data.headers.map((h, i) => <TableHead key={i}>{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row, i) => (
            <TableRow key={data.offset + i}>
              {data.headers.map((_h, c) => <TableCell key={c}>{row[c] ?? ''}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={data.total}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
      />
    </div>
  );
}

export default DataGridStep;
