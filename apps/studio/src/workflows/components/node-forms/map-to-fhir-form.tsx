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
import { useFeedsFromWebhook } from '../map/useMapHelpers';

/** The Map to FHIR node's form: source path, target, allowed forms, and the mapping sheet. */
export function MapToFhirForm({ node, update }: NodeFormProps) {
  const { t, i18n } = useTranslation();
  const data = node.data as { label?: string; config?: Record<string, unknown> };
  const config = data.config ?? {};
  const formIds = Array.isArray(config.formIds) ? (config.formIds as string[]) : [];

  const [targets, setTargets] = useState<MapTarget[] | null>(null);
  const [targetsFailed, setTargetsFailed] = useState(false);
  const [forms, setForms] = useState<WorkflowNodeOption[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** A target the person picked while saved mappings belong to another; it waits for a confirm. */
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const feedsFromWebhook = useFeedsFromWebhook(node.id);
  const mappings = Array.isArray(config.mappings) ? (config.mappings as unknown[]) : [];
  const targetOf = (m: unknown) => (m && typeof m === 'object' ? (m as { targetId?: unknown }).targetId : undefined);
  const otherCount = (id: string) => mappings.filter((m) => targetOf(m) !== id).length;

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

  // A node runs one target, so a new target drops the mappings made for another, once confirmed.
  const pickTarget = (id: string) => {
    if (otherCount(id) > 0) setPendingTarget(id);
    else {
      setPendingTarget(null);
      setConfig({ targetId: id });
    }
  };
  const confirmTarget = () => {
    if (!pendingTarget) return;
    setConfig({ targetId: pendingTarget, mappings: mappings.filter((m) => targetOf(m) === pendingTarget) });
    setPendingTarget(null);
  };
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
          {feedsFromWebhook && String(config.sourcePath ?? '').trim() === '' && (
            <p className="mt-1 text-[11px] leading-snug text-amber-500">{t(`${p}.webhookHint`)}</p>
          )}
        </div>

        <Label className="whitespace-nowrap">{t(`${p}.form.target`)}</Label>
        <div className="min-w-0">
          <Select
            value={typeof config.targetId === 'string' && config.targetId ? config.targetId : undefined}
            onValueChange={pickTarget}
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
          {pendingTarget && otherCount(pendingTarget) > 0 && (
            <div className="mt-1.5 flex items-start justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5" data-testid="mtf-target-change">
              <p className="text-[11px] leading-snug text-amber-500">{t(`${p}.form.targetChange`, { count: otherCount(pendingTarget) })}</p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={t(`${p}.form.targetChangeActions`)}>
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={confirmTarget}>{t(`${p}.form.changeTarget`)}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPendingTarget(null)}>{t(`${p}.form.keepTarget`)}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
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
        <span className="text-sm text-foreground" data-testid="mtf-mapping-count">{mappings.length}</span>
      </div>

      <MapToFhirSheet open={sheetOpen} onOpenChange={setSheetOpen} node={node} update={update} />
    </div>
  );
}
