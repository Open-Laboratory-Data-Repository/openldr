import { useEffect, useMemo, useState } from 'react';
import { browseTestCatalog, type BrowseTest } from '@/api';
import type { CodingAnswer } from '@openldr/forms/pure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { cn } from '@/lib/cn';

/** Chrome copy. The form runtime has no i18n, so the capture page supplies these (see TestDetailsField). */
export interface BrowseTestsCopy {
  /** The sheet title, and the menu item that opens it. */
  title?: string;
  /** The field menu's accessible name. `{label}` is replaced with the field's label. */
  actions?: string;
  search?: string;
  category?: string;
  anyCategory?: string;
  notOffered?: string;
  empty?: string;
  noMatch?: string;
  error?: string;
  loading?: string;
}

export const BROWSE_TESTS_EN: Required<BrowseTestsCopy> = {
  title: 'Browse all tests',
  actions: '{label} actions',
  search: 'Search by code or name',
  category: 'Category',
  anyCategory: 'Any category',
  notOffered: 'Not offered here',
  empty: 'No tests are loaded on this install. Tests come from the Test catalog page.',
  noMatch: 'No tests match this search.',
  error: 'The catalog could not be read.',
  loading: 'Reading the catalog',
};

const SEARCH_DEBOUNCE_MS = 250;
// Radix Select refuses an empty item value, so "any category" needs a value of its own.
const ANY = '__any__';

export function BrowseTestsSheet({ onPick, onClose, copy }: {
  /** Called with the coding of an offered test. The system is the one the server answered with. */
  onPick: (coding: CodingAnswer) => void;
  onClose: () => void;
  copy?: BrowseTestsCopy;
}): JSX.Element {
  const t = { ...BROWSE_TESTS_EN, ...(copy ?? {}) };
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [rows, setRows] = useState<BrowseTest[]>([]);
  const [total, setTotal] = useState(0);
  const [system, setSystem] = useState('');
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);

  // Waits for a pause in typing, then goes back to page one. An unchanged search sets no timer, so
  // it never resets a page the operator just moved to.
  useEffect(() => {
    const next = search.trim();
    if (next === q) return undefined;
    const timer = setTimeout(() => { setQ(next); setPage(0); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setFailed(false);
    browseTestCatalog({ q: q || undefined, category: category || undefined, limit: pageSize, offset: page * pageSize })
      .then((answer) => {
        if (cancelled) return;
        setRows(answer.rows);
        setTotal(answer.total);
        setSystem(answer.system);
      })
      .catch(() => { if (!cancelled) { setRows([]); setTotal(0); setFailed(true); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [q, category, page, pageSize]);

  // The categories the loaded rows carry, not a second request. The chosen one stays offered even
  // when no loaded row carries it, so the filter can always be read back.
  const categories = useMemo(() => {
    const seen = new Set(rows.map((r) => r.category).filter((c): c is string => !!c));
    if (category) seen.add(category);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [rows, category]);

  const pick = (row: BrowseTest): void => {
    if (!row.enabled || !system) return;
    onPick({ system, code: row.code, display: row.display });
    onClose();
  };

  const loading = busy && rows.length === 0;
  const filtered = !!q || !!category;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle>{t.title}</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 px-6 pb-4">
          <Label htmlFor="browse-tests-search">{t.search}</Label>
          <Input
            id="browse-tests-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
          />
          <Label htmlFor="browse-tests-category">{t.category}</Label>
          <Select
            value={category || ANY}
            onValueChange={(v) => { setCategory(v === ANY ? '' : v); setPage(0); }}
          >
            <SelectTrigger id="browse-tests-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t.anyCategory}</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
          {loading && <LoadingState className="min-h-[16rem] flex-1" label={t.loading} />}
          {!busy && rows.length === 0 && (
            <StripedEmpty className="min-h-[16rem] flex-1">
              {failed ? t.error : filtered ? t.noMatch : t.empty}
            </StripedEmpty>
          )}
          {/* Rendered only when populated: an empty table's header forces intrinsic width and scrolls
              sideways on a phone. Names wrap for the same reason. */}
          {rows.length > 0 && (
            <Table wrapperClassName="min-h-0 flex-1">
              <TableBody className="[&_tr:last-child]:border-b">
                {rows.map((r) => (
                  <TableRow
                    key={r.code}
                    data-testid={`browse-test-${r.code}`}
                    aria-disabled={!r.enabled || undefined}
                    tabIndex={r.enabled ? 0 : undefined}
                    onClick={() => pick(r)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(r); } }}
                    className={cn(r.enabled ? 'cursor-pointer' : 'text-muted-foreground hover:bg-transparent')}
                  >
                    <TableCell className="w-24 align-top font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="whitespace-normal break-words align-top">
                      <div>{r.display}</div>
                      {!r.enabled && <div className="text-xs">{t.notOffered}</div>}
                    </TableCell>
                    <TableCell className="align-top text-xs text-muted-foreground">{r.category ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {rows.length > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
