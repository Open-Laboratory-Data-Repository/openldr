import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface TablePaginationProps {
  page: number;
  pageSize: number;
  /** null means no total was computed. Supply the returned row count and continuation flag. */
  total: number | null;
  rowCount?: number;
  hasMore?: boolean;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  leftSlot?: React.ReactNode;
}

export function TablePagination({
  page,
  pageSize,
  total,
  rowCount = 0,
  hasMore = false,
  onPageChange,
  onPageSizeChange,
  leftSlot,
}: TablePaginationProps) {
  const { t } = useTranslation();
  const from = (total ?? rowCount) === 0 ? 0 : page * pageSize + 1;
  const to = total === null
    ? (rowCount === 0 ? 0 : page * pageSize + rowCount)
    : Math.min((page + 1) * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-3 py-2 text-xs">
      <div>{leftSlot}</div>
      <div className="flex max-w-full flex-wrap items-center gap-3">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v))}
        >
          <SelectTrigger aria-label="Rows per page" className="h-7 w-20 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 25, 50, 100].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="min-w-0 max-w-full break-words text-muted-foreground">
          {total === null ? t('table.unknownTotalRange', { from, to }) : <>{from}–{to} of {total}</>}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={total === null ? !hasMore : (page + 1) * pageSize >= total}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
