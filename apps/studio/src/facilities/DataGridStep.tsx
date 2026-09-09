import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useIsNarrowViewport } from '@/lib/viewport';
import {
  readFacilityImportRows,
  readFacilityImportEdits,
  putFacilityImportEdit,
  deleteFacilityImportEdit,
  type FacilityImportRows,
  type FacilityImportEdit,
  type ControlledField,
} from '@/api';

export interface DataGridStepProps {
  /** The stored run whose file this shows. */
  runId: string;
  /** Editing is CSV only: a JSONL release takes no overlay. False renders the grid exactly as
   *  Slice A shipped it. */
  editable?: boolean;
  /** Source header -> the controlled field it maps to, for the headers that map to one. A cell in
   *  one of these opens the this-row-versus-everywhere choice instead of writing straight away. */
  controlledHeaders?: Record<string, ControlledField>;
}

/** The uploaded file as a table, read only, one page at a time.
 *
 *  IT FETCHES ITS OWN PAGE. The sheet holds no rows, which is the point: a 64MB register must
 *  never enter this tab. Only the window on screen is ever in memory here.
 *
 *  EDITABLE FOR A CSV RUN (`editable`). A JSONL release stores no cell edits at all (Task 3's
 *  parser takes no overlay for one), so the sheet never passes `editable` for one and this grid
 *  renders exactly as Slice A shipped it. On a CSV run a cell opens for typing on click and
 *  commits on Enter or blur; an edited cell keeps a marker and an undo control.
 *
 *  ⛔ DESKTOP ONLY, AND IT SAYS SO. This is the one deliberate exception to AGENTS.md §6 item 4 in
 *  this wizard, recorded in the design (`docs/superpowers/specs/2026-09-08-facility-import-data-
 *  stage-design.md`, "Two deliberate exceptions"): a 21-column spreadsheet at 375px is not usable
 *  by anyone. The exception is only legitimate BECAUSE of the notice below. Rendering the grid
 *  anyway, to scroll sideways off the screen, is what the operator was promised would not happen.
 *  Steps 1, 3 and 4 stay usable on a phone, so the notice sends them on rather than stopping them. */
export function DataGridStep({ runId, editable, controlledHeaders }: DataGridStepProps): JSX.Element {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [data, setData] = useState<FacilityImportRows | null>(null);
  /** The SERVER'S OWN WORDS, not a generic failure. It names the run and, for a file that cannot be
   *  parsed at all, the line. Kept because the copy this replaced ("check the connection") sent an
   *  operator to look at their network over a bad line in their own file. */
  const [failure, setFailure] = useState<string | null>(null);
  const narrow = useIsNarrowViewport();
  const [edits, setEdits] = useState<FacilityImportEdit[]>([]);
  /** Which cell is open for typing. `null` when none is. Drives the render. */
  const [editing, setEditing] = useState<{ line: number; header: string } | null>(null);
  /** The same value as `editing`, kept in a ref so `commit` can read it fresh regardless of which
   *  render's closure calls it. See `commit`'s own comment for why that matters. */
  const editingRef = useRef<{ line: number; header: string } | null>(null);
  const [draft, setDraft] = useState('');
  void controlledHeaders; // Task 7 reads this to open the this-row-versus-everywhere choice.

  useEffect(() => {
    // Not fetched at all when editing is off: a read-only grid has nothing to overlay, and this
    // route takes `facilities.manage` like the rows route does.
    if (!editable || narrow) return undefined;
    let cancelled = false;
    readFacilityImportEdits(runId)
      .then((res) => { if (!cancelled) setEdits(res); })
      // Deliberately silent. A failure here costs the operator the overlay, not the file: the grid
      // still shows what was uploaded, which is the truthful fallback. The write path reports its
      // own failures, where the operator is actually waiting on an answer.
      .catch(() => { if (!cancelled) setEdits([]); });
    return () => { cancelled = true; };
  }, [runId, editable, narrow]);

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

  /** What one cell reads after the overlay, and whether an edit put it there.
   *
   *  ⛔ THE SAME PRECEDENCE THE PARSER USES (facility-csv.ts's row loop): a line-scoped edit wins
   *  over a value-scoped one. If these two ever disagree, the grid is lying about the import. */
  function cellOf(line: number, header: string, fileValue: string): {
    value: string; edit: FacilityImportEdit | null;
  } {
    const byLine = edits.find((e) => e.line === line && e.header === header);
    if (byLine) return { value: byLine.toValue, edit: byLine };
    const byValue = edits.find((e) => e.line === null && e.header === header && e.fromValue === fileValue);
    if (byValue) return { value: byValue.toValue, edit: byValue };
    return { value: fileValue, edit: null };
  }

  /** Opens one cell for typing. */
  function openCell(line: number, header: string, value: string): void {
    editingRef.current = { line, header };
    setEditing({ line, header });
    setDraft(value);
  }

  /** Closes whichever cell is open, without writing anything. */
  function closeEditing(): void {
    editingRef.current = null;
    setEditing(null);
  }

  // ⛔ THE ENTER-THEN-BLUR GUARD. Enter calls `commit`, which closes the cell, which unmounts the
  // `Input`, which fires a native `blur`, which calls `commit` again with the same draft. A plain
  // `editing` STATE check does not stop this: both calls run from closures made in the same
  // render, so both see the pre-close value no matter what the first call sets state to. `editingRef`
  // is a ref, not state. Reading `.current` always returns the latest value, so the first call's
  // `closeEditing()` (which sets the ref, not just the state) is visible to the second call
  // immediately, and it returns here before writing anything twice.
  async function commit(line: number, header: string, fileValue: string): Promise<void> {
    if (!editingRef.current || editingRef.current.line !== line || editingRef.current.header !== header) return;
    closeEditing();
    const { value: current } = cellOf(line, header, fileValue);
    // Nothing typed, or typed back to what it already read. No write: an edit row that changes
    // nothing still marks the cell as edited, which would tell the operator they changed something.
    if (draft === current) return;
    // Back to what the FILE says, with an edit standing. That is an undo, not a new edit.
    const standing = edits.find((e) => e.line === line && e.header === header);
    if (draft === fileValue && standing) { await undo(standing); return; }
    // The choice dialog (Task 7) intercepts a controlled-field column before this runs.
    try {
      const saved = await putFacilityImportEdit(runId, { header, line, toValue: draft });
      setEdits((prev) => [...prev.filter((e) => !(e.line === line && e.header === header)), saved]);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
  }

  async function undo(edit: FacilityImportEdit): Promise<void> {
    try {
      await deleteFacilityImportEdit(runId, edit.line === null
        ? { header: edit.header, fromValue: edit.fromValue as string }
        : { header: edit.header, line: edit.line });
      setEdits((prev) => prev.filter((e) => e !== edit));
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
  }

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
              {data.headers.map((h, c) => {
                const line = data.lines[i];
                const fileValue = row[c] ?? '';
                const { value, edit } = cellOf(line, h, fileValue);
                const open = editable && editing?.line === line && editing.header === h;
                if (open) {
                  return (
                    <TableCell key={c} className="p-1">
                      <Input
                        autoFocus
                        aria-label={t('facilities.import.editCellLabel', { header: h, line })}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { void commit(line, h, fileValue); }
                          // Escape cancels. Without it the only way out of a mistyped cell is to
                          // commit it and then undo, which is two writes to change nothing.
                          if (e.key === 'Escape') { closeEditing(); }
                        }}
                        onBlur={() => { void commit(line, h, fileValue); }}
                      />
                    </TableCell>
                  );
                }
                return (
                  <TableCell
                    key={c}
                    // The marker for an edited cell. A left rule, not a background: a background
                    // over a 21-column grid reads as a selection, and every third cell edited would
                    // make the table unreadable.
                    className={edit ? 'border-l-2 border-l-amber-500' : undefined}
                    onClick={editable ? () => openCell(line, h, value) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {value}
                      {edit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          aria-label={t('facilities.import.editUndo')}
                          onClick={(e) => { e.stopPropagation(); void undo(edit); }}
                        >
                          <Undo2 className="h-3 w-3" />
                        </Button>
                      )}
                    </span>
                  </TableCell>
                );
              })}
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
