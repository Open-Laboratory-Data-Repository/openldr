import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Eye, EyeOff, FolderClosed, Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import type { DesignElement, ElementGroup, ReportTemplate } from './types';
import { KIND_ICON } from './elementIcons';

interface Props {
  template: ReportTemplate;
  selectedIds: string[];
  onSelect(ids: string[]): void;
  onPatchElement(id: string, patch: Partial<DesignElement>, opts?: { discrete?: boolean }): void;
  /** Move the element to this ARRAY index within its page (array order is z-order). */
  onReorder(id: string, targetIndex: number): void;
  /** Patch one group's flags; an undefined value clears it. */
  onPatchGroup?(groupId: string, patch: { locked?: boolean; hidden?: boolean }): void;
  /** Drop a group, leaving its elements untouched. */
  onUngroup?(groupId: string): void;
}

export function LayersTab({ template, selectedIds, onSelect, onPatchElement, onReorder, onPatchGroup, onUngroup }: Props): JSX.Element {
  const { t } = useTranslation();
  // Drag state lives here, not in dataTransfer: jsdom and touch browsers agree on component state,
  // and nothing outside this list ever needs the dragged id.
  const [dragId, setDragId] = useState<string | null>(null);
  // topmost (last-painted) element first
  const elements = template.pages.flatMap((p) => p.elements).slice().reverse();
  const groups = new Map<string, ElementGroup>(
    template.pages.flatMap((p) => p.groups ?? []).map((g) => [g.id, g]),
  );
  // The list paints topmost first, so a group's header belongs above its topmost member.
  const headerBefore = new Set<string>();
  const seenGroups = new Set<string>();
  for (const el of elements) {
    if (el.groupId && groups.has(el.groupId) && !seenGroups.has(el.groupId)) {
      seenGroups.add(el.groupId);
      headerBefore.add(el.id);
    }
  }
  const toggle = (id: string, additive: boolean) =>
    onSelect(additive ? (selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]) : [id]);
  const arrayIndex = (id: string): number => {
    const page = template.pages.find((p) => p.elements.some((e) => e.id === id));
    return page ? page.elements.findIndex((e) => e.id === id) : -1;
  };
  const pageLen = (id: string): number => {
    const page = template.pages.find((p) => p.elements.some((e) => e.id === id));
    return page ? page.elements.length : 0;
  };
  return (
    <div>
      {elements.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">{t('reportDesigner.noElements')}</p>}
      {elements.map((el) => {
        const Icon = KIND_ICON[el.kind];
        const active = selectedIds.includes(el.id);
        const idx = arrayIndex(el.id);
        const len = pageLen(el.id);
        const group = el.groupId ? groups.get(el.groupId) : undefined;
        return (
          <div key={`row-${el.id}`}>
          {headerBefore.has(el.id) && group && (
            <div data-testid={`layer-group-${group.id}`}
              className="flex items-center gap-1 border-b border-border bg-muted/50 px-2 py-1.5">
              <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{group.name}</span>
              <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                aria-label={`${t(group.hidden ? 'reportDesigner.showElement' : 'reportDesigner.hideElement')} ${group.name}`}
                onClick={() => onPatchGroup?.(group.id, { hidden: group.hidden ? undefined : true })}>
                {group.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                aria-label={`${t(group.locked ? 'reportDesigner.unlockElement' : 'reportDesigner.lockElement')} ${group.name}`}
                onClick={() => onPatchGroup?.(group.id, { locked: group.locked ? undefined : true })}>
                {group.locked ? <Lock className="h-3.5 w-3.5 text-amber-500" /> : <Unlock className="h-3.5 w-3.5" />}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-[10px]"
                aria-label={`${t('reportDesigner.ungroup')} ${group.name}`}
                onClick={() => onUngroup?.(group.id)}>
                {t('reportDesigner.ungroup')}
              </Button>
            </div>
          )}
          <div data-testid={`layer-${el.id}`} draggable
            onDragStart={() => setDragId(el.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragId && dragId !== el.id) onReorder(dragId, idx); setDragId(null); }}
            onDragEnd={() => setDragId(null)}
            className={cn('flex items-center border-b border-border pr-1 transition-colors',
              group && 'pl-3',
              active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
              el.hidden && 'opacity-50')}>
            <button onClick={(e) => toggle(el.id, e.shiftKey)}
              aria-label={el.name || t('reportDesigner.layer', { defaultValue: 'Layer' })}
              aria-pressed={active}
              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm">
              <Icon className="h-4 w-4 shrink-0" /> <TruncatedText text={el.name} className="min-w-0" />
            </button>
            {/* Toggles delete the key when returning to the default, the setStatusKey idiom. */}
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0"
              aria-label={`${t(el.hidden ? 'reportDesigner.showElement' : 'reportDesigner.hideElement')} ${el.name}`}
              onClick={() => onPatchElement(el.id, { hidden: el.hidden ? undefined : true }, { discrete: true })}>
              {el.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0"
              aria-label={`${t(el.locked ? 'reportDesigner.unlockElement' : 'reportDesigner.lockElement')} ${el.name}`}
              onClick={() => onPatchElement(el.id, { locked: el.locked ? undefined : true }, { discrete: true })}>
              {el.locked ? <Lock className="h-3.5 w-3.5 text-amber-500" /> : <Unlock className="h-3.5 w-3.5" />}
            </Button>
            <div className="flex shrink-0 flex-col">
              {/* Display-up means later in the array: the list paints topmost first. */}
              <Button type="button" variant="ghost" size="icon" className="h-3.5 w-5"
                aria-label={`${t('reportDesigner.raiseElement')} ${el.name}`} disabled={idx >= len - 1}
                onClick={() => onReorder(el.id, idx + 1)}>
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-3.5 w-5"
                aria-label={`${t('reportDesigner.lowerElement')} ${el.name}`} disabled={idx <= 0}
                onClick={() => onReorder(el.id, idx - 1)}>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>
          </div>
          </div>
        );
      })}
    </div>
  );
}
