import { useDroppable } from '@dnd-kit/core';
import type { FormSection } from '@openldr/forms/pure';

const TARGET_PREFIX = 'section-target:';
const NO_SECTION_KEY = '__none__';

/** The drop target id for a section, or for "(no section)" when `sectionId` is undefined. */
export const sectionDropTargetId = (sectionId: string | undefined): string =>
  TARGET_PREFIX + (sectionId ?? NO_SECTION_KEY);

/**
 * Null when `overId` is not a section target, which means a field, for a reorder. Undefined for
 * "(no section)". Otherwise the section id. Ported from corlix `components/SectionDropPanel.tsx`.
 */
export function parseSectionDropTargetId(overId: string): string | undefined | null {
  if (!overId.startsWith(TARGET_PREFIX)) return null;
  const id = overId.slice(TARGET_PREFIX.length);
  return id === NO_SECTION_KEY ? undefined : id;
}

export type DropAction =
  | { kind: 'section'; fieldId: string; sectionId: string | undefined }
  | { kind: 'reorder'; activeId: string; overId: string };

/** What a drop does. Only the dragged field moves, as in corlix `pages/FormBuilderPage.tsx:481-500`. */
export function dropAction(activeId: string, overId: string | null): DropAction | null {
  if (!overId) return null;
  const sectionId = parseSectionDropTargetId(overId);
  if (sectionId !== null) return { kind: 'section', fieldId: activeId, sectionId };
  if (activeId === overId) return null;
  return { kind: 'reorder', activeId, overId };
}

function DropRow({ id, label, count }: { id: string; label: string; count: number }): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center justify-between rounded-md border border-dashed px-3 py-1.5 text-xs transition-colors ${
        isOver ? 'border-primary bg-primary/10 ring-2 ring-primary/60' : 'border-border bg-background/40'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="text-[10px] text-muted-foreground">{count}</span>
    </div>
  );
}

/**
 * While a field is dragged, the sections it can land on, at the top of the list. It stays mounted
 * and folds away when idle, as corlix's does, so its drop targets exist before a drag starts.
 */
export function SectionDropPanel({
  visible,
  sections,
  fieldCountBySection,
  unsectionedCount,
}: {
  visible: boolean;
  sections: FormSection[];
  fieldCountBySection: Record<string, number>;
  unsectionedCount: number;
}): JSX.Element {
  return (
    <div
      aria-hidden={!visible}
      className={`mb-3 overflow-hidden transition-all duration-150 ease-out ${
        visible ? 'max-h-72 translate-y-0 opacity-100' : 'max-h-0 -translate-y-2 opacity-0'
      }`}
    >
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Drop on a section to reassign</p>
      <div className="space-y-1.5">
        <DropRow id={sectionDropTargetId(undefined)} label="(no section)" count={unsectionedCount} />
        {sections.map((s) => (
          <DropRow key={s.id} id={sectionDropTargetId(s.id)} label={s.label} count={fieldCountBySection[s.id] ?? 0} />
        ))}
      </div>
    </div>
  );
}
