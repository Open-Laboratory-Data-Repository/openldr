import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FacilityImportResult } from '@/api';

export interface ImportPolicyPanelProps {
  onConflict: 'skip' | 'overwrite';
  onConflictChange: (v: 'skip' | 'overwrite') => void;
  onAbsent: 'retire' | 'report';
  onAbsentChange: (v: 'retire' | 'report') => void;
  onDeleted: 'retire' | 'report';
  onDeletedChange: (v: 'retire' | 'report') => void;
  allowUnknownColumns: boolean;
  onAllowUnknownColumnsChange: (v: boolean) => void;
  allowInvalidCoordinates: boolean;
  onAllowInvalidCoordinatesChange: (v: boolean) => void;
  allowMalformedRows: boolean;
  onAllowMalformedRowsChange: (v: boolean) => void;
  disabled: boolean;
  /** Whether a conflict policy can influence anything yet. The same question `showConflictChoice`
   *  answered on Review; the answer moves with the control. */
  showConflictChoice: boolean;
  /** The last check's result, or `null` before anything has read the file. Only the three
   *  issue counts are read. */
  findings: FacilityImportResult | null;
}

/** The decisions about what an import does with the differences it finds, on Mapping.
 *
 *  ⛔ THE THREE OVERRIDES ARE CONTEXTUAL, THE THREE POLICIES ARE NOT. `onConflict`/`onAbsent`/
 *  `onDeleted` are answerable before anything reads the file: they say what to do with a category of
 *  row whether or not any exist. The three `allow*` overrides are answers to a finding, and they
 *  rendered INSIDE the issue box that reported it before this panel existed. Nobody can sensibly
 *  wave through unrecognised columns before something has said there are any, so each appears only
 *  once a check has reported its own issue. Same rule as the value-mapping worklist: it shows up
 *  when there is work.
 *
 *  ⛔ NOTHING HERE PARSES. On Review these toggles re-ran the check on every click, which was right
 *  when the summary was the page you were on. Here a change is an edit: it moves `summarySignature`,
 *  `hasReview` goes false, and the operator re-checks when they choose to. Re-checking on a checkbox
 *  would spend a full validate of a national register per click. */
export function ImportPolicyPanel(props: ImportPolicyPanelProps): JSX.Element {
  const { t } = useTranslation();
  const f = props.findings;

  const rows: { key: string; label: string; node: JSX.Element }[] = [];

  // ⛔ NOT gated on a count, and deliberately so. A fresh check's own `conflict` is ALWAYS null:
  // `conflictsEvaluated` needs a `previewedAt` watermark from a PRIOR pass, which the call that just
  // minted the run can never supply for itself. A conflict can only be discovered by the apply this
  // run will later authorise, so the operator sets skip/overwrite BEFORE that apply, never after a
  // count that will not arrive. See the docblock this moved from.
  if (props.showConflictChoice) {
    rows.push({
      key: 'conflict',
      label: t('facilities.import.onConflictLabel'),
      node: (
        <Select value={props.onConflict} onValueChange={(v) => props.onConflictChange(v as 'skip' | 'overwrite')} disabled={props.disabled}>
          <SelectTrigger id="import-policy-conflict" className="w-full" aria-label={t('facilities.import.onConflictLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">{t('facilities.import.onConflictSkip')}</SelectItem>
            <SelectItem value="overwrite">{t('facilities.import.onConflictOverwrite')}</SelectItem>
          </SelectContent>
        </Select>
      ),
    });
  }

  // ⛔ GATED ON THE FINDING, exactly as it was inside the summary (`result.absent > 0` there).
  // An `absent` of 0, or of `null` meaning not evaluated, has nothing to retire, so a control here
  // would offer a choice with no effect.
  if ((f?.absent ?? 0) > 0) rows.push({
    key: 'absent',
    label: t('facilities.import.onAbsentLabel'),
    node: (
      <Select value={props.onAbsent} onValueChange={(v) => props.onAbsentChange(v as 'retire' | 'report')} disabled={props.disabled}>
        <SelectTrigger id="import-policy-absent" className="w-full" aria-label={t('facilities.import.onAbsentLabel')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="retire">{t('facilities.import.onAbsentRetire')}</SelectItem>
          <SelectItem value="report">{t('facilities.import.onAbsentReport')}</SelectItem>
        </SelectContent>
      </Select>
    ),
  });

  // Same gate as `absent`: `result.deleted > 0` was the condition inside the summary.
  if ((f?.deleted ?? 0) > 0) rows.push({
    key: 'deleted',
    label: t('facilities.import.onDeletedLabel'),
    node: (
      <Select value={props.onDeleted} onValueChange={(v) => props.onDeletedChange(v as 'retire' | 'report')} disabled={props.disabled}>
        <SelectTrigger id="import-policy-deleted" className="w-full" aria-label={t('facilities.import.onDeletedLabel')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="retire">{t('facilities.import.onDeletedRetire')}</SelectItem>
          <SelectItem value="report">{t('facilities.import.onDeletedReport')}</SelectItem>
        </SelectContent>
      </Select>
    ),
  });

  const overrides: { key: string; found: boolean; hint: string; checked: boolean; onChange: (v: boolean) => void; label: string }[] = [
    {
      key: 'unknown-columns',
      found: (f?.unknownColumns.length ?? 0) > 0,
      hint: t('facilities.import.policyFoundUnknownColumns', { count: f?.unknownColumns.length ?? 0 }),
      checked: props.allowUnknownColumns,
      onChange: props.onAllowUnknownColumnsChange,
      label: t('facilities.import.allowUnknownColumns'),
    },
    {
      key: 'quarantined',
      found: (f?.quarantined.length ?? 0) > 0,
      hint: t('facilities.import.policyFoundQuarantined', { count: f?.quarantined.length ?? 0 }),
      checked: props.allowMalformedRows,
      onChange: props.onAllowMalformedRowsChange,
      label: t('facilities.import.allowMalformedRows'),
    },
    {
      key: 'invalid',
      found: (f?.invalid.length ?? 0) > 0,
      hint: t('facilities.import.policyFoundInvalid', { count: f?.invalid.length ?? 0 }),
      checked: props.allowInvalidCoordinates,
      onChange: props.onAllowInvalidCoordinatesChange,
      label: t('facilities.import.allowInvalidCoordinates'),
    },
  ];

  return (
    <div className="space-y-2">
      <div>
        <p className="font-medium">{t('facilities.import.policyTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('facilities.import.policyHint')}</p>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
        {rows.map((r) => (
          <Fragment key={r.key}>
            <Label htmlFor={`import-policy-${r.key}`} className="break-words">{r.label}</Label>
            {r.node}
          </Fragment>
        ))}
      </div>
      {overrides.filter((o) => o.found).map((o) => (
        <label key={o.key} className="flex items-start gap-2 text-xs">
          <Checkbox
            checked={o.checked}
            disabled={props.disabled}
            onCheckedChange={(c) => o.onChange(c === true)}
            aria-label={o.label}
          />
          <span>
            <span className="block">{o.label}</span>
            <span className="block text-muted-foreground">{o.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
