import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import {
  applyResultFieldsImport, downloadResultFieldsCsv, listResultFields, previewResultFieldsImport,
  type ResultField, type ResultFieldList, type TestCatalogOptions,
} from '@/api';
import { ResultFieldSheet } from './ResultFieldSheet';
import { ImportMappingsSheet } from './ImportMappingsSheet';

// The Result fields tab of the Test catalog page (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md,
// 4.5). Layout copied from ObservedCodesTab.tsx.

type LoincFilter = 'all' | 'linked' | 'none';
const LOINC_FILTERS: LoincFilter[] = ['all', 'linked', 'none'];
const ROLES = ['result', 'specimen', 'metadata', 'admin'] as const;
const ALL_ROLES = 'all';

export function ResultFieldsTab({ canManage, loinc }: { canManage: boolean; loinc: TestCatalogOptions['loinc'] }): JSX.Element {
  const { t } = useTranslation();
  const [loincFilter, setLoincFilter] = useState<LoincFilter>('all');
  const [role, setRole] = useState<string>(ALL_ROLES);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<ResultFieldList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ResultField | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => { setQ(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  // Only the latest request may write state. A slower earlier response must not overwrite a newer one.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listResultFields({
        q: q || undefined, loinc: loincFilter, role: role === ALL_ROLES ? undefined : role, limit: pageSize, offset: page * pageSize,
      });
      if (mine === latest.current) setData(result);
    } catch (e) {
      if (mine === latest.current) {
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [q, loincFilter, role, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const ownedHere = data?.ownedHere ?? true;
  const canEdit = canManage && ownedHere;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="result-fields-tab">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('testCatalog.resultFields.searchPlaceholder')}
          className="h-8 sm:max-w-xs"
          data-testid="result-fields-search"
        />
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('testCatalog.resultFields.loincFilter')}>
          {LOINC_FILTERS.map((f) => (
            <Button
              key={f}
              variant={loincFilter === f ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              data-testid={`result-fields-loinc-${f}`}
              aria-pressed={loincFilter === f}
              onClick={() => { setLoincFilter(f); setPage(0); }}
            >
              {t(`testCatalog.resultFields.loinc.${f}`)}
            </Button>
          ))}
        </div>
        <Select value={role} onValueChange={(v) => { setRole(v); setPage(0); }}>
          <SelectTrigger className="h-8 sm:w-40" aria-label={t('testCatalog.resultFields.roleFilter')} data-testid="result-fields-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ROLES}>{t('testCatalog.resultFields.role.all')}</SelectItem>
            {ROLES.map((r) => <SelectItem key={r} value={r}>{t(`testCatalog.resultFields.role.${r}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        {canManage && (
          <div className="sm:ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="result-fields-menu-trigger" aria-label={t('testCatalog.resultFields.menuLabel')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Any install can export, a lab that receives central's dictionary included. */}
                <DropdownMenuItem
                  data-testid="result-fields-export"
                  onSelect={() => { downloadResultFieldsCsv().catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); }); }}
                >
                  {t('testCatalog.resultFields.exportAction')}
                </DropdownMenuItem>
                {ownedHere && (
                  <DropdownMenuItem data-testid="result-fields-import" onSelect={() => setImporting(true)}>
                    {t('testCatalog.resultFields.importAction')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {!ownedHere && (
        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground" data-testid="result-fields-central">
          {t('testCatalog.resultFields.fromCentral')}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && error && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">
            {data && !data.loaded ? t('testCatalog.resultFields.notLoaded') : t('testCatalog.resultFields.noMatch')}
          </StripedEmpty>
        )}
        {/* Rendered only when populated: an empty table's header forces intrinsic width and scrolls a
            phone sideways (AGENTS.md section 6). */}
        {!loading && !error && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('testCatalog.resultFields.col.code')}</TableHead>
                <TableHead>{t('testCatalog.resultFields.col.name')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('testCatalog.resultFields.col.role')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('testCatalog.resultFields.col.units')}</TableHead>
                <TableHead>{t('testCatalog.resultFields.col.loinc')}</TableHead>
                {canEdit && <TableHead className="w-12"><span className="sr-only">{t('testCatalog.resultFields.rowActions')}</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((f) => (
                <TableRow key={f.code} data-testid={`result-field-row-${f.code}`}>
                  <TableCell className="font-mono text-xs">{f.code}</TableCell>
                  <TableCell>{f.display ?? ''}</TableCell>
                  <TableCell className="hidden md:table-cell">{f.role ? t(`testCatalog.resultFields.role.${f.role}`) : ''}</TableCell>
                  <TableCell className="hidden md:table-cell">{f.units ?? ''}</TableCell>
                  <TableCell>
                    {f.loinc ? <span className="font-mono text-xs">{f.loinc}</span> : <Badge variant="outline">{t('testCatalog.resultFields.loinc.none')}</Badge>}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                              data-testid={`result-field-actions-${f.code}`}
                              aria-label={t('testCatalog.resultFields.actionsFor', { code: f.code })}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem data-testid={`result-field-link-${f.code}`} onSelect={() => setEditing(f)}>
                              {t('testCatalog.resultFields.linkAction')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <TablePagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
        leftSlot={<span className="text-muted-foreground">{t('testCatalog.resultFields.count', { count: data?.total ?? 0 })}</span>}
      />

      <ResultFieldSheet field={editing} ownedHere={ownedHere} loinc={loinc} onClose={() => setEditing(null)} onSaved={() => { void load(); }} />
      <ImportMappingsSheet
        open={importing}
        onClose={() => setImporting(false)}
        onImported={() => { void load(); }}
        preview={previewResultFieldsImport}
        apply={applyResultFieldsImport}
        description={t('testCatalog.resultFields.importDescription')}
      />
    </div>
  );
}

export default ResultFieldsTab;
