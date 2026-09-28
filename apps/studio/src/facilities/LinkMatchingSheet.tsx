import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  listFacilityImportSources, linkMatchingFacilityCodes,
  type FacilityRegisterSource, type LinkMatchingResult,
} from '@/api';

export interface LinkMatchingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: (result: LinkMatchingResult) => void;
  /** Preselects a register. The Radix Select is hard to drive in jsdom, so tests use this
   *  instead of clicking through the picker. */
  initialRegisterUrl?: string;
}

export function LinkMatchingSheet({ open, onOpenChange, onLinked, initialRegisterUrl }: LinkMatchingSheetProps) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<FacilityRegisterSource[]>([]);
  const [registerUrl, setRegisterUrl] = useState(initialRegisterUrl ?? '');
  const [preview, setPreview] = useState<LinkMatchingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    if (!open) return;
    void listFacilityImportSources()
      .then((rows) => setSources(rows))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [open]);

  useEffect(() => {
    if (!open || registerUrl === '') { setPreview(null); return; }
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setError(null);
    setPage(0);
    linkMatchingFacilityCodes({ registerUrl })
      .then((r) => { if (!cancelled) setPreview(r); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, registerUrl]);

  const toLink = preview ? preview.pairs.filter((p) => p.outcome === 'linked') : [];
  const linkCount = preview?.counts.linked ?? 0;

  const apply = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      const result = await linkMatchingFacilityCodes({ registerUrl, apply: true });
      toast.success(t('facilities.observed.linkMatchingDone', { count: result.counts.linked }));
      onLinked(result);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, [registerUrl, onLinked, onOpenChange, t]);

  const pageRows = toLink.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('facilities.observed.linkMatching')}</SheetTitle>
          <SheetDescription>{t('facilities.observed.linkMatchingDescription')}</SheetDescription>
        </SheetHeader>

        {/* The dots menu sits in this row, not in SheetHeader, where SheetContent's close X covers it. */}
        <div className="flex items-center justify-between px-6 py-3">
          <span className="text-sm text-muted-foreground">
            {preview && t('facilities.observed.linkMatchingCounts', {
              linked: preview.counts.linked,
              alreadyLinked: preview.counts['already-linked'],
              kept: preview.counts.kept,
              noMatch: preview.counts['no-match'],
            })}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('facilities.observed.linkMatchingActions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={linkCount === 0 || applying || loading} onSelect={() => void apply()}>
                {t('facilities.observed.linkMatchingApply', { count: linkCount })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">
          <Label htmlFor="link-matching-register" className="whitespace-nowrap">{t('facilities.observed.linkMatchingRegister')}</Label>
          <Select value={registerUrl} onValueChange={setRegisterUrl} disabled={sources.length === 0 || applying}>
            <SelectTrigger id="link-matching-register" className="w-full">
              <SelectValue placeholder={t('facilities.observed.linkMatchingRegisterPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => <SelectItem key={s.url} value={s.url}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="mx-6 mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          {registerUrl === '' ? (
            <StripedEmpty className="min-h-[16rem]">
              <span className="text-sm text-muted-foreground">{t('facilities.observed.linkMatchingPickFirst')}</span>
            </StripedEmpty>
          ) : loading ? (
            <LoadingState className="min-h-[16rem]" label={t('common.loading')} />
          ) : toLink.length === 0 ? (
            <StripedEmpty className="min-h-[16rem]">
              <span className="text-sm text-muted-foreground">{t('facilities.observed.linkMatchingEmpty')}</span>
            </StripedEmpty>
          ) : (
            <>
              <Table wrapperClassName="min-h-0 flex-1">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-6">{t('facilities.observed.code')}</TableHead>
                    <TableHead>{t('facilities.observed.resolvesTo')}</TableHead>
                    <TableHead className="text-right pr-6">{t('facilities.observed.reports')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((p) => (
                    <TableRow key={`${p.observedSystem}|${p.code}`}>
                      <TableCell className="px-6 font-mono text-xs">{p.code}</TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="text-right pr-6">{p.reportCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={toLink.length}
                onPageChange={setPage}
                onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
