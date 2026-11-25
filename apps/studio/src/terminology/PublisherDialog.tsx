import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import type { Publisher, PublisherInput } from '../api';
import { createPublisher, updatePublisher } from '../api';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode. */
  publisher: Publisher | null;
  onSaved: (publisher: Publisher) => void;
}

export function PublisherDialog({ open, onOpenChange, publisher, onSaved }: Props): JSX.Element {
  const editing = publisher !== null;

  const [name, setName] = useState('');
  // PublisherInput only accepts 'local' | 'external'. Seeded publishers may
  // carry other roles (e.g. 'standard') but the Select is disabled for them,
  // so we default to 'local' to keep the controlled Select valid.
  const [role, setRole] = useState<'local' | 'external'>('local');
  const [icon, setIcon] = useState('');
  const [saving, setSaving] = useState(false);

  const seeded = publisher?.seeded ?? false;

  useEffect(() => {
    if (!open) return;
    setName(publisher?.name ?? '');
    setRole(publisher?.role === 'external' ? 'external' : 'local');
    setIcon(publisher?.icon ?? '');
  }, [open, publisher]);

  const canSave = name.trim().length > 0;

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    try {
      const input: PublisherInput = {
        name: name.trim(),
        role,
        icon: icon.trim() || null,
      };
      const saved = editing
        ? await updatePublisher(publisher!.id, input)
        : await createPublisher(input);
      if (saved) onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>
            {editing ? 'Edit publisher' : 'New publisher'}
          </SheetTitle>
          <SheetDescription>
            Publishers group code systems and value sets by their source.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Actions sit in a ⋯ menu on the section row, as FieldEditorSheet does (AGENTS.md section 5). */}
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="text-sm font-medium text-foreground">Details</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Publisher actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={saving || !canSave} onClick={() => void handleSave()}>
                  {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOpenChange(false)}>Cancel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />

          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">
            <Label htmlFor="publisherName" className="text-xs">Name</Label>
            <Input
              id="publisherName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your Lab"
              className="h-9 text-sm"
            />

            <Label htmlFor="publisherRole" className="text-xs">Role</Label>
            <div className="space-y-1">
              <Select
                value={role}
                onValueChange={(v) => setRole(v as 'local' | 'external')}
                disabled={seeded}
              >
                <SelectTrigger id="publisherRole" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="external">External</SelectItem>
                </SelectContent>
              </Select>
              {seeded && (
                <p className="text-[11px] text-muted-foreground">
                  Built-in publishers have a fixed role.
                </p>
              )}
            </div>

            <Label htmlFor="publisherIcon" className="self-start pt-2 text-xs">Icon</Label>
            <div className="space-y-1">
              <Input
                id="publisherIcon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="h-9 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Optional short glyph or emoji shown in the rail.
              </p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
