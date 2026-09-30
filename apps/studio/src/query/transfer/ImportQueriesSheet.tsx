import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { queryApi, type ConnectorRef, type QueryTransferFile } from '../api';
import { useQueryStore } from '../store';

const DEFAULT_CONNECTOR = 'Target Warehouse (Postgres)';

// Parse only to build the preview. The server validates the file again on import.
function parseFile(text: string): QueryTransferFile | null {
  try {
    const v = JSON.parse(text) as Partial<QueryTransferFile>;
    if (!v || v.format !== 'openldr.custom-queries' || !Array.isArray(v.queries)) return null;
    if (!v.queries.every((q) => q && typeof q.name === 'string')) return null;
    return v as QueryTransferFile;
  } catch {
    return null;
  }
}

export function ImportQueriesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
  const { t } = useTranslation();
  const refreshSavedQueries = useQueryStore((s) => s.refreshSavedQueries);
  const fileRef = useRef<HTMLInputElement>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [connectorName, setConnectorName] = useState('');
  const [file, setFile] = useState<QueryTransferFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Read t through a ref so a language change cannot re-run the load effect and reset the preview.
  const tRef = useRef(t);
  tRef.current = t;
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFile(null); setFileName(''); setFileError(null); setError(null); setLoadError(null); setReplace(false); setPage(0);
    void queryApi.list().then((rows) => { if (!cancelled) setExisting(new Set(rows.map((q) => q.name))); })
      .catch((e: Error) => { if (!cancelled) setLoadError(tRef.current('query.transfer.loadFailed', { error: e.message })); });
    void queryApi.connectors().then((rows) => {
      if (cancelled) return;
      setConnectors(rows);
      setConnectorName((rows.find((c) => c.name === DEFAULT_CONNECTOR) ?? rows[0])?.name ?? '');
    }).catch((e: Error) => { if (!cancelled) setLoadError(tRef.current('query.transfer.loadFailed', { error: e.message })); });
    return () => { cancelled = true; };
  }, [open]);

  const rows = useMemo(() => (file?.queries ?? []).map((q) => ({
    name: q.name,
    status: !existing.has(q.name) ? 'new' : replace ? 'replace' : 'skip',
  })), [file, existing, replace]);
  const statusLabel = { new: 'statusNew', skip: 'statusSkip', replace: 'statusReplace' } as const;
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setFileName(f.name);
    setPage(0);
    const parsed = parseFile(await f.text());
    setFile(parsed);
    setFileError(parsed ? null : t('query.transfer.invalidFile'));
  };

  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { results } = await queryApi.importQueries({ file, connectorName: connectorName || undefined, replace });
      const count = (o: string) => results.filter((r) => r.outcome === o).length;
      toast.success(t('query.transfer.importDone', {
        created: count('created'), replaced: count('replaced'), skipped: count('skipped'),
      }));
      refreshSavedQueries();
      onOpenChange(false);
    } catch (e) {
      setError(t('query.transfer.importFailed', { error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('query.transfer.import')}</SheetTitle>
          <SheetDescription>{t('query.transfer.importDescription')}</SheetDescription>
        </SheetHeader>

        {/* The ⋯ menu sits on the first section row, clear of the sheet's close button (FieldEditorSheet.tsx). */}
        <div className="flex items-center justify-between px-6 py-3">
          <div className="text-sm font-medium text-foreground">{t('query.transfer.file')}</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                data-testid="import-sheet-menu" aria-label={t('query.transfer.menu')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="import-choose" disabled={busy} onSelect={() => fileRef.current?.click()}>
                {t('query.transfer.chooseFile')}
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="import-apply" disabled={busy || !file || rows.length === 0}
                onSelect={() => { void doImport(); }}>
                {t('query.transfer.importAction')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          aria-label={t('query.transfer.file')}
          onChange={(event) => {
            const f = event.target.files?.[0];
            event.target.value = '';
            void onFile(f);
          }} />

        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 px-6 pb-4">
          <Label>{t('query.transfer.file')}</Label>
          <span className="min-w-0 break-words text-sm text-muted-foreground">{fileName || t('query.transfer.noFile')}</span>
          <Label>{t('query.transfer.connector')}</Label>
          <Select value={connectorName} onValueChange={setConnectorName}>
            <SelectTrigger aria-label={t('query.transfer.connector')} className="min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {connectors.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Label>{t('query.transfer.replace')}</Label>
          <Switch checked={replace} onCheckedChange={setReplace} aria-label={t('query.transfer.replace')} />
        </div>

        {fileError && <div className="mx-6 mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{fileError}</div>}
        {loadError && <div className="mx-6 mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{loadError}</div>}
        {error && <div className="mx-6 mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

        <div className="flex min-h-[16rem] flex-col border-t border-border">
          {busy ? (
            <LoadingState label={t('query.transfer.importing')} className="min-h-[16rem]" />
          ) : rows.length === 0 ? (
            <StripedEmpty className="min-h-[16rem]">{file ? t('query.transfer.emptyFile') : t('query.transfer.noPreview')}</StripedEmpty>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('query.transfer.colName')}</TableHead>
                    <TableHead>{t('query.transfer.colStatus')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r, i) => (
                    <TableRow key={`${r.name}-${page * pageSize + i}`}>
                      <TableCell className="break-words">{r.name}</TableCell>
                      <TableCell className="whitespace-nowrap">{t(`query.transfer.${statusLabel[r.status as keyof typeof statusLabel]}`)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination page={page} pageSize={pageSize} total={rows.length}
                onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(0); }} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
