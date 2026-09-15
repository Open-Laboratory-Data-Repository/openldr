import { Fragment, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal, Upload } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import {
  applyTestCatalogImport, catalogImportFormat, previewTestCatalogImport, readTestCatalogFile,
  type CatalogCategoryAnswer, type CatalogColumnMap, type CatalogImportField, type CatalogImportFile,
  type CatalogImportInput, type CatalogImportReport, type CatalogValueMap, type TestCatalogOptions,
} from '@/api';

// Test catalog S3 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.4): import a national test
// list in four steps. Copies TestSheet.tsx (the sheet and the ⋯ menu on its first section row) and
// facilities/ImportFacilitiesSheet.tsx (the file drop target). Nothing is written before Apply.

type Step = 'file' | 'columns' | 'values' | 'review';
const STEPS: Step[] = ['file', 'columns', 'values', 'review'];
const STEP_TITLE: Record<Step, string> = {
  file: 'testCatalog.import.stepFile',
  columns: 'testCatalog.import.stepColumns',
  values: 'testCatalog.import.stepValues',
  review: 'testCatalog.import.stepReview',
};
const FIELDS: CatalogImportField[] = ['code', 'name', 'shortName', 'loinc', 'category', 'specimenTypes'];
const NO_ANSWERS: CatalogValueMap = { categories: [], specimens: [] };
/** Radix Select cannot hold an empty value, so these stand in for "no choice" in the pickers only. */
const NOT_IN_FILE = '__not_in_file__';
const NOT_CHOSEN = '__not_chosen__';
const NEW_CATEGORY = '__new_category__';

const specimenKey = (s: { system: string; code: string }): string => `${s.system}|${s.code}`;

/** A starting code for a new category, from the file's text. The operator can change it. */
function codeFromText(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function ImportCatalogSheet({ open, options, onClose, onImported }: {
  open: boolean;
  options: TestCatalogOptions;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<CatalogImportFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [wrongType, setWrongType] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [columnMap, setColumnMap] = useState<CatalogColumnMap>({});
  const [valueMap, setValueMap] = useState<CatalogValueMap>(NO_ANSWERS);
  const [report, setReport] = useState<CatalogImportReport | null>(null);
  const [refusedPage, setRefusedPage] = useState(0);
  const [refusedPageSize, setRefusedPageSize] = useState(10);
  const [busy, setBusy] = useState(false);

  // Each opening starts over. Nothing is kept between imports.
  useEffect(() => {
    if (!open) return;
    setStep('file');
    setFile(null);
    setFileName('');
    setWrongType(null);
    setColumnMap({});
    setValueMap(NO_ANSWERS);
    setReport(null);
    setRefusedPage(0);
  }, [open]);

  const fail = (e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); };
  const input = (): CatalogImportInput | null =>
    (file ? { table: { headers: file.headers, rows: file.rows }, columnMap, valueMap } : null);

  async function readFile(f: File) {
    const format = catalogImportFormat(f.name);
    if (!format) {
      setWrongType(f.name);
      return;
    }
    setWrongType(null);
    setBusy(true);
    try {
      const read = await readTestCatalogFile(f, format);
      setFile(read);
      setFileName(f.name);
      setColumnMap(read.suggested);
      setValueMap(NO_ANSWERS);
      setReport(null);
      setStep('columns');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Cleared, so choosing the same file again still reads it.
    e.target.value = '';
    if (f) void readFile(f);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const f = e.dataTransfer.files?.[0];
    if (f) void readFile(f);
  };

  async function preview(to: Step) {
    const i = input();
    if (!i || busy) return;
    setBusy(true);
    try {
      setReport(await previewTestCatalogImport(i));
      setRefusedPage(0);
      setStep(to);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const i = input();
    if (!i || busy) return;
    setBusy(true);
    try {
      const done = await applyTestCatalogImport(i);
      toast.success(t('testCatalog.import.applied', { new: done.counts.new, changed: done.counts.changed }));
      onImported();
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const index = STEPS.indexOf(step);
  const next = () => {
    if (step === 'file') setStep('columns');
    else if (step === 'columns') void preview('values');
    else if (step === 'values') void preview('review');
  };
  const nextDisabled = busy || (step === 'file' && !file) || (step === 'columns' && !columnMap.name);
  const writes = report ? report.counts.new + report.counts.changed : 0;

  const setColumn = (field: CatalogImportField, header: string) => setColumnMap((m) => {
    const out = { ...m };
    if (header === NOT_IN_FILE) delete out[field];
    else out[field] = header;
    return out;
  });
  const categoryAnswer = (text: string) => valueMap.categories.find((a) => a.text === text);
  const specimenAnswer = (text: string) => valueMap.specimens.find((a) => a.text === text);
  const setCategory = (text: string, choice: string) => setValueMap((m) => {
    const rest = m.categories.filter((a) => a.text !== text);
    if (choice === NOT_CHOSEN) return { ...m, categories: rest };
    const answer: CatalogCategoryAnswer = choice === NEW_CATEGORY
      ? { text, kind: 'new', code: codeFromText(text), display: text.trim() }
      : { text, kind: 'existing', code: choice };
    return { ...m, categories: [...rest, answer] };
  });
  const setNewCode = (text: string, code: string) => setValueMap((m) => ({
    ...m, categories: m.categories.map((a) => (a.text === text && a.kind === 'new' ? { ...a, code } : a)),
  }));
  const setSpecimen = (text: string, choice: string) => setValueMap((m) => {
    const rest = m.specimens.filter((a) => a.text !== text);
    const hit = options.specimenTypes.find((s) => specimenKey(s) === choice);
    return { ...m, specimens: hit ? [...rest, { text, system: hit.system, code: hit.code }] : rest };
  });

  // Headers are picker values, so an empty one cannot be offered, and a repeated one is offered once.
  const headers = file ? [...new Set(file.headers.filter((h) => h !== ''))] : [];
  const unmatched = report?.unmatched ?? { categories: [], specimens: [] };
  const refusedRows = report?.refused.slice(refusedPage * refusedPageSize, (refusedPage + 1) * refusedPageSize) ?? [];
  const valueLabel = 'max-w-[40vw] break-words sm:max-w-[16rem]';

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Full width on a phone: the base sheet stops at 90vw. */}
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.import.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.import.description')}</SheetDescription>
        </SheetHeader>

        <section>
          {/* Back, Next, Apply and Close sit on the first section's title row, as in TestSheet.tsx, clear
              of the sheet's own close button. */}
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t(STEP_TITLE[step])}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  data-testid="import-sheet-menu" aria-label={t('testCatalog.import.actions')}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {index > 0 && (
                  <DropdownMenuItem data-testid="import-back" disabled={busy} onSelect={() => setStep(STEPS[index - 1])}>
                    {t('testCatalog.import.back')}
                  </DropdownMenuItem>
                )}
                {step !== 'review' && (
                  <DropdownMenuItem data-testid="import-next" disabled={nextDisabled} onSelect={next}>
                    {t('testCatalog.import.next')}
                  </DropdownMenuItem>
                )}
                {step === 'review' && (
                  <DropdownMenuItem data-testid="import-apply" disabled={busy || writes === 0} onSelect={() => void apply()}>
                    {t('testCatalog.import.apply')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem data-testid="import-close" onSelect={onClose}>{t('testCatalog.import.close')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />

          {step === 'file' && (
            <div className="flex flex-col gap-2 px-6 py-4 text-sm">
              {/* sr-only, not removed: the real input below takes its accessible name from this Label. */}
              <Label htmlFor="catalog-import-file" className="sr-only">{t('testCatalog.import.fileLabel')}</Label>
              <div
                role="button"
                tabIndex={busy ? -1 : 0}
                aria-disabled={busy || undefined}
                onClick={() => { if (!busy) fileInputRef.current?.click(); }}
                onKeyDown={(e) => {
                  if (busy) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }
                }}
                // onDragOver must preventDefault or the browser opens the dropped file.
                onDragOver={(e) => { if (!busy) { e.preventDefault(); setDragOver(true); } }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6',
                  'text-center text-xs transition-colors',
                  busy ? 'cursor-not-allowed border-border opacity-50' : 'cursor-pointer hover:border-muted-foreground/60',
                  dragOver && !busy && 'border-primary bg-primary/5',
                )}
              >
                <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
                <span className={file && !busy ? 'text-foreground' : 'text-muted-foreground'}>
                  {busy
                    ? t('testCatalog.import.reading')
                    : file
                      ? t('testCatalog.import.fileRead', { name: fileName, count: file.rows.length })
                      : t(dragOver ? 'testCatalog.import.fileDropActive' : 'testCatalog.import.fileDropHint')}
                </span>
                {/* The real input opens the picker, carries `accept`, and is what a screen reader
                    announces. sr-only, never hidden, so it keeps its name. */}
                <input
                  ref={fileInputRef}
                  id="catalog-import-file"
                  type="file"
                  accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy}
                  onChange={onFileChange}
                  className="sr-only"
                  tabIndex={-1}
                />
              </div>
              {wrongType && (
                <div className="text-xs text-destructive">{t('testCatalog.import.fileWrongType', { name: wrongType })}</div>
              )}
            </div>
          )}

          {step === 'columns' && file && (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <div className="col-span-2 text-xs text-muted-foreground">{t('testCatalog.import.columnsHint')}</div>
              {file.sheetCount > 1 && (
                <div className="col-span-2 text-xs text-muted-foreground">
                  {t('testCatalog.import.sheetNote', { sheet: file.sheetName, count: file.sheetCount })}
                </div>
              )}
              {FIELDS.map((field) => (
                <Fragment key={field}>
                  <Label htmlFor={`import-column-${field}`} className="whitespace-nowrap">
                    {t(`testCatalog.import.field.${field}`)}
                  </Label>
                  <Select value={columnMap[field] ?? NOT_IN_FILE} onValueChange={(v) => setColumn(field, v)}>
                    <SelectTrigger id={`import-column-${field}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOT_IN_FILE}>{t('testCatalog.import.notInFile')}</SelectItem>
                      {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Fragment>
              ))}
            </div>
          )}

          {step === 'values' && (
            unmatched.categories.length === 0 && unmatched.specimens.length === 0 ? (
              <div className="px-6 py-4 text-sm text-muted-foreground">{t('testCatalog.import.allMatched')}</div>
            ) : (
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
                <div className="col-span-2 text-xs text-muted-foreground">{t('testCatalog.import.valuesHint')}</div>
                {unmatched.categories.length > 0 && (
                  <div className="col-span-2 -mx-6 border-y border-border px-6 py-3 font-medium text-foreground">
                    {t('testCatalog.import.categories')}
                  </div>
                )}
                {unmatched.categories.map((u, i) => {
                  const answer = categoryAnswer(u.text);
                  const id = `import-category-${i}`;
                  return (
                    <Fragment key={u.text}>
                      <Label htmlFor={id} className={valueLabel}>
                        &quot;{u.text}&quot; <span className="text-muted-foreground">({t('testCatalog.import.rows', { count: u.rows })})</span>
                      </Label>
                      <div className="flex min-w-0 flex-col gap-2">
                        <Select
                          value={answer ? (answer.kind === 'new' ? NEW_CATEGORY : answer.code) : NOT_CHOSEN}
                          onValueChange={(v) => setCategory(u.text, v)}
                        >
                          <SelectTrigger id={id}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NOT_CHOSEN}>{t('testCatalog.import.notChosen')}</SelectItem>
                            {options.categories.map((c) => <SelectItem key={c.code} value={c.code}>{c.display ?? c.code}</SelectItem>)}
                            <SelectItem value={NEW_CATEGORY}>{t('testCatalog.import.addCategory')}</SelectItem>
                          </SelectContent>
                        </Select>
                        {answer?.kind === 'new' && (
                          <Input
                            aria-label={t('testCatalog.import.newCode', { text: u.text })}
                            value={answer.code}
                            onChange={(e) => setNewCode(u.text, e.target.value)}
                          />
                        )}
                      </div>
                    </Fragment>
                  );
                })}
                {unmatched.specimens.length > 0 && (
                  <div className="col-span-2 -mx-6 border-y border-border px-6 py-3 font-medium text-foreground">
                    {t('testCatalog.import.specimens')}
                  </div>
                )}
                {unmatched.specimens.map((u, i) => {
                  const answer = specimenAnswer(u.text);
                  const id = `import-specimen-${i}`;
                  return (
                    <Fragment key={u.text}>
                      <Label htmlFor={id} className={valueLabel}>
                        &quot;{u.text}&quot; <span className="text-muted-foreground">({t('testCatalog.import.rows', { count: u.rows })})</span>
                      </Label>
                      <Select value={answer ? specimenKey(answer) : NOT_CHOSEN} onValueChange={(v) => setSpecimen(u.text, v)}>
                        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NOT_CHOSEN}>{t('testCatalog.import.notChosen')}</SelectItem>
                          {options.specimenTypes.map((s) => (
                            <SelectItem key={specimenKey(s)} value={specimenKey(s)}>{s.display ?? s.code}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Fragment>
                  );
                })}
              </div>
            )
          )}

          {step === 'review' && report && (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
                <Label className="whitespace-nowrap">{t('testCatalog.import.countNew')}</Label>
                <div>{report.counts.new}</div>
                <Label className="whitespace-nowrap">{t('testCatalog.import.countChanged')}</Label>
                <div>{report.counts.changed}</div>
                <Label className="whitespace-nowrap">{t('testCatalog.import.countUnchanged')}</Label>
                <div>{report.counts.unchanged}</div>
                <Label className="whitespace-nowrap">{t('testCatalog.import.countRefused')}</Label>
                <div>{report.counts.refused}</div>
                {report.categoriesToAdd.length > 0 && (
                  <>
                    <Label className="self-start whitespace-nowrap">{t('testCatalog.import.categoriesToAdd')}</Label>
                    <div className="flex flex-col">
                      {report.categoriesToAdd.map((c) => <span key={c.code}>{`${c.code} (${c.display})`}</span>)}
                    </div>
                  </>
                )}
                {!report.loincChecked && (
                  <div className="col-span-2 text-xs text-muted-foreground">{t('testCatalog.import.loincNotChecked')}</div>
                )}
                {writes === 0 && (
                  <div className="col-span-2 text-xs text-muted-foreground">{t('testCatalog.import.nothingToApply')}</div>
                )}
              </div>
              {report.refused.length > 0 && (
                <>
                  <div className="border-y border-border px-6 py-3 text-sm font-medium text-foreground">
                    {t('testCatalog.import.refusedTitle')}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16 pl-6">{t('testCatalog.import.colRow')}</TableHead>
                        <TableHead>{t('testCatalog.import.colCode')}</TableHead>
                        <TableHead className="pr-6">{t('testCatalog.import.colReason')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {refusedRows.map((r) => (
                        <TableRow key={`${r.line}`}>
                          <TableCell className="pl-6">{r.line}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs">{r.code ?? t('testCatalog.none')}</TableCell>
                          <TableCell className="pr-6">{r.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <TablePagination
                    page={refusedPage}
                    pageSize={refusedPageSize}
                    total={report.refused.length}
                    onPageChange={setRefusedPage}
                    onPageSizeChange={(n) => { setRefusedPageSize(n); setRefusedPage(0); }}
                  />
                </>
              )}
            </>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
