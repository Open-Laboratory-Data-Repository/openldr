import { AlertCircle, AlertTriangle } from 'lucide-react';
import type { FormLintIssue } from '@openldr/forms/pure';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The lint banner, as corlix's FormBuilderPage draws it: an icon, only the counts that are not
 * zero, and red once there is an error. It used to read "0 errors, 3 warnings" in amber-800, which
 * measured 2.15:1 against the dark theme's ground. amber-400 there measures 8.84:1.
 */
export function LintSummary({ issues }: { issues: FormLintIssue[] }): JSX.Element | null {
  if (issues.length === 0) return null;
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  const parts = [errors > 0 ? count(errors, 'error') : null, warnings > 0 ? count(warnings, 'warning') : null];
  const Icon = errors > 0 ? AlertCircle : AlertTriangle;
  return (
    <div
      role="status"
      className={
        'flex items-center gap-2 rounded-md border px-3 py-2 text-xs ' +
        (errors > 0
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-400')
      }
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span>{parts.filter(Boolean).join(', ')}</span>
    </div>
  );
}
