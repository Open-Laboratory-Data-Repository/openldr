import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { FormFieldOption } from '@openldr/forms/pure';
import { saveValueSet } from '../../api';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { optionsToValueSetInput, suggestValueSetUrl } from '../valueSetBinding';

/**
 * Turn a field's typed options into a reusable ValueSet and bind the field to it. Ported from corlix
 * `SaveOptionsAsValueSetDialog.tsx`, as a Sheet with Save and Cancel in its ⋯ menu (AGENTS.md §5).
 * Saving needs `terminology.manage` on the server; the Options block offers it only to a user who
 * holds it.
 */
export function SaveOptionsAsValueSetSheet({
  open,
  onOpenChange,
  options,
  fieldLabel,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: FormFieldOption[];
  fieldLabel: string;
  onSaved: (url: string) => void;
}): JSX.Element {
  const [title, setTitle] = useState(fieldLabel);
  const [url, setUrl] = useState(suggestValueSetUrl(fieldLabel));
  const [urlTouched, setUrlTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(fieldLabel);
    setUrl(suggestValueSetUrl(fieldLabel));
    setUrlTouched(false);
    setError(null);
  }, [open, fieldLabel]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveValueSet(optionsToValueSetInput({ title: title.trim(), url: url.trim(), options }));
      onSaved(saved.url);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the ValueSet.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>Save as a new ValueSet</SheetTitle>
          <SheetDescription>{`Create a reusable ValueSet from ${options.length} options and bind this field to it.`}</SheetDescription>
        </SheetHeader>
        <div className="flex items-center justify-between px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">ValueSet</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Save actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={saving || !title.trim() || !url.trim()} onSelect={() => void save()}>Save</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenChange(false)}>Cancel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">
          <Label htmlFor="vs-save-title" className="whitespace-nowrap">Title</Label>
          <Input
            id="vs-save-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!urlTouched) setUrl(suggestValueSetUrl(e.target.value));
            }}
          />
          <Label htmlFor="vs-save-url" className="whitespace-nowrap">Canonical URL</Label>
          <Input
            id="vs-save-url"
            className="font-mono text-xs"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlTouched(true);
            }}
          />
        </div>
        {error && <p role="alert" className="px-6 text-xs text-destructive">{error}</p>}
      </SheetContent>
    </Sheet>
  );
}
