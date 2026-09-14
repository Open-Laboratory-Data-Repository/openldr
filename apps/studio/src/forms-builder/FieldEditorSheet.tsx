import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { FormField, FormSchema } from '@openldr/forms/pure';
import { FieldType, childrenOf, eligibleParents, groupRepeats, isSurveyForm } from '@openldr/forms/pure';
import { ReferenceEditor } from './field-editor/ReferenceEditor';
import { OptionsBlock } from './field-editor/OptionsBlock';
import { lookupBinding } from '@openldr/fhir/paths';
import { findValueSetByUrl, storedValueSetCodes } from '../api';
import { autoBindApplies, bindingUpdates, codesToOptions } from './valueSetBinding';
import { CodesEditor } from './field-editor/CodesEditor';
import { TranslationsEditor } from './field-editor/TranslationsEditor';
import { MappingEditor } from './field-editor/MappingEditor';
import { VisibilityRuleEditor } from './field-editor/VisibilityRuleEditor';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

// Derived from the FieldType zod enum (not hand-copied) so the picklist can
// never drift from the schema: `.options` is a readonly tuple of the literal
// strings in declaration order, which is exactly the order the UI wants.
const FIELD_TYPES: { value: string; label: string }[] = FieldType.options.map(
  (value) => ({ value, label: value }),
);

export interface FieldEditorSheetProps {
  field: FormField | null;
  allFields: FormField[];
  sections: FormSchema['sections'];
  languages?: string[];
  /** The form's FHIR resource type, forwarded to MappingEditor to scope its path picker. */
  fhirResourceType: string | null;
  /** The saved form's id, so suggested codes leave this form out. Null for a form never saved. */
  formId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (field: FormField) => void;
  onCancel: () => void;
  /** Open another field. The page saves this sheet's draft first, as corlix does. */
  onOpenField?: (id: string, draft: FormField) => void;
  /** Add a part to this group. The page saves the draft first, then opens the new part. */
  onAddPart?: (draft: FormField) => void;
}

export function FieldEditorSheet({
  field,
  allFields,
  sections,
  languages = [],
  fhirResourceType,
  formId = null,
  open,
  onOpenChange,
  onSave,
  onCancel,
  onOpenField,
  onAddPart,
}: FieldEditorSheetProps) {
  const [draft, setDraft] = useState<FormField | null>(field);
  // Bumped on every path pick and every field switch, so a slower auto-bind lookup never lands on
  // a later path or on another field's draft.
  const autoBindToken = useRef(0);

  // Reset draft whenever the selected field changes or the sheet opens
  useEffect(() => {
    autoBindToken.current++;
    setDraft(field);
  }, [field?.id, open]);

  // When field is null, render nothing (keep Sheet closed).
  if (!field) return null;

  const patchDraft = (patch: Partial<FormField>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  const handleSave = () => {
    if (draft) onSave(draft);
  };

  const handleCancel = () => {
    onCancel();
  };

  // Closing via onOpenChange == cancel
  const handleOpenChange = (o: boolean) => {
    if (!o) onCancel();
    else onOpenChange(true);
  };

  const activeDraft = draft ?? field;
  // Every group except this field and its own descendants, so the picker cannot build a loop.
  const groupFields = eligibleParents(allFields, activeDraft.id);

  // Auto-bind: picking a path whose element FHIR binds `required` or `extensible` to a set CE holds
  // makes the field a select over that set's stored codes. Corlix `FieldEditor.tsx:562-573`, narrowed
  // by the operator's ruling of 2026-09-14. A later path change wins over an earlier lookup.
  const onMappingUpdate = (patch: Partial<FormField>) => {
    patchDraft(patch);
    if (!('fhirPath' in patch) || !patch.fhirPath || isSurveyForm(fhirResourceType)) return;
    const binding = lookupBinding(patch.fhirPath);
    if (!binding || !autoBindApplies(activeDraft, binding)) return;
    const token = ++autoBindToken.current;
    const fieldType = activeDraft.fieldType === 'multiselect' ? 'multiselect' : 'select';
    void (async () => {
      const held = await findValueSetByUrl(binding.valueSet);
      if (!held || token !== autoBindToken.current) return;
      const codes = await storedValueSetCodes(held.id);
      if (token !== autoBindToken.current) return;
      patchDraft({ ...bindingUpdates(held.url, binding.strength, codesToOptions(codes)), fieldType });
    })().catch(() => { /* a failed lookup leaves the field as the author left it */ });
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="p-0 gap-0 overflow-y-auto">
        {/* ── Sheet Header ───────────────────────────────────────────── */}
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle>Edit Field</SheetTitle>
          <SheetDescription>{activeDraft.displayLabel}</SheetDescription>
        </SheetHeader>

        {/* ── General ──────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="text-sm font-medium text-foreground">General</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label="Field actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleSave}>Save</DropdownMenuItem>
                <DropdownMenuItem onClick={handleCancel}>Cancel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />

          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">

            {/* Display Label */}
            <Label htmlFor="field-display-label" className="whitespace-nowrap">
              Display Label
            </Label>
            <Input
              id="field-display-label"
              aria-label="Display Label"
              value={activeDraft.displayLabel}
              onChange={(e) => patchDraft({ displayLabel: e.target.value })}
            />

            {/* Field Type */}
            <Label htmlFor="field-type-trigger" className="whitespace-nowrap">
              Field Type
            </Label>
            <Select
              value={activeDraft.fieldType}
              onValueChange={(v) =>
                patchDraft({ fieldType: v as FormField['fieldType'] })
              }
            >
              <SelectTrigger id="field-type-trigger" aria-label="Field Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((ft) => (
                  <SelectItem key={ft.value} value={ft.value}>
                    {ft.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Section */}
            <Label htmlFor="field-section-trigger" className="whitespace-nowrap">
              Section
            </Label>
            <Select
              value={activeDraft.section ?? '__none'}
              onValueChange={(v) =>
                patchDraft({ section: v === '__none' ? undefined : v })
              }
            >
              <SelectTrigger id="field-section-trigger" aria-label="Section">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No section</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Group. A group can sit inside another group, to any depth. */}
            <Label htmlFor="field-group-trigger" className="whitespace-nowrap">
              Group
            </Label>
            <div className="flex flex-col gap-1">
              <Select
                value={activeDraft.groupId ?? '__none'}
                onValueChange={(v) =>
                  patchDraft({ groupId: v === '__none' ? undefined : v })
                }
              >
                <SelectTrigger id="field-group-trigger" aria-label="Group">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No group</SelectItem>
                  {groupFields.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.displayLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Nest this field under a Group field. Create one by setting a field&apos;s Type to Group.
              </p>
              {activeDraft.fieldType === 'group' && !groupRepeats(activeDraft, fhirResourceType) && (
                <p className="text-xs text-muted-foreground">
                  This group holds a single instance, so data entry shows no add control.
                </p>
              )}
            </div>

            {/* Placeholder */}
            <Label htmlFor="field-placeholder" className="whitespace-nowrap">
              Placeholder
            </Label>
            <Input
              id="field-placeholder"
              aria-label="Placeholder"
              value={activeDraft.placeholder ?? ''}
              onChange={(e) =>
                patchDraft({ placeholder: e.target.value || undefined })
              }
              placeholder="Hint text"
            />

            {/* Unit */}
            <Label htmlFor="field-unit" className="whitespace-nowrap">
              Unit
            </Label>
            <Input
              id="field-unit"
              aria-label="Unit"
              value={activeDraft.unit ?? ''}
              onChange={(e) =>
                patchDraft({ unit: e.target.value || undefined })
              }
              placeholder="e.g. mg/dL"
            />

            {/* Required + Enabled checkboxes */}
            <div className="col-span-2 flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="field-required"
                  aria-label="Required"
                  checked={activeDraft.required}
                  onCheckedChange={(checked) =>
                    patchDraft({ required: !!checked })
                  }
                />
                <Label htmlFor="field-required" className="text-xs">
                  Required
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="field-enabled"
                  aria-label="Enabled"
                  checked={activeDraft.enabled}
                  onCheckedChange={(checked) =>
                    patchDraft({ enabled: !!checked })
                  }
                />
                <Label htmlFor="field-enabled" className="text-xs">
                  Enabled
                </Label>
              </div>
            </div>
          </div>
        </section>

        {/* ── Reference Configuration (reference fields only) ────── */}
        {activeDraft.fieldType === 'reference' && (
          <>
            <div className="border-t border-border" />
            <div className="px-6 py-3">
              <h3 className="text-sm font-medium text-foreground">Reference Configuration</h3>
            </div>
            <div className="border-t border-border" />
            <div className="px-6 py-2">
              <ReferenceEditor field={activeDraft} allFields={allFields} onUpdate={patchDraft} />
            </div>
          </>
        )}

        {(activeDraft.fieldType === 'select' || activeDraft.fieldType === 'multiselect') && (
          <OptionsBlock field={activeDraft} surveyMode={isSurveyForm(fhirResourceType)} onUpdate={patchDraft} />
        )}

        {/* ── Mapping / FHIR section. Above Codes, as in corlix: mapping is what authors get wrong. ── */}
        <div className="border-t border-border" />
        <div className="px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">Mapping</h3>
        </div>
        <div className="border-t border-border" />
        <div className="px-6 py-2">
          <MappingEditor
            field={activeDraft}
            fhirResourceType={fhirResourceType}
            surveyMode={isSurveyForm(fhirResourceType)}
            onUpdate={onMappingUpdate}
          />
        </div>

        {/* ── Parts (groups only). After Mapping: both answer "what does this node hold". ── */}
        {activeDraft.fieldType === 'group' && (
          <>
            <div className="border-t border-border" />
            <div className="flex items-baseline gap-2 px-6 py-3">
              <h3 className="text-sm font-medium text-foreground">Parts</h3>
              <span className="text-[11px] text-muted-foreground">click one to edit it</span>
            </div>
            <div className="border-t border-border" />
            <div className="space-y-1 px-6 py-4">
              {childrenOf(allFields, activeDraft.id).length === 0 ? (
                <p className="pb-1 text-xs text-muted-foreground">No parts yet.</p>
              ) : (
                childrenOf(allFields, activeDraft.id).map((part) => (
                  <Button
                    key={part.id}
                    type="button"
                    variant="outline"
                    onClick={() => draft && onOpenField?.(part.id, draft)}
                    className="flex h-auto w-full items-center justify-start gap-2 px-2 py-1.5 text-left font-normal hover:border-primary"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-foreground">
                        {part.displayLabel}
                        {part.required && <span className="text-destructive">*</span>}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {part.fhirPath ?? 'no FHIR path yet'}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 rounded-full border border-border px-2 text-[10px] text-muted-foreground">
                      {part.fieldType}
                    </span>
                  </Button>
                ))
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => draft && onAddPart?.(draft)}
                className="h-7 w-full border-dashed text-[11px] font-normal text-primary"
              >
                + Add a part
              </Button>
            </div>
          </>
        )}

        {/* ── Codes section ────────────────────────────────────────── */}
        <div className="border-t border-border" />
        <div className="px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">Codes</h3>
        </div>
        <div className="border-t border-border" />
        <div className="px-6 py-2">
          <CodesEditor field={activeDraft} onUpdate={patchDraft} fhirResourceType={fhirResourceType} formId={formId} />
        </div>

        {/* ── Translations section ─────────────────────────────────── */}
        <div className="border-t border-border" />
        <div className="px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">Translations</h3>
        </div>
        <div className="border-t border-border" />
        <div className="px-6 py-2">
          <TranslationsEditor field={activeDraft} languages={languages} onUpdate={patchDraft} />
        </div>

        {/* ── Visibility / conditions section ─────────────────────── */}
        <div className="border-t border-border" />
        <div className="px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">Visibility</h3>
        </div>
        <div className="border-t border-border" />
        <div className="px-6 py-2">
          <VisibilityRuleEditor
            rule={activeDraft.visibility}
            candidateFields={allFields.filter((f) => f.id !== activeDraft.id)}
            onChange={(visibility) => patchDraft({ visibility })}
          />
        </div>

      </SheetContent>
    </Sheet>
  );
}
