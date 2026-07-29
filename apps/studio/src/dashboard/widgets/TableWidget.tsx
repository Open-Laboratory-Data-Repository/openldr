import type { ReportResult } from '../../api';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
export function TableWidget({ result }: { result: ReportResult }) {
  const { columns, rows } = result;
  return (
    <div className="h-full overflow-auto">
      <Table>
        <TableHeader><TableRow>{columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={Math.max(columns.length, 1)} className="py-8 text-center text-sm text-muted-foreground">
                No data to display.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, i) => <TableRow key={i}>{columns.map((c) => <TableCell key={c.key}>{String(r[c.key] ?? '')}</TableCell>)}</TableRow>)
          )}
        </TableBody>
      </Table>
    </div>
  );
}
