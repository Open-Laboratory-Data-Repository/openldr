import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
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
 *  Not wired into `ImportFacilitiesSheet.tsx` yet. That is a separate task, so it can land
 *  without colliding with this one. */
export function DataGridStep({ runId }: DataGridStepProps): JSX.Element {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [data, setData] = useState<FacilityImportRows | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    readFacilityImportRows(runId, { offset: page * pageSize, limit: pageSize })
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [runId, page, pageSize]);

  if (failed) {
    return <p className="mx-6 mt-4 text-sm text-destructive">{t('facilities.import.rowsFailed')}</p>;
  }
  if (!data) return <LoadingState className="min-h-[16rem] flex-1" />;
  if (data.rows.length === 0) {
    return <StripedEmpty className="min-h-[16rem] flex-1">{t('facilities.import.rowsEmpty')}</StripedEmpty>;
  }

  return (
    <div className="mx-6 mt-4 flex min-h-0 flex-1 flex-col">
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
