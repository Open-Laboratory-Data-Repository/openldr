import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import { makeExampleAnswers } from '@/forms-runtime/example';
import type { FormSchema, RuntimeAnswers } from '@/forms-runtime/types';

/**
 * The form as data entry will draw it, over the builder. Corlix P14.1 moved its preview from a split
 * pane into a sheet, so every width gets one; CE's pane was hidden on phones. Fill example and Reset
 * sit in the sheet's ⋯ menu, per AGENTS.md §5, where corlix shows them as header buttons.
 */
export function PreviewSheet({ schema, open, onOpenChange }: { schema: FormSchema; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [answers, setAnswers] = useState<RuntimeAnswers>({});
  const [remountKey, setRemountKey] = useState(0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Wider than the field editor's 24rem, as in corlix: a whole form needs more room than one
          field. Full width on a phone. */}
      <SheetContent className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-6 py-3 pr-12">
          <div>
            <SheetTitle>Preview</SheetTitle>
            <SheetDescription className="sr-only">The form as data entry will draw it.</SheetDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Preview actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => { setAnswers(makeExampleAnswers(schema)); setRemountKey((k) => k + 1); }}>
                Fill example
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setAnswers({}); setRemountKey((k) => k + 1); }}>
                Reset
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FormRuntime
            key={remountKey}
            schema={schema}
            // The builder previews an UNSAVED schema, so reference fields must search the field
            // descriptor through the forms.edit-gated preview endpoint rather than a stored form.
            preview
            footer={null}
            onSubmit={() => {}}
            initialAnswers={answers}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
