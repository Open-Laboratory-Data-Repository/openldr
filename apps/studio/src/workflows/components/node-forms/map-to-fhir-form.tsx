import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import type { MapTarget } from '@openldr/forms/pure';
import { fetchMapTargets, fetchNodeOptions, type WorkflowNodeOption } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { NodeFormProps } from './index';
import { MapToFhirSheet } from '../map/MapToFhirSheet';

/** The Map to FHIR node's form: source path, target, allowed forms, and the mapping sheet. */
export function MapToFhirForm({ node, update }: NodeFormProps) {
  const { t, i18n } = useTranslation();
  const data = node.data as { label?: string; config?: Record<string, unknown> };
  const config = data.config ?? {};
  const formIds = Array.isArray(config.formIds) ? (config.formIds as string[]) : [];
  const mappingCount = Array.isArray(config.mappings) ? config.mappings.length : 0;

  const [targets, setTargets] = useState<MapTarget[] | null>(null);
  const [targetsFailed, setTargetsFailed] = useState(false);
  const [forms, setForms] = useState<WorkflowNodeOption[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setTargetsFailed(false);
    fetchMapTargets(i18n.language)
      .then((list) => live && setTargets(list))
      .catch(() => {
        if (!live) return;
        setTargets([]);
        setTargetsFailed(true);
      });
    return () => {
      live = false;
    };
  }, [i18n.language]);

  useEffect(() => {
    void fetchNodeOptions('forms').then(setForms).catch(() => setForms([]));
  }, []);

  const setConfig = (patch: Record<string, unknown>) => update({ config: { ...config, ...patch } } as never);
  const p = 'workflows.mapToFhir';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{t(`${p}.sheet.title`)}</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t(`${p}.form.actions`)}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSheetOpen(true)}>{t(`${p}.form.openMapping`)}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
        <Label htmlFor="mtf-label" className="whitespace-nowrap">{t(`${p}.form.label`)}</Label>
        <Input id="mtf-label" value={data.label ?? ''} onChange={(e) => update({ label: e.target.value } as never)} />

        <Label htmlFor="mtf-source-path" className="self-start whitespace-nowrap pt-2">{t(`${p}.form.sourcePath`)}</Label>
        <div className="min-w-0">
          <Input
            id="mtf-source-path"
            value={String(config.sourcePath ?? '')}
            onChange={(e) => setConfig({ sourcePath: e.target.value })}
          />
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t(`${p}.form.sourcePathHint`)}</p>
        </div>

        <Label className="whitespace-nowrap">{t(`${p}.form.target`)}</Label>
        <div className="min-w-0">
          <Select
            value={typeof config.targetId === 'string' && config.targetId ? config.targetId : undefined}
            onValueChange={(v) => setConfig({ targetId: v })}
            disabled={targets === null}
          >
            <SelectTrigger aria-label={t(`${p}.form.target`)} className="w-full min-w-0">
              <SelectValue placeholder={t(`${p}.form.targetPlaceholder`)} />
            </SelectTrigger>
            <SelectContent>
              {(targets ?? []).map((tg) => (
                <SelectItem key={tg.id} value={tg.id}>
                  {tg.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targetsFailed && <p className="mt-1 text-[11px] text-destructive">{t(`${p}.targetsFailed`)}</p>}
        </div>

        <Label className="self-start whitespace-nowrap pt-2">{t(`${p}.form.allowedForms`)}</Label>
        {forms.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(`${p}.form.noForms`)}</p>
        ) : (
          <MultiSelect
            aria-label={t(`${p}.form.allowedForms`)}
            options={forms}
            value={formIds}
            onChange={(next) => setConfig({ formIds: next })}
            placeholder={t(`${p}.form.addForm`)}
            removeLabel={(label) => t(`${p}.remove`, { label })}
          />
        )}

        <span className="text-sm font-medium leading-none">{t(`${p}.form.mappings`)}</span>
        <span className="text-sm text-foreground" data-testid="mtf-mapping-count">{mappingCount}</span>
      </div>

      <MapToFhirSheet open={sheetOpen} onOpenChange={setSheetOpen} node={node} update={update} />
    </div>
  );
}
