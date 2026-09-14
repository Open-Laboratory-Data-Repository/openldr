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
}: FieldListPaneProps): JSX.Element {
  const [searchText, setSearchText] = useState('');

  const sensors = useSensors(useSensor(PointerSensor));

  // Section label lookup: prefer the sections prop, fall back to the id itself
  const sectionLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sections) {
      map.set(s.id, s.label);
    }
    return map;
  }, [sections]);

  const enabledCount = useMemo(
    () => fields.filter((f) => f.enabled).length,
    [fields],
  );

  // Filter + sort — exclude group children from the top-level list here;
  // they will be rendered inline under their parent group field.
  const visibleFields = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return fields
      .filter((f) => {
        if (q) {
          const labelMatch = f.displayLabel.toLowerCase().includes(q);
          const pathMatch = f.fhirPath?.toLowerCase().includes(q) ?? false;
          return labelMatch || pathMatch;
        }
        return true;
      })
      .slice()
      .sort((a, b) => a.order - b.order);
  }, [fields, searchText]);

  // Top-level visible fields (not children of a group)
  const topLevelVisible = useMemo(
    () => visibleFields.filter((f) => !f.groupId),
    [visibleFields],
  );

  // Children grouped by groupId
  const childrenByGroup = useMemo(() => {
    const map = new Map<string, FormField[]>();
    for (const f of visibleFields) {
      if (f.groupId) {
        const arr = map.get(f.groupId) ?? [];
        arr.push(f);
        map.set(f.groupId, arr);
      }
    }
    return map;
  }, [visibleFields]);

  // Group top-level fields by section for rendering with headers.
  // Order of sections: use sections prop order, then any remaining section ids from fields.
  const sectionGroups = useMemo(() => {
    // Build ordered list of section identifiers
    const orderedSectionIds: Array<string | null> = sections
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);

    // Add any field sections not in the sections prop
    for (const f of topLevelVisible) {
      if (f.section && !orderedSectionIds.includes(f.section)) {
        orderedSectionIds.push(f.section);
      }
    }

    // null = "No section" bucket
    const hasUnsectioned = topLevelVisible.some((f) => !f.section);
    if (hasUnsectioned) {
      orderedSectionIds.push(null);
    }

    // Build groups — only include sections that have at least one field
    const groups: Array<{ sectionId: string | null; label: string; fieldList: FormField[] }> = [];
    for (const sectionId of orderedSectionIds) {
      const fieldList = topLevelVisible.filter((f) =>
        sectionId === null ? !f.section : f.section === sectionId,
      );
      if (fieldList.length === 0) continue;
      const label =
        sectionId === null
          ? 'No section'
          : (sectionLabelMap.get(sectionId) ?? sectionId);
      groups.push({ sectionId, label, fieldList });
    }
    return groups;
  }, [topLevelVisible, sections, sectionLabelMap]);

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
    const children = field.fieldType === 'group' ? childrenByGroup.get(field.id) ?? [] : [];
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

  // Show section grouping only when there are sections defined or fields span multiple sections
  const distinctSections = useMemo(() => {
    const seen = new Set<string>();
    for (const f of fields) {
      if (f.section) seen.add(f.section);
    }
    return Array.from(seen);
  }, [fields]);

  const showSectionHeaders = sections.length > 0 || distinctSections.length > 1;

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
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-7 h-8 text-sm"
          />
        </div>

        {/* Sections popover — trigger shows count; content is SectionsManager */}
        <Popover>
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
            items={visibleFields.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            {showSectionHeaders ? (
              sectionGroups.map(({ sectionId, label, fieldList }) => (
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
              <div className="space-y-1.5">{buildFieldTree(topLevelVisible).map(renderNode)}</div>
            )}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
