import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { catalogResultParams, type CatalogResultParam, type CatalogRejectReason, type CatalogSexOption, type CatalogTestParams } from '@/api';
import type { CodingAnswer, TestDetail, TestDetailsAnswer } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { TestDetailSheet } from './TestDetailSheet';
import { RejectSheet } from './RejectSheet';
import { RANGE_EN, type RangeCopy } from './rangeLabel';

/**
 * Chrome copy. FormRuntime is schema-driven and has no i18n of its own (FormRuntime.tsx:84-92), so
 * the caller that does have one supplies these. Every key falls back to English.
 */
export interface TestDetailsCopy extends RangeCopy {
  empty?: string;
  loading?: string;
  open?: string;
  reject?: string;
  remove?: string;
  noSpecimen?: string;
  rejected?: string;
}

const EN: Required<TestDetailsCopy> = {
  ...RANGE_EN,
  empty: 'No tests chosen yet.',
  loading: 'Reading the tests',
  open: 'Open',
  reject: 'Reject with reason',
  remove: 'Remove from order',
  noSpecimen: 'Specimen type not set',
  rejected: 'Rejected',
};

const keyOf = (c: { system: string; code: string }): string => `${c.system}|${c.code}`;
const EMPTY_DETAIL: TestDetail = { specimen: null, rejection: null, results: [] };

export function TestDetailsField({ tests, value, onChange, onRemoveTest, patient, copy }: {
  tests: CodingAnswer[];
  value: TestDetailsAnswer;
  onChange: (value: TestDetailsAnswer) => void;
  /** Removing a test drops it from the Tests answer too, which this field does not own. */
  onRemoveTest: (test: { system: string; code: string }) => void;
  patient: { reference: string } | null;
  copy?: TestDetailsCopy;
}): JSX.Element {
  const t = { ...EN, ...(copy ?? {}) };
  const [params, setParams] = useState<CatalogTestParams[]>([]);
  const [reasons, setReasons] = useState<{ order: CatalogRejectReason[]; test: CatalogRejectReason[] }>({ order: [], test: [] });
  const [sexes, setSexes] = useState<CatalogSexOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [openTest, setOpenTest] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);

  // Keyed on the chosen codes, not the array, which is new on every render. Same shape as the
  // narrowing effect S4 added to ReferencePicker.
  const testsKey = tests.map(keyOf).join('\n');
  useEffect(() => {
    if (!testsKey) { setParams([]); return; }
    let cancelled = false;
    setBusy(true);
    catalogResultParams(tests.map(({ system, code }) => ({ system, code })), patient)
      .then((answer) => { if (!cancelled) { setParams(answer.tests); setReasons(answer.rejectReasons); setSexes(answer.sexes); } })
      .catch(() => { if (!cancelled) setParams([]); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testsKey, patient?.reference]);

  if (tests.length === 0) {
    return <StripedEmpty className="min-h-[8rem]"><span className="text-sm text-muted-foreground">{t.empty}</span></StripedEmpty>;
  }
  if (busy) return <LoadingState className="min-h-[8rem]" label={t.loading} />;

  const paramsFor = (test: CodingAnswer): CatalogResultParam[] =>
    params.find((p) => keyOf(p.test) === keyOf(test))?.params ?? [];
  const detailFor = (test: CodingAnswer): TestDetail => value[keyOf(test)] ?? EMPTY_DETAIL;
  const write = (test: CodingAnswer, detail: TestDetail): void => onChange({ ...value, [keyOf(test)]: detail });

  const stateLine = (test: CodingAnswer): string => {
    const detail = detailFor(test);
    if (detail.rejection) return `${t.rejected}: ${detail.rejection.display ?? detail.rejection.code}`;
    return detail.specimen ? (detail.specimen.display ?? detail.specimen.code) : t.noSpecimen;
  };

  const open = tests.find((test) => keyOf(test) === openTest);
  const reject = tests.find((test) => keyOf(test) === rejecting);

  return (
    <div className="rounded-md border border-border">
      {tests.map((test) => (
        <div key={keyOf(test)} className="flex items-start gap-3 border-b border-border p-3 last:border-b-0">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenTest(keyOf(test))}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs">{test.code}</span>
              <span className="text-sm font-medium">{test.display ?? test.code}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{stateLine(test)}</div>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${test.display ?? test.code}`}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setOpenTest(keyOf(test))}>{t.open}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRejecting(keyOf(test))}>{t.reject}</DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onRemoveTest({ system: test.system, code: test.code })}
              >
                {t.remove}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}

      {open ? (
        <TestDetailSheet
          test={open}
          params={paramsFor(open)}
          detail={detailFor(open)}
          sexes={sexes}
          copy={copy}
          onChange={(detail) => write(open, detail)}
          onClose={() => setOpenTest(null)}
        />
      ) : null}
      {reject ? (
        <RejectSheet
          level="test"
          reasons={reasons.test}
          onReject={(reason) => { write(reject, { ...detailFor(reject), rejection: reason }); setRejecting(null); }}
          onClose={() => setRejecting(null)}
        />
      ) : null}
    </div>
  );
}
