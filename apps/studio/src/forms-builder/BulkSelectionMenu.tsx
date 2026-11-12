import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FormSection } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The list header while two or more fields are selected: the count and one ⋯ menu. Corlix shows
 * standalone buttons here (`components/FieldBulkActionBar.tsx`); AGENTS.md §5 puts them in the menu.
 * The move targets are flat items, not a submenu, which jsdom cannot open reliably and a phone reads
 * badly.
 */
export function BulkSelectionMenu({
  count,
  sections,
  onMove,
  onToggleEnabled,
  onDelete,
  onClear,
}: {
  count: number;
  sections: FormSection[];
  onMove: (sectionId: string | undefined) => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onClear: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <p className="text-xs font-medium text-foreground">{t('formBuilder.bulk.selected', { count })}</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('formBuilder.bulk.actions')}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onMove(undefined)}>{t('formBuilder.bulk.moveToNone')}</DropdownMenuItem>
          {sections.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => onMove(s.id)}>{t('formBuilder.bulk.moveTo', { section: s.label })}</DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onToggleEnabled()}>{t('formBuilder.bulk.toggleEnabled')}</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete()}>
            {t('formBuilder.bulk.delete')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onClear()}>{t('formBuilder.bulk.clear')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
