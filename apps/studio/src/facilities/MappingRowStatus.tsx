import { Check, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { MappingRowState } from './mappingRowState';

/** Per-row status icon for the column-mapping step.
 *
 *  Always clickable, in every state, by the operator's own decision: a re-check is never gated
 *  on the app agreeing that something changed. `busy` is rendered as a no-op instead of a
 *  disabled control, because a disabled control would contradict that decision visually, so the
 *  click handler is the thing that guards against a second check firing mid-run.
 *
 *  Neutral and stale share one gray tick by the same decision: a second glyph to tell them apart
 *  was considered and rejected. The `aria-label` and a real tooltip now carry the same wording,
 *  so a screen reader and a sighted mouse user both get the difference the icon does not show.
 *
 *  This wraps itself in its own `TooltipProvider`, the pattern `truncated-text.tsx` already
 *  uses. That way it works wherever it lands, and does not depend on the caller remembering to
 *  add a provider. Radix allows nested providers, so this is safe under `AppShell.tsx`'s own
 *  top-level one too.
 *
 *  KNOWN GAP: a Radix Tooltip does not open on touch. Its pointer handler bails when
 *  `pointerType === 'touch'`. On a phone, neutral and stale still look the same with no way to
 *  tell them apart. That is a real limit of this control, not something worked around here. How
 *  the per-field check should read on a phone needs its own decision, later. */
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

  const statusText = (() => {
    switch (state) {
      case 'valid':
        return t('facilities.import.columnMap.rowStatusValid', { header: label });
      case 'invalid':
        return t('facilities.import.columnMap.rowStatusInvalid', {
          header: label,
          // `detail` is null when the caller has not told us the cause. Fall back to wording
          // that only says what is certain. Guessing "collides" could name the wrong cause: the
          // real problem might be unrecognised values from a per-field check instead.
          detail: detail ?? t('facilities.import.columnMap.rowStatusUnknown'),
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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={statusText}
            onClick={() => { if (!busy) onCheck(); }}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{statusText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
