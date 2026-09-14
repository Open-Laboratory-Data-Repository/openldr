import { useEffect, useMemo, useState } from 'react';
import { Lock, MoreHorizontal } from 'lucide-react';
import { discriminatorLabel, type FormField, type StarterPackEntry, type StarterPackWithEntries } from '@openldr/forms/pure';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { packEntriesNotOnForm } from './libraryEntries';

/**
 * The starter pack for the form's resource type, as a checklist. The author unchecks what they do not
 * collect instead of hunting the FHIR element list for the fields that matter. Every row says why it
 * is there. Ported from corlix `components/form-builder/StarterPackChooser.tsx`, as a Sheet with its
 * actions in a ⋯ menu (AGENTS.md §5) where corlix uses a Dialog with footer buttons. Only entries the
 * form lacks are listed, so adding never makes a second copy of a field.
 */
export function StarterPackChooser({
  open,
  onOpenChange,
  pack,
  loading,
  fields,
  resourceType,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pack: StarterPackWithEntries | null;
  loading: boolean;
  fields: FormField[];
  resourceType: string | null;
  onAdd: (entries: StarterPackEntry[]) => void;
}): JSX.Element {
  const offered = useMemo(
    () => (pack ? packEntriesNotOnForm(pack.entries, fields, resourceType) : []),
    [pack, fields, resourceType],
  );
  const [checked, setChecked] = useState<Set<number>>(new Set());

  // Fresh ticks each time the sheet opens. A locked entry starts checked and cannot be unchecked:
  // a page the form feeds cannot save a record without it.
  useEffect(() => {
    if (open) setChecked(new Set(offered.filter((e) => e.defaultOn || e.locked).map((e) => e.ord)));
  }, [open, offered]);

  const toggle = (e: StarterPackEntry) => {
    if (e.locked) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(e.ord)) next.delete(e.ord);
      else next.add(e.ord);
      return next;
    });
  };

  const kept = offered.filter((e) => checked.has(e.ord));
  const add = () => {
    onAdd(kept);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{pack ? `${pack.name} pack` : 'Starter pack'}</SheetTitle>
          <SheetDescription>
            FHIR lists every element and ranks none. These are the fields OpenLDR's own form uses. Uncheck
            what you do not collect.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">{`${kept.length} of ${offered.length} selected`}</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Pack actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={kept.length === 0} onSelect={add}>
                {`Add ${kept.length} field${kept.length === 1 ? '' : 's'}`}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenChange(false)}>Cancel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <LoadingState className="min-h-[16rem]" />
          ) : !pack ? (
            <StripedEmpty className="min-h-[16rem]">{`No starter pack for ${resourceType ?? 'this form'}.`}</StripedEmpty>
          ) : offered.length === 0 ? (
            <StripedEmpty className="min-h-[16rem]">Every entry in this pack is on the form.</StripedEmpty>
          ) : (
            offered.map((e) => (
              <div key={e.ord} className="flex items-start gap-3 border-b border-border px-6 py-2.5 last:border-b-0">
                <Checkbox
                  className="mt-0.5"
                  checked={checked.has(e.ord)}
                  disabled={e.locked}
                  onCheckedChange={() => toggle(e)}
                  aria-label={`Include ${e.label}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">{e.label}</span>
                    {e.required && <Badge variant="secondary" className="text-[10px]">Required</Badge>}
                    {e.locked && (
                      <span
                        role="img"
                        aria-label="Locked"
                        className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted text-muted-foreground"
                      >
                        <Lock className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">{e.fhirPath ?? 'No FHIR path'}</div>
                  {/* Two slots of one list share a path, so the discriminator gets its own line. */}
                  {discriminatorLabel(e.discriminator) && (
                    <div className="font-mono text-[10px] text-primary">{discriminatorLabel(e.discriminator)}</div>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">{e.rationale}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
