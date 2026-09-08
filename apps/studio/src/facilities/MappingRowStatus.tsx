import { Check, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { MappingRowState } from './mappingRowState';

/** Per-row status icon for the column-mapping step.
 *
 *  Always clickable, in every state, by the operator's own decision: a re-check is never gated
 *  on the app agreeing that something changed. `busy` is rendered as a no-op instead of a
 *  disabled control, because a disabled control would contradict that decision visually, so the
 *  click handler is the thing that guards against a second check firing mid-run.
 *
 *  Neutral and stale share one gray tick by the same decision: a second glyph to tell them apart
 *  was considered and rejected. The tooltip (the accessible name) is what carries the difference. */
export function MappingRowStatus({
  state,
  label,
  busy,
  detail,
  onCheck,
}: {
  state: MappingRowState;
  label: string;
  busy: boolean;
  detail: string | null;
  onCheck: () => void;
}): JSX.Element {
  const { t } = useTranslation();

  const ariaLabel = (() => {
    switch (state) {
      case 'valid':
        return t('facilities.import.columnMap.rowStatusValid', { header: label });
      case 'invalid':
        return t('facilities.import.columnMap.rowStatusInvalid', {
          header: label,
          detail: detail ?? t('facilities.import.columnMap.rowStatusCollides'),
        });
      case 'stale':
        return t('facilities.import.columnMap.rowStatusStale', { header: label });
      case 'neutral':
      default:
        return t('facilities.import.columnMap.rowStatusNeutral', { header: label });
    }
  })();

  const icon = busy
    ? <Spinner />
    : state === 'valid'
      ? <Check className="h-4 w-4 text-emerald-600" />
      : state === 'invalid'
        ? <AlertCircle className="h-4 w-4 text-destructive" />
        : <Check className="h-4 w-4 text-muted-foreground" />;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      aria-label={ariaLabel}
      onClick={() => { if (!busy) onCheck(); }}
    >
      {icon}
    </Button>
  );
}
