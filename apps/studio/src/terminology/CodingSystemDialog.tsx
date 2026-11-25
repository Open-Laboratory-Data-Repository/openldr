import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import type { CodingSystem, CodingSystemInput, Publisher } from '../api';
import { createCodingSystem, listPublishers, updateCodingSystem } from '../api';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
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
  system: CodingSystem | null;
  /** Publisher to default to when creating (the rail's current selection). */
  defaultPublisherId?: string;
  onSaved: (s: CodingSystem) => void;
}

export function CodingSystemDialog({
  open,
  onOpenChange,
  system,
  defaultPublisherId,
  onSaved,
}: Props): JSX.Element {
  const editing = system !== null;

  const [systemCode, setSystemCode] = useState('');
  const [systemName, setSystemName] = useState('');
  const [url, setUrl] = useState('');
  const [systemVersion, setSystemVersion] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [publisherId, setPublisherId] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-fetch on open so a publisher created elsewhere in the session appears.
  useEffect(() => {
    if (open) void listPublishers().then(setPublishers).catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSystemCode(system?.systemCode ?? '');
    setSystemName(system?.systemName ?? '');
    setUrl(system?.url ?? '');
    setSystemVersion(system?.systemVersion ?? '');
    setDescription(system?.description ?? '');
    setActive(system?.active ?? true);
    setPublisherId(system?.publisherId ?? defaultPublisherId ?? '');
  }, [open, system, defaultPublisherId]);

  const canSave = systemCode.trim().length > 0 && systemName.trim().length > 0;

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    try {
      const input: CodingSystemInput = {
        systemCode: systemCode.trim(),
        systemName: systemName.trim(),
        url: url.trim() || null,
        systemVersion: systemVersion.trim() || null,
        description: description.trim() || null,
        active,
        publisherId: publisherId || undefined,
      };
      const saved = editing
        ? await updateCodingSystem(system!.id, input)
        : await createCodingSystem(input);
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
            {editing ? 'Edit coding system' : 'New coding system'}
          </SheetTitle>
          <SheetDescription>
            Coding systems group terms by origin (LOINC, SNOMED, ICD, etc.) and appear in the terminology picker.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Actions sit in a ⋯ menu on the section row, as FieldEditorSheet does (AGENTS.md section 5). */}
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="text-sm font-medium text-foreground">Details</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Coding system actions">
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
            <Label htmlFor="systemCode" className="self-start pt-2 text-xs">System code</Label>
            <div className="space-y-1">
              <Input
                id="systemCode"
                value={systemCode}
                onChange={(e) => setSystemCode(e.target.value.toUpperCase())}
                placeholder="LOINC"
                className="h-9 text-sm font-mono"
                disabled={editing}
              />
              <p className="text-[11px] text-muted-foreground">
                Short uppercase identifier, e.g. LOINC, SNOMED-CT, ICD-10. Immutable once created.
              </p>
            </div>

            <Label htmlFor="systemName" className="text-xs">System name</Label>
            <Input
              id="systemName"
              value={systemName}
              onChange={(e) => setSystemName(e.target.value)}
              placeholder="Logical Observation Identifiers Names and Codes"
              className="h-9 text-sm"
            />

            <Label htmlFor="systemUrl" className="self-start pt-2 text-xs">Canonical URL</Label>
            <div className="space-y-1">
              <Input
                id="systemUrl"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://loinc.org"
                className="h-9 text-sm font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Used in FHIR Coding.system. Leave blank for custom systems.
              </p>
            </div>

            <Label htmlFor="systemVersion" className="text-xs">Version</Label>
            <Input
              id="systemVersion"
              value={systemVersion}
              onChange={(e) => setSystemVersion(e.target.value)}
              placeholder="2.76"
              className="h-9 text-sm font-mono"
            />

            <Label htmlFor="systemDescription" className="self-start pt-2 text-xs">Description</Label>
            <Textarea
              id="systemDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />

            <Label htmlFor="systemPublisher" className="text-xs">Publisher</Label>
            <Select value={publisherId} onValueChange={setPublisherId}>
              <SelectTrigger id="systemPublisher" className="h-9 text-sm">
                <SelectValue placeholder="Select a publisher" />
              </SelectTrigger>
              <SelectContent>
                {publishers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label htmlFor="systemActive" className="text-xs">Active</Label>
            <Checkbox
              id="systemActive"
              checked={active}
              onCheckedChange={(v) => setActive(v === true)}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
