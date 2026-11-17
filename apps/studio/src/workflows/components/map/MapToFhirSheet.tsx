import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import type { MapTarget } from '@openldr/forms/pure';
import { fetchMapTargets } from '@/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { WorkflowNode, WorkflowNodeData } from '../../lib/types';
import { MappingRow } from './MappingRow';
import {
  buildMapping,
  draftsFor,
  groupByShape,
  hasSource,
  savedMappingsOf,
  unusedFields,
  withMapping,
  type RowDraft,
  type SourceDraft,
} from './rows';
import { useSamples } from './useSamples';

type Notice = { tone: 'error' | 'ok'; text: string } | null;

/**
 * Map unknown rows to a target on a live sample, test them, and save the mapping into the node.
 * Samples stay in this component's state. Only field names, rules and typed values are saved.
 */
export function MapToFhirSheet({
  open,
  onOpenChange,
  node,
  update,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: WorkflowNode;
  update: (patch: Partial<WorkflowNodeData>) => void;
}) {
  const { t, i18n } = useTranslation();
  const p = 'workflows.mapToFhir';
  const config = ((node.data as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>;
  const sourcePath = String(config.sourcePath ?? '');
  const savedTargetId = typeof config.targetId === 'string' ? config.targetId : '';

  const samples = useSamples({ nodeId: node.id, open, sourcePath });

  const [targets, setTargets] = useState<MapTarget[] | null>(null);
  const [targetsFailed, setTargetsFailed] = useState(false);
  const [targetId, setTargetId] = useState(savedTargetId);
  const [shapeHash, setShapeHash] = useState('');
  const [drafts, setDrafts] = useState<RowDraft[]>([]);
  const [notice, setNotice] = useState<Notice>(null);

  // Targets for the current language, loaded when the sheet opens.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setTargets(null);
    setTargetsFailed(false);
    fetchMapTargets(i18n.language)
      .then((list) => {
        if (!live) return;
        setTargets(list);
        setTargetId((cur) => (cur && list.some((x) => x.id === cur) ? cur : savedTargetId || list[0]?.id || ''));
      })
      .catch(() => {
        if (!live) return;
        setTargets([]);
        setTargetsFailed(true);
      });
    return () => {
      live = false;
    };
    // savedTargetId is read once per opening on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i18n.language]);

  // Opening the sheet loads the editor's last run when it holds one.
  useEffect(() => {
    if (open && samples.hasLastRun) samples.loadLastRun();
    if (!open) setNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const groups = useMemo(() => groupByShape(samples.rows), [samples.rows]);
  const saved = useMemo(() => savedMappingsOf(config), [config]);
  const target = targets?.find((x) => x.id === targetId) ?? null;

  // Pick a shape: keep the current one, else one with a saved mapping, else the first.
  useEffect(() => {
    if (groups.some((g) => g.hash === shapeHash)) return;
    const withSaved = groups.find((g) => saved.some((m) => m.shapeHash === g.hash));
    setShapeHash((withSaved ?? groups[0])?.hash ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const group = groups.find((g) => g.hash === shapeHash) ?? null;

  // New drafts when the target or the shape changes, from the saved mapping for that shape.
  useEffect(() => {
    if (!target || !group) {
      setDrafts([]);
      return;
    }
    const s = saved.find((m) => m.shapeHash === group.hash && m.targetId === target.id) ?? null;
    setDrafts(draftsFor(target, s));
    setNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, group?.hash]);

  const setSource = (i: number, source: SourceDraft) => {
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, source } : d)));
    setNotice(null);
  };

  const otherTargetCount = (Array.isArray(config.mappings) ? config.mappings : []).filter(
    (m) => !(m && typeof m === 'object' && (m as { targetId?: unknown }).targetId === targetId),
  ).length;

  const save = () => {
    if (!target || !group) return;
    const built = buildMapping(drafts, group, target.id, { requireAll: true });
    if (!built.ok) {
      setNotice({
        tone: 'error',
        text: built.problem === 'required' ? t(`${p}.sheet.saveMissing`, { label: built.label }) : t(`${p}.sheet.ruleIncomplete`, { label: built.label }),
      });
      return;
    }
    // A node runs one target, so mappings made for another target are dropped.
    const kept = (Array.isArray(config.mappings) ? config.mappings : []).filter(
      (m) => m && typeof m === 'object' && (m as { targetId?: unknown }).targetId === target.id,
    );
    update({ config: { ...config, targetId: target.id, mappings: withMapping(kept, built.mapping) } } as never);
    setNotice({ tone: 'ok', text: t(`${p}.sheet.saved`) });
  };

  const required = drafts.filter((d) => d.required);
  const requiredDone = required.filter(hasSource).length;
  const unused = group ? unusedFields(group.fieldNames, drafts) : [];

  const listening = samples.listen === 'listening';

  let body: ReactNode;
  if (targets === null) {
    body = <LoadingState label={t(`${p}.loadingTargets`)} className="min-h-[16rem] flex-1" />;
  } else if (targetsFailed || targets.length === 0) {
    body = (
      <StripedEmpty className="min-h-[16rem] flex-1">{t(targetsFailed ? `${p}.targetsFailed` : `${p}.noTargets`)}</StripedEmpty>
    );
  } else if (listening) {
    body = <LoadingState label={t(`${p}.sheet.listening`)} className="min-h-[16rem] flex-1" />;
  } else if (!group || !target) {
    body = <StripedEmpty className="min-h-[16rem] flex-1">{t(`${p}.sheet.empty`)}</StripedEmpty>;
  } else {
    body = (
      <div className="flex min-w-0 flex-col">
        <div className="hidden border-b border-border px-6 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,7rem)_minmax(0,9rem)] sm:gap-x-3">
          <span>{t(`${p}.sheet.colField`)}</span>
          <span>{t(`${p}.sheet.colSource`)}</span>
          <span>{t(`${p}.sheet.colExample`)}</span>
          <span>{t(`${p}.sheet.colRule`)}</span>
        </div>
        {drafts.map((d, i) => (
          <MappingRow
            key={d.targetPath}
            draft={d}
            fieldNames={group.fieldNames}
            sample={group.rows[0]}
            onChange={(s) => setSource(i, s)}
          />
        ))}
        <div className="space-y-1 px-6 py-3 text-xs text-muted-foreground">
          <p data-testid="map-required-summary">{t(`${p}.sheet.requiredSummary`, { done: requiredDone, total: required.length })}</p>
          {unused.length > 0 && <p className="break-words">{t(`${p}.sheet.unused`, { fields: unused.join(', ') })}</p>}
        </div>
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-full gap-0 overflow-x-hidden overflow-y-auto p-0 sm:w-[52rem] sm:max-w-[92vw]">
        <SheetHeader className="border-b border-border px-6 py-4 pr-12">
          <SheetTitle>{t(`${p}.sheet.title`)}</SheetTitle>
          <SheetDescription>{t(`${p}.sheet.description`)}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between gap-2 px-6 py-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            {!samples.canListen && <p>{t(`${p}.sheet.unsavedListen`)}</p>}
            {samples.listen === 'timedOut' && <p>{t(`${p}.sheet.listenTimedOut`)}</p>}
            {samples.listen === 'failed' && <p className="text-destructive">{t(`${p}.sheet.listenFailed`)}</p>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t(`${p}.sheet.actions`)}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!samples.hasLastRun} onClick={samples.loadLastRun}>
                {t(`${p}.sheet.useLastRun`)}
              </DropdownMenuItem>
              {samples.canListen &&
                (listening ? (
                  <DropdownMenuItem onClick={samples.stopListening}>{t(`${p}.sheet.stopListening`)}</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={samples.startListening}>{t(`${p}.sheet.listen`)}</DropdownMenuItem>
                ))}
              <DropdownMenuItem disabled={!group || !target} onClick={save}>
                {t(`${p}.sheet.save`)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />

        {targets && targets.length > 0 && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">
            <Label className="whitespace-nowrap">{t(`${p}.sheet.target`)}</Label>
            <Select value={targetId || undefined} onValueChange={setTargetId}>
              <SelectTrigger aria-label={t(`${p}.sheet.target`)} className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {groups.length > 1 && (
              <>
                <Label className="whitespace-nowrap">{t(`${p}.sheet.shape`)}</Label>
                <Select value={shapeHash} onValueChange={setShapeHash}>
                  <SelectTrigger aria-label={t(`${p}.sheet.shape`)} className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.hash} value={g.hash}>
                        {t(`${p}.sheet.shapeOption`, { fields: g.fieldNames.length, rows: g.rows.length })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
        )}

        {otherTargetCount > 0 && targetId && targetId !== savedTargetId && (
          <p className="px-6 pb-2 text-xs text-amber-500">{t(`${p}.sheet.targetChange`, { count: otherTargetCount })}</p>
        )}
        {notice && (
          <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`px-6 pb-2 text-xs ${notice.tone === 'error' ? 'text-destructive' : 'text-emerald-500'}`}>
            {notice.text}
          </p>
        )}

        <div className="flex min-h-[16rem] min-w-0 flex-1 flex-col">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
