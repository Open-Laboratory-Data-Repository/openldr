import type { FormField, FormSection, VisibilityRule } from '@openldr/forms/pure';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { VisibilityRuleEditor } from './field-editor/VisibilityRuleEditor';

/**
 * A section's visibility rule. Data entry already honours it (`packages/forms/src/visibility.ts:97`),
 * so this is the builder's missing piece. Edits apply as they are made, like the section label, so
 * the sheet has no actions and its close control is the only one. Corlix uses a Dialog with a Done
 * button; AGENTS.md §5 wants a Sheet. Only enabled fields can gate a section, as in corlix
 * `FormBuilderPage.tsx:1932`.
 */
export function SectionVisibilitySheet({
  section,
  fields,
  onChange,
  onOpenChange,
}: {
  section: FormSection | null;
  fields: FormField[];
  onChange: (sectionId: string, rule: VisibilityRule | undefined) => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Sheet open={section !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>Visibility</SheetTitle>
          <SheetDescription>
            {section
              ? `Show ${section.label} only when conditions on other fields are met. No conditions means always visible.`
              : ''}
          </SheetDescription>
        </SheetHeader>
        {section && (
          <div className="px-6">
            <VisibilityRuleEditor
              rule={section.visibility}
              candidateFields={fields.filter((f) => f.enabled)}
              onChange={(rule) => onChange(section.id, rule)}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
