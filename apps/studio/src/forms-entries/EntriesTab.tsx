import { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listFormEntries, type FormEntry, type FormEntryStatus } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { TruncatedText } from '@/components/ui/truncated-text';
import { cn } from '@/lib/cn';
import { EntrySheet } from './EntrySheet';
import { VoidEntryDialog } from './VoidEntryDialog';
import { formatEnteredAt } from './format';

// The entries of a form (design 2026-11-22-form-entries, 5.3). The layout copies pages/Users.tsx:
// a search and filters above, the table only when it has rows, the empty and loading states filling
// the pane in its place, pagination under it.

const P = 'forms.entries';
const ALL = 'all';
/** How long the search box waits after the last key before it asks the server. */
export const SEARCH_DEBOUNCE_MS = 300;

export function EntriesTab({ formId, refreshKey }: {
  formId: string;
  /** Bumped by the page after a save, so the list reads the new entry. */
  refreshKey: number;
}) {
  const { t, i18n } = useTranslation();
  const { hasCapability } = useAuth();
  const mayVoid = hasCapability('forms.void_entries');
  const [rows, setRows] = useState<FormEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // What the list asks for: the box's text once typing has paused.
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>(ALL);
  const [person, setPerson] = useState<string>(ALL);
  // The person filter offers everyone seen in the entries read so far this visit. The route has no
  // list of people, and a filtered page would otherwise shrink the choice to the one picked.
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [viewing, setViewing] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<FormEntry | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const out = await listFormEntries(formId, {
        limit: pageSize,
        offset: page * pageSize,
        search: query.trim() || undefined,
        status: status === ALL ? undefined : (status as FormEntryStatus),
        enteredBy: person === ALL ? undefined : person,
      });
      if (id !== request.current) return;
      setRows(out.entries);
      setTotal(out.total);
      setPeople((prev) => {
        const fresh = out.entries.filter((e) => prev.get(e.enteredBy) !== e.enteredByName);
        if (fresh.length === 0) return prev;
        const next = new Map(prev);
        for (const e of fresh) next.set(e.enteredBy, e.enteredByName);
        return next;
      });
    } catch (e) {
      if (id !== request.current) return;
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [formId, page, pageSize, query, status, person]);

  useEffect(() => { void load(); return () => { request.current++; }; }, [load, refreshKey]);

  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => { setQuery(search); setPage(0); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, query]);

  const statusWord = (s: FormEntryStatus): string | null =>
    s === 'entered-in-error' ? t(`${P}.statusVoided`) : s === 'incomplete' ? t(`${P}.statusIncomplete`) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(`${P}.search`)}
            aria-label={t(`${P}.search`)}
            className="h-8 min-w-0 sm:w-64"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:order-last sm:ml-auto" aria-label={t(`${P}.listActions`)}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { void load(); }}>{t(`${P}.refresh`)}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 sm:contents">
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
              <SelectTrigger aria-label={t(`${P}.status`)} className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${P}.anyStatus`)}</SelectItem>
                <SelectItem value="active">{t(`${P}.statusActive`)}</SelectItem>
                <SelectItem value="incomplete">{t(`${P}.statusIncomplete`)}</SelectItem>
                <SelectItem value="entered-in-error">{t(`${P}.statusVoided`)}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={person} onValueChange={(v) => { setPerson(v); setPage(0); }}>
              <SelectTrigger aria-label={t(`${P}.person`)} className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${P}.anyone`)}</SelectItem>
                {[...people].map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive [overflow-wrap:anywhere]">{error}</div> : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Fill only when rows exist, as on Users: the loading and empty states are flex-1 themselves. */}
        {!loading && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t(`${P}.colRequisition`)}</TableHead>
                <TableHead>{t(`${P}.colSummary`)}</TableHead>
                <TableHead>{t(`${P}.colEntered`)}</TableHead>
                <TableHead className="hidden sm:table-cell">{t(`${P}.colBy`)}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((e) => {
                const voided = e.status === 'entered-in-error';
                const word = statusWord(e.status);
                const key = e.entryKey ?? t(`${P}.noKey`);
                const struck = voided ? 'line-through text-muted-foreground' : '';
                return (
                  <TableRow
                    key={e.id}
                    className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                    onClick={() => setViewing(e.id)}
                  >
                    <TableCell className={cn('max-w-[8rem] font-medium', struck)}>
                      <TruncatedText text={key} className="min-w-0" />
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      <TruncatedText text={e.summary.map((s) => s.value).join(', ') || '-'} className={cn('min-w-0', struck)} />
                      {word ? <span className={cn('block text-xs', voided ? 'text-destructive' : 'text-amber-700')}>{word}</span> : null}
                    </TableCell>
                    <TableCell className={cn('whitespace-nowrap text-xs', struck || 'text-muted-foreground')}>
                      {formatEnteredAt(e.enteredAt, i18n.language)}
                    </TableCell>
                    <TableCell className={cn('hidden max-w-[10rem] sm:table-cell', struck)}>
                      <TruncatedText text={e.enteredByName} className="min-w-0" />
                    </TableCell>
                    <TableCell>
                      {/* Stops the dots click reaching the row's click-to-view, as on Users. */}
                      <div className="flex items-center justify-end" onClick={(ev) => ev.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t(`${P}.rowActions`, { key })}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setViewing(e.id)}>{t(`${P}.view`)}</DropdownMenuItem>
                            {mayVoid && !voided ? (
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setVoiding(e)}>
                                {t(`${P}.voidAction`)}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">
            {query.trim() || status !== ALL || person !== ALL ? t(`${P}.noMatch`) : t(`${P}.empty`)}
          </StripedEmpty>
        )}
      </div>

      <TablePagination
        page={page}
        pageSize={pageSize}
        total={loading ? null : total}
        rowCount={rows.length}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
        leftSlot={!loading ? <span className="text-muted-foreground">{t(`${P}.count`, { count: total })}</span> : null}
      />

      <EntrySheet entryId={viewing} onClose={() => setViewing(null)} />
      <VoidEntryDialog entry={voiding} onClose={() => setVoiding(null)} onDone={() => { void load(); }} />
    </div>
  );
}
