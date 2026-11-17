import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { fhirPathOptionsFor } from '@openldr/fhir/paths';
import { canWriteFromCell } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/**
 * The FHIR paths of a record type that the writer can fill from one cell, minus ones in use, the
 * record's id and the links the target makes. The node refuses a mapped id or link.
 */
export function addablePaths(resourceType: string, taken: Set<string>, linkPaths: readonly string[] = []): { path: string; label: string }[] {
  return fhirPathOptionsFor(resourceType)
    .filter((info) => canWriteFromCell(info.path) && !taken.has(info.path) && info.path !== `${resourceType}.id` && !linkPaths.includes(info.path))
    .map((info) => ({ path: info.path, label: info.label }));
}

/** "Add a FHIR path": pick a record type, then a path. Picking the path adds the row. */
export function AddPathPanel({
  recordTypes,
  taken,
  linkPaths,
  onAdd,
  onClose,
}: {
  recordTypes: string[];
  taken: Set<string>;
  /** The paths the target writes its links to. */
  linkPaths: string[];
  onAdd: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const P = 'workflows.mapToFhir.addPath';
  const [type, setType] = useState(recordTypes[0] ?? '');
  const paths = useMemo(() => (type ? addablePaths(type, taken, linkPaths) : []), [type, taken, linkPaths]);

  return (
    <div className="border-b border-border px-6 py-3" data-testid="map-add-path">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{t('workflows.mapToFhir.sheet.addPath')}</h4>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('workflows.mapToFhir.sheet.rowActions')}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onClose}>{t(`${P}.close`)}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
        <Label className="whitespace-nowrap">{t(`${P}.resourceType`)}</Label>
        <Select value={type || undefined} onValueChange={setType}>
          <SelectTrigger aria-label={t(`${P}.resourceType`)} className="w-full min-w-0">
            <SelectValue placeholder={t(`${P}.resourcePlaceholder`)} />
          </SelectTrigger>
          <SelectContent>
            {recordTypes.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label className="whitespace-nowrap">{t(`${P}.path`)}</Label>
        <Select key={type} onValueChange={onAdd}>
          <SelectTrigger aria-label={t(`${P}.path`)} className="w-full min-w-0">
            <SelectValue placeholder={t(`${P}.pathPlaceholder`)} />
          </SelectTrigger>
          <SelectContent>
            {paths.map((x) => (
              <SelectItem key={x.path} value={x.path}>
                {x.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
