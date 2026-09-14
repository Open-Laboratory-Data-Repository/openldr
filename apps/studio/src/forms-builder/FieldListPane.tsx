import React, { useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ChevronDown, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { groupRepeats, type FormField, type FormLintIssue, type FormSection } from '@openldr/forms/pure';
import { SortableFieldRow } from './SortableFieldRow';
import { SectionsManager } from './SectionsManager';
import { buildFieldTree, type RepeatNode, type TreeNode } from './fieldTree';
import { AddNamedSlotRow, RepeatRow } from './RepeatRow';
import { buildFieldListModel } from './listOrder';
import { SectionVisibilitySheet } from './SectionVisibilitySheet';
import { BulkSelectionMenu } from './BulkSelectionMenu';
import { SectionDropPanel, dropAction } from './SectionDropPanel';

export interface FieldListPaneProps {
  fields: FormField[];
  sections?: FormSection[];
  /** The selected rows. Two or more turn the header into the selection menu. */
  selectedIds: ReadonlySet<string>;
  /** The row Shift-click ranges from and j and k move. */
  anchorId?: string | null;
  onBulkMove?: (sectionId: string | undefined) => void;
  onBulkToggleEnabled?: () => void;
  onBulkDelete?: () => void;
  onClearSelection?: () => void;
  issues: FormLintIssue[];
  onSelect: (f: FormField, e: React.MouseEvent) => void;
  onToggleEnabled: (id: string) => void;
  onToggleRequired: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
  /** Drop a dragged field on a section, or on "(no section)" with undefined. */
  onMoveToSection?: (fieldId: string, sectionId: string | undefined) => void;
  onSectionsChange?: (sections: FormSection[]) => void;
  onFieldsClearSection?: (sectionId: string) => void;
  /** Add another named slot under a repeating list. */
  onAddSlot?: (node: RepeatNode) => void;
  /** The form's resource type. A group's "holds one or many" reads its bound path against it. */
  fhirResourceType?: string | null;
  /** The list search, when the page drives it. The list keeps its own when these are absent. */
  searchText?: string;
  onSearchTextChange?: (text: string) => void;
}

export function FieldListPane({
  fields,
  sections = [],
  selectedIds,
  anchorId = null,
  onBulkMove,
  onBulkToggleEnabled,
  onBulkDelete,
  onClearSelection,
  issues,
  onSelect,
  onToggleEnabled,
  onToggleRequired,
  onDuplicate,
  onDelete,
  onReorder,
  onMoveToSection,
  onSectionsChange,
  onFieldsClearSection,
  onAddSlot,
  fhirResourceType = null,
  searchText,
  onSearchTextChange,
}: FieldListPaneProps): JSX.Element {
  const [localSearch, setLocalSearch] = useState('');
  const search = searchText ?? localSearch;
  const setSearch = onSearchTextChange ?? setLocalSearch;
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [visibilitySectionId, setVisibilitySectionId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor));

  const enabledCount = useMemo(
    () => fields.filter((f) => f.enabled).length,
    [fields],
  );

  const model = useMemo(() => buildFieldListModel(fields, sections, search), [fields, sections, search]);
  const sortedSections = useMemo(() => [...sections].sort((a, b) => a.order - b.order), [sections]);

  const [dragging, setDragging] = useState(false);
  const fieldCountBySection = useMemo(() => {
    const out: Record<string, number> = {};
    for (const f of fields) if (f.section) out[f.section] = (out[f.section] ?? 0) + 1;
    return out;
  }, [fields]);
  const unsectionedCount = fields.filter((f) => !f.section).length;

  function handleDragEnd(event: DragEndEvent) {
    setDragging(false);
    const action = dropAction(String(event.active.id), event.over ? String(event.over.id) : null);
    if (!action) return;
    if (action.kind === 'section') onMoveToSection?.(action.fieldId, action.sectionId);
    else onReorder(action.activeId, action.overId);
  }

  function issueForField(fieldId: string): FormLintIssue | undefined {
    return issues.find((i) => i.fieldId === fieldId);
  }

  /**
   * One field, then its group children at any depth. A group's parts hang off a dashed guide;
   * a repeat's slots (below) hang off a solid one, so the two kinds of nesting do not read alike.
   */
  function renderField(field: FormField): React.ReactNode {
    const children = field.fieldType === 'group' ? model.childrenByGroup.get(field.id) ?? [] : [];
    return (
      <React.Fragment key={field.id}>
        <SortableFieldRow
          field={field}
          selected={selectedIds.has(field.id)}
          anchor={field.id === anchorId}
          lintIssue={issueForField(field.id)}
          repeats={groupRepeats(field, fhirResourceType)}
          onSelect={onSelect}
          onToggleEnabled={onToggleEnabled}
          onToggleRequired={onToggleRequired}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
        {children.length > 0 && (
          // border-0 first: here a border is hidden by its style, not its width, so border-dashed
          // alone would draw all four sides at the default width instead of the left guide.
          <div data-nested="true" className="ml-3 space-y-1.5 border-0 border-l-2 border-dashed border-border pl-3">
            {children.map((child) => renderField(child))}
          </div>
        )}
      </React.Fragment>
    );
  }

  function renderNode(node: TreeNode): React.ReactNode {
    if (node.kind === 'field') return renderField(node.field);
    return (
      <div key={`repeat:${node.path}`}>
        <RepeatRow node={node} />
        <div data-nested="true" className="ml-3 space-y-1.5 border-l-2 border-border pl-3">
          {node.slots.map((slot) => renderField(slot))}
          {onAddSlot && <AddNamedSlotRow onAdd={() => onAddSlot(node)} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header: count, search and Sections on one row, as in corlix's FormBuilderPage. Two or
          more selected rows give the whole row to the selection menu, as corlix does. It wraps
          rather than scrolls on a phone, where the three do not fit side by side. */}
      <div data-list-header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        {selectedIds.size >= 2 ? (
          <BulkSelectionMenu
            count={selectedIds.size}
            sections={sortedSections}
            onMove={(sectionId) => onBulkMove?.(sectionId)}
            onToggleEnabled={() => onBulkToggleEnabled?.()}
            onDelete={() => onBulkDelete?.()}
            onClear={() => onClearSelection?.()}
          />
        ) : (
          <>
            {/* m-0: studio ships Tailwind without its reset (tokens.css), so a bare <p> keeps the
                browser's 1em margin and makes this row 57px tall instead of 44px. */}
            <p className="m-0 text-xs text-muted-foreground">
              {fields.length} fields ({enabledCount} enabled)
            </p>
            <span aria-hidden="true" className="text-muted-foreground">·</span>
            <div data-list-search className="relative w-48 min-w-0 max-w-full">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="builder-field-search"
                aria-label="Search fields"
                placeholder="Search fields…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 pl-7 pr-7 text-xs"
              />
              {search && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                  className="absolute right-1 top-1/2 h-5 w-5 -translate-y-1/2 hover:bg-transparent"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <Popover open={sectionsOpen} onOpenChange={setSectionsOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                  Sections <span className="text-muted-foreground">({sections.length})</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-0">
                <SectionsManager
                  sections={sections}
                  onChange={(s) => onSectionsChange?.(s)}
                  onFieldsClearSection={(sid) => onFieldsClearSection?.(sid)}
                  // The popover closes first. The sheet lives outside it, or it would unmount with it.
                  onEditVisibility={(id) => { setSectionsOpen(false); setVisibilitySectionId(id); }}
                />
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => setDragging(true)}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(false)}
        >
          {sections.length > 0 && (
            <SectionDropPanel
              visible={dragging}
              sections={sortedSections}
              fieldCountBySection={fieldCountBySection}
              unsectionedCount={unsectionedCount}
            />
          )}
          {/* SortableContext items stay flat over all visible ids so reorder still works */}
          <SortableContext
            items={model.visible.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            {model.showSectionHeaders ? (
              model.buckets.map(({ sectionId, label, fields: fieldList }) => (
                <div key={sectionId ?? '__no_section__'}>
                  {/* Section header */}
                  <div className="px-1 py-1 mt-1 first:mt-0">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {label}
                    </span>
                  </div>

                  {/* Fields in this section */}
                  <div className="space-y-1.5">
                    {buildFieldTree(fieldList).map(renderNode)}
                  </div>
                </div>
              ))
            ) : (
              // No sections: top-level nodes; children render under their group.
              <div className="space-y-1.5">{buildFieldTree(model.buckets[0]?.fields ?? []).map(renderNode)}</div>
            )}
          </SortableContext>
        </DndContext>
      </div>

      <SectionVisibilitySheet
        section={sections.find((s) => s.id === visibilitySectionId) ?? null}
        fields={fields}
        onChange={(id, rule) =>
          onSectionsChange?.(sections.map((s) => (s.id === id ? { ...s, visibility: rule } : s)))
        }
        onOpenChange={(open) => { if (!open) setVisibilitySectionId(null); }}
      />
    </div>
  );
}
