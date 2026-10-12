import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getPatient, listPatientRequests, type PatientDetail, type PatientRequestList } from '@/api';

// One patient (docs/superpowers/specs/2026-10-12-patient-index-design.md, section 3). Read-only.
// Header and label-left grid copy ResultFieldSheet.tsx. The only action, opening the record this one
// was merged into, sits in the section's ⋯ menu (AGENTS.md section 5).

const REQUEST_PAGE = 10;

export function PatientSheet({ patientRef, onClose, onOpen }: {
  patientRef: string | null; onClose: () => void; onOpen: (ref: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [requests, setRequests] = useState<PatientRequestList | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(REQUEST_PAGE);

  useEffect(() => {
    setDetail(null);
    setGone(false);
    setPage(0);
    if (!patientRef) return;
    let cancelled = false;
    getPatient(patientRef)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setGone(true); });
    return () => { cancelled = true; };
  }, [patientRef]);

  useEffect(() => {
    setRequests(null);
    if (!patientRef) return;
    let cancelled = false;
    listPatientRequests(patientRef, { limit: pageSize, offset: page * pageSize })
      .then((r) => { if (!cancelled) setRequests(r); })
      .catch(() => { if (!cancelled) setRequests({ rows: [], total: 0 }); });
    return () => { cancelled = true; };
  }, [patientRef, page, pageSize]);

  const row = (label: string, value: string | null | undefined) => (value ? (
    <>
      <div className="text-muted-foreground">{label}</div>
      <div className="break-words">{value}</div>
    </>
  ) : null);

  return (
    <Sheet open={patientRef !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('patients.sheet.title')}</SheetTitle>
          <SheetDescription>{t('patients.sheet.description')}</SheetDescription>
        </SheetHeader>
        {gone && <div className="px-6 py-6 text-sm text-destructive">{t('patients.sheet.gone')}</div>}
        {!gone && !detail && <LoadingState className="min-h-[16rem]" label={t('common.loading')} />}
        {detail && (
          <>
            <section>
              <div className="flex items-center justify-between px-6 py-3">
                <div className="text-sm font-medium text-foreground">{t('patients.sheet.identity')}</div>
                {detail.replacedByRef && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="patient-sheet-menu" aria-label={t('patients.rowActions')}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem data-testid="patient-open-replacement" onSelect={() => onOpen(detail.replacedByRef as string)}>
                        {t('patients.sheet.openReplacement')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <div className="border-t border-border" />
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
                {row(t('patients.sheet.name'), detail.name)}
                {row(t('patients.sheet.sex'), detail.sex)}
                {row(detail.masked ? t('patients.sheet.birthYear') : t('patients.sheet.birthDate'), detail.birthDate)}
                {row(t('patients.sheet.age'), detail.ageYears === null ? null : String(detail.ageYears))}
                {row(t('patients.sheet.facility'), detail.managingFacility?.name ?? detail.managingFacility?.reference)}
                {row(t('patients.sheet.status'), detail.active && !detail.replacedByRef ? t('patients.status.active') : t('patients.status.merged'))}
                {detail.replacedByRef && row(t('patients.sheet.replacedBy'), t('patients.status.merged'))}
                {row(t('patients.sheet.guid'), detail.patientGuid)}
                {row(t('patients.sheet.phone'), detail.phone)}
                {row(t('patients.sheet.email'), detail.email)}
              </div>
            </section>
            <section>
              <div className="border-t border-border" />
              <div className="px-6 py-3 text-sm font-medium text-foreground">{t('patients.sheet.identifiers')}</div>
              <div className="border-t border-border" />
              {detail.identifiers.length === 0 ? (
                <div className="px-6 py-4 text-sm text-muted-foreground">{t('patients.sheet.noIdentifiers')}</div>
              ) : (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
                  {detail.identifiers.map((i) => (
                    <div key={`${i.system ?? ''}|${i.value}`} className="contents">
                      <div className="text-muted-foreground">{i.label ?? i.system ?? t('patients.noSystem')}</div>
                      <div className="break-all font-mono text-xs">{i.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="flex flex-col">
              <div className="border-t border-border" />
              <div className="px-6 py-3 text-sm font-medium text-foreground">{t('patients.sheet.requests')}</div>
              <div className="border-t border-border" />
              {!requests && <LoadingState className="min-h-[10rem]" label={t('common.loading')} />}
              {requests && requests.rows.length === 0 && (
                <StripedEmpty className="min-h-[10rem]">{t('patients.sheet.noRequests')}</StripedEmpty>
              )}
              {requests && requests.rows.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">{t('patients.sheet.reqCol.date')}</TableHead>
                      <TableHead>{t('patients.sheet.reqCol.panel')}</TableHead>
                      <TableHead>{t('patients.sheet.reqCol.requester')}</TableHead>
                      <TableHead>{t('patients.sheet.reqCol.status')}</TableHead>
                      <TableHead className="pr-6 text-right">{t('patients.sheet.reqCol.results')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.rows.map((r, i) => (
                      <TableRow key={`${page}-${i}`} data-testid={`patient-request-${i}`}>
                        <TableCell className="whitespace-nowrap pl-6">{r.authoredAt ?? ''}</TableCell>
                        <TableCell>{r.panel ?? ''}</TableCell>
                        <TableCell>{r.requester ?? ''}</TableCell>
                        <TableCell>{r.status ?? ''}</TableCell>
                        <TableCell className="pr-6 text-right">{r.resultCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={requests?.total ?? 0}
                onPageChange={setPage}
                onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
              />
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default PatientSheet;
