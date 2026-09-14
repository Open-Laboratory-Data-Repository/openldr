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
import { Search } from 'lucide-react';
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

export interface FieldListPaneProps {
  fields: FormField[];
  sections?: FormSection[];
  selectedFieldId: string | null;
  issues: FormLintIssue[];
  onSelect: (f: FormField, e: React.MouseEvent) => void;
  onToggleEnabled: (id: string) => void;
  onToggleRequired: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
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
  selectedFieldId,
  issues,
  onSelect,
  onToggleEnabled,
  onToggleRequired,
  onDuplicate,
  onDelete,
  onReorder,
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id));
    }
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
          selected={field.id === selectedFieldId}
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
      {/* Header */}
      <div className="px-3 py-2 border-b space-y-2">
        {/* Counter */}
        <p className="text-xs text-muted-foreground">
          {fields.length} fields ({enabledCount} enabled)
        </p>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            aria-label="Search fields"
            placeholder="Search fields…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-8 text-sm"
          />
        </div>

        {/* Sections popover — trigger shows count; content is SectionsManager */}
        <Popover open={sectionsOpen} onOpenChange={setSectionsOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-between text-xs h-8">
              {`Sections (${sections.length})`}
              <span className="ml-1 text-muted-foreground">▾</span>
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
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
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
