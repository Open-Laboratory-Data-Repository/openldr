import { CheckCircle2, AlertCircle, Info, RefreshCw } from 'lucide-react';
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
 *  ⛔ FOUR STATES, FOUR SHAPES. A Radix Tooltip does not open on touch: its pointer handler bails
 *  when `pointerType === 'touch'`. The operator's primary device is a phone over Tailscale, and
 *  AGENTS.md section 6 item 4 makes the mobile view part of done, so any two states sharing a
 *  shape are the same picture on the device that matters most, with no way to reach the
 *  difference. Unchecked is an amber `Info`, valid a green `CheckCircle2`, invalid a red
 *  `AlertCircle`, stale the circular arrows that read as "check this again". Three circles and one
 *  deliberate non-circle: stale has to stay tellable from the other three at a glance, and it is
 *  the only state whose message is an instruction rather than a verdict.
 *
 *  ⛔ UNCHECKED IS NOT A TICK, and that is a reversal, not an oversight. It used to be a gray tick,
 *  the same shape as valid in a quieter colour, which on the real Zambia export read as a pass on
 *  the two rows that most needed a click (see `mappingRowState.ts`'s own note on the dropped
 *  auto-green). A row nobody has looked at now wears the colour this feature already uses for
 *  "needs a decision" and a shape that belongs to no verdict.
 *
 *  This wraps itself in its own `TooltipProvider`, the pattern `truncated-text.tsx` already
 *  uses. That way it works wherever it lands, and does not depend on the caller remembering to
 *  add a provider. Radix allows nested providers, so this is safe under `AppShell.tsx`'s own
 *  top-level one too. The tooltip is still the only carrier of a row's DETAIL on a phone, which is
 *  acceptable: the detail also renders as a visible line under the row (`rowNotice` in
 *  `ColumnMapStep.tsx`), so nothing is reachable by hover alone. */
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
      ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      : state === 'invalid'
        ? <AlertCircle className="h-4 w-4 text-destructive" />
        : state === 'stale'
          // Not a warning colour. A stale row is not wrong, it just has not been looked at since it
          // changed, so it stays quieter than unchecked and differs in shape from everything else.
          ? <RefreshCw className="h-4 w-4 text-muted-foreground" />
          : <Info className="h-4 w-4 text-amber-600" />;

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
