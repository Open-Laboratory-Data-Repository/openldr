import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VisibilityRule } from '@openldr/forms/pure';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Marks a field or section that shows only when its conditions hold. Corlix draws it on field rows
 * (`FieldRow.tsx:273`) and section rows (`SectionListRow.tsx:55`). Radix tooltips do not open on
 * touch, hence the aria-label, as on the repeat marker.
 */
export function VisibilityMarker({ rule }: { rule: VisibilityRule | undefined }): JSX.Element | null {
  const { t } = useTranslation();
  if (!rule || rule.conditions.length === 0) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={t('formBuilder.list.conditional')}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
          >
            <GitBranch className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('formBuilder.list.conditional')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
