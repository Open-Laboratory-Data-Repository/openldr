import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { testMapping } from '@/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LoadingState, Spinner } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { WorkflowNode, WorkflowNodeData } from '../../lib/types';
import { AddPathPanel } from './AddPathPanel';
import { MappingRow } from './MappingRow';
import { RuleInputs, RuleKindSelect } from './RuleEditor';
import { TestResults, type TestState } from './TestResults';
import { classify, type SavedMapping } from '@openldr/forms/pure';
import { buildMapping, hasSource, narrowerCount, unusedFields, withMapping, type BuildResult, type RowDraft } from './rows';
import { useCodeLists, useCodeSets, useFeedsFromWebhook, useSuggestions } from './useMapHelpers';
import { codeListUrlOf, suggestRuleFor, type RuleSuggestion } from './ruleSuggest';
import { useMappingDraft } from './useMappingDraft';
import { useSamples } from './useSamples';

type Notice = { tone: 'error' | 'ok'; text: string } | null;
const P = 'workflows.mapToFhir';
const COLS = 'sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,7rem)_minmax(0,9rem)]';

const mappingsOf = (config: Record<string, unknown>): unknown[] => (Array.isArray(config.mappings) ? config.mappings : []);
const targetIdOf = (m: unknown): unknown => (m && typeof m === 'object' ? (m as { targetId?: unknown }).targetId : undefined);

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
  const config = ((node.data as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>;
  const samples = useSamples({ nodeId: node.id, open, sourcePath: String(config.sourcePath ?? '') });
  const m = useMappingDraft({ open, locale: i18n.language, config, rows: samples.rows });
  const { target, group, drafts } = m;

  const [notice, setNotice] = useState<Notice>(null);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [adding, setAdding] = useState(false);

  const suggestions = useSuggestions({ open, draftsKey: m.draftsKey, targetId: m.targetId, shape: group, drafts, locale: i18n.language });
  const codeLists = useCodeLists(drafts.some((d) => d.rule.kind === 'codeList'));
  const codeUrlOf = (d: RowDraft) => (hasSource(d) && d.rule.kind === 'none' ? codeListUrlOf(d) : null);
  const codeSets = useCodeSets(drafts.map(codeUrlOf).filter((u): u is string => u !== null));
  const ruleSuggestionOf = (d: RowDraft): RuleSuggestion | null => {
    if (!group) return null;
    const url = codeUrlOf(d);
    return suggestRuleFor(d, group.rows, url ? (codeSets[url] ?? null) : null);
  };
  const describeRule = (r: RuleSuggestion) =>
    r.kind === 'numberComma'
      ? t(`${P}.rule.suggest.numberComma`)
      : r.kind === 'values'
        ? t(`${P}.rule.suggest.values`)
        : t(r.dayFirstGuess ? `${P}.rule.suggest.dateDayFirst` : `${P}.rule.suggest.date`, { format: r.format });

  // Opening the sheet loads the editor's last run when it holds one.
  useEffect(() => {
    if (open && samples.hasLastRun) samples.loadLastRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A new target, shape or opening starts with no message, no results and no open panel.
  useEffect(() => {
    setNotice(null);
    setTest({ kind: 'idle' });
    setAdding(false);
  }, [m.draftsKey, open]);

  const edit = (i: number, patch: Partial<RowDraft>) => {
    m.setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
    setNotice(null);
  };

  const problem = (built: Extract<BuildResult, { ok: false }>) =>
    setNotice({
      tone: 'error',
      text: built.problem === 'required' ? t(`${P}.sheet.saveMissing`, { label: built.label }) : t(`${P}.sheet.ruleIncomplete`, { label: built.label }),
    });

  // A group that edits a wider saved mapping keeps that mapping's field names and hash, so the node
  // never holds two mappings where one's columns contain the other's.
  const saveShape = group && m.loaded && m.loaded.fieldNames.length > group.fieldNames.length
    ? { hash: m.loaded.shapeHash, fieldNames: m.loaded.fieldNames }
    : group;
  const sameTarget = mappingsOf(config).filter((x) => targetIdOf(x) === m.targetId);
  const replacesNarrower = saveShape ? narrowerCount(sameTarget, saveShape.fieldNames) : 0;
  const feedsFromWebhook = useFeedsFromWebhook(node.id);

  // Columns a group offers: the sample's, plus a wider saved mapping's that this sample lacks.
  const offered = saveShape ? saveShape.fieldNames : [];
  const absent = group ? offered.filter((f) => !group.fieldNames.includes(f)) : [];

  // What the node will hold after Save, with the mapping on screen in place of its saved version.
  // A row that more than one of them fits is held by the node, so the sheet says so first.
  const ambiguous = useMemo(() => {
    if (!group || !saveShape || !m.targetId) return false;
    const built = buildMapping(drafts, saveShape, m.targetId, { requireAll: false });
    const savedHere = m.saved.filter((x) => x.targetId === m.targetId);
    const after = (built.ok ? withMapping(savedHere, built.mapping) : savedHere) as SavedMapping[];
    return group.rows.some((row) => classify(row, [], after).kind === 'ambiguous');
  }, [group, saveShape, drafts, m.saved, m.targetId]);
  const showWebhookHint = feedsFromWebhook && String(config.sourcePath ?? '').trim() === '';

  const save = () => {
    if (!target || !group || !saveShape) return;
    const built = buildMapping(drafts, saveShape, target.id, { requireAll: true });
    if (!built.ok) return problem(built);
    // A node runs one target, so mappings made for another target are dropped.
    const kept = mappingsOf(config).filter((x) => targetIdOf(x) === target.id);
    update({ config: { ...config, targetId: target.id, mappings: withMapping(kept, built.mapping) } } as never);
    setNotice({ tone: 'ok', text: t(`${P}.sheet.saved`) });
  };

  const runTest = async () => {
    if (!target || !group || !saveShape) return;
    const built = buildMapping(drafts, saveShape, target.id, { requireAll: false });
    if (!built.ok) return problem(built);
    const others = mappingsOf(config).filter((x) => targetIdOf(x) === target.id);
    const formIds = Array.isArray(config.formIds) ? (config.formIds as string[]) : [];
    setTest({ kind: 'running' });
    try {
      const results = await testMapping({
        config: { targetId: target.id, formIds, mappings: withMapping(others, built.mapping) },
        items: group.rows,
      });
      setTest({ kind: 'done', results });
    } catch (e) {
      setTest({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const addRow = (path: string) => {
    m.setDrafts((ds) => [
      ...ds,
      { targetPath: path, label: path, required: false, repeats: false, valueSet: null, added: true, source: { kind: 'none' }, rule: { kind: 'none' } },
    ]);
    setAdding(false);
  };

  const taken = useMemo(() => new Set(drafts.map((d) => d.targetPath)), [drafts]);
  const required = drafts.filter((d) => d.required);
  const unused = group ? unusedFields(group.fieldNames, drafts) : [];
  const listening = samples.status === 'listening';
  const otherTargetCount = mappingsOf(config).filter((x) => targetIdOf(x) !== m.targetId).length;
  const ready = Boolean(target && group && m.draftsKey);

  let body: ReactNode;
  if (m.targets === null) {
    body = <LoadingState label={t(`${P}.loadingTargets`)} className="min-h-[16rem] flex-1" />;
  } else if (m.targetsFailed || m.targets.length === 0) {
    body = <StripedEmpty className="min-h-[16rem] flex-1">{t(m.targetsFailed ? `${P}.targetsFailed` : `${P}.noTargets`)}</StripedEmpty>;
  } else if (listening && !ready) {
    body = <LoadingState label={t(`${P}.sheet.listening`)} className="min-h-[16rem] flex-1" />;
  } else if (samples.status === 'loadingStored') {
    body = <LoadingState label={t(`${P}.sheet.loadingStored`)} className="min-h-[16rem] flex-1" />;
  } else if (!ready || !group || !target) {
    body = <StripedEmpty className="min-h-[16rem] flex-1">{t(samples.canListen ? `${P}.sheet.empty` : `${P}.sheet.emptyUnsaved`)}</StripedEmpty>;
  } else {
    body = (
      <div className="flex min-w-0 flex-col">
        {adding && (
          <AddPathPanel recordTypes={target.records.map((r) => r.type)} taken={taken} onAdd={addRow} onClose={() => setAdding(false)} />
        )}
        <div className={`hidden border-b border-border px-6 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid sm:gap-x-3 ${COLS}`}>
          <span>{t(`${P}.sheet.colField`)}</span>
          <span>{t(`${P}.sheet.colSource`)}</span>
          <span>{t(`${P}.sheet.colExample`)}</span>
          <span>{t(`${P}.sheet.colRule`)}</span>
        </div>
        {drafts.map((d, i) => {
          const s = suggestions[d.targetPath];
          const showSuggestion = s && !hasSource(d) && group.fieldNames.includes(s);
          return (
            <MappingRow
              key={d.targetPath}
              draft={d}
              fieldNames={[...group.fieldNames, ...absent]}
              absent={absent}
              rows={group.rows}
              onChange={(source) => edit(i, { source })}
              suggestion={
                showSuggestion ? (
                  <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" data-testid={`map-suggestion-${d.targetPath}`}>
                    <span className="min-w-0 truncate">{t(`${P}.sheet.suggested`, { field: s })}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-2 text-xs text-violet-500"
                      aria-label={`${t(`${P}.sheet.accept`)}: ${d.label}`}
                      onClick={() => edit(i, { source: { kind: 'field', fields: [s] } })}
                    >
                      {t(`${P}.sheet.accept`)}
                    </Button>
                  </div>
                ) : undefined
              }
              rule={
                <div className="flex min-w-0 flex-col gap-1">
                  <RuleKindSelect rule={d.rule} label={d.label} onChange={(rule) => edit(i, { rule })} />
                  {(() => {
                    const rs = ruleSuggestionOf(d);
                    if (!rs) return null;
                    return (
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid={`map-rule-suggestion-${d.targetPath}`}>
                        <span className="min-w-0 break-words">{t(`${P}.sheet.ruleSuggested`, { rule: describeRule(rs) })}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 shrink-0 px-2 text-xs text-violet-500"
                          aria-label={`${t(`${P}.sheet.accept`)}: ${t(`${P}.sheet.colRule`)}: ${d.label}`}
                          onClick={() => edit(i, { rule: rs.rule })}
                        >
                          {t(`${P}.sheet.accept`)}
                        </Button>
                      </div>
                    );
                  })()}
                </div>
              }
              ruleInputs={
                d.rule.kind === 'none' || d.rule.kind === 'trim' ? undefined : (
                  <RuleInputs rule={d.rule} label={d.label} valueSet={d.valueSet} codeLists={codeLists} onChange={(rule) => edit(i, { rule })} />
                )
              }
              actions={
                d.added ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`${t(`${P}.sheet.rowActions`)}: ${d.label}`}>
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => m.setDrafts((ds) => ds.filter((_, j) => j !== i))}>
                        {t(`${P}.sheet.removeRow`)}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : undefined
              }
            />
          );
        })}
        <div className="space-y-1 px-6 py-3 text-xs text-muted-foreground">
          <p data-testid="map-required-summary">
            {t(`${P}.sheet.requiredSummary`, { done: required.filter(hasSource).length, count: required.length })}
          </p>
          {unused.length > 0 && <p className="break-words">{t(`${P}.sheet.unused`, { fields: unused.join(', ') })}</p>}
        </div>
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-full gap-0 overflow-x-hidden overflow-y-auto p-0 sm:w-[52rem] sm:max-w-[92vw]">
        <SheetHeader className="border-b border-border px-6 py-4 pr-12">
          <SheetTitle>{t(`${P}.sheet.title`)}</SheetTitle>
          <SheetDescription>{t(`${P}.sheet.description`)}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between gap-2 px-6 py-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            {!samples.canListen && <p>{t(`${P}.sheet.unsavedListen`)}</p>}
            {samples.status === 'timedOut' && <p>{t(`${P}.sheet.listenTimedOut`)}</p>}
            {samples.status === 'noStoredRun' && <p>{t(`${P}.sheet.noStoredRun`)}</p>}
            {samples.status === 'failed' && <p className="text-destructive">{t(`${P}.sheet.listenFailed`)}</p>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t(`${P}.sheet.actions`)}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {samples.canListen &&
                (listening ? (
                  <DropdownMenuItem onClick={samples.stopListening}>{t(`${P}.sheet.stopListening`)}</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={samples.startListening}>{t(`${P}.sheet.listen`)}</DropdownMenuItem>
                ))}
              {samples.canListen && (
                <DropdownMenuItem disabled={samples.status === 'loadingStored'} onClick={() => void samples.loadLatestStoredRun()}>
                  {t(`${P}.sheet.useLatestStored`)}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={!samples.hasLastRun} onClick={samples.loadLastRun}>
                {t(`${P}.sheet.useLastRun`)}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!ready || test.kind === 'running'} onClick={() => void runTest()}>
                {t(`${P}.sheet.test`)}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!ready} onClick={() => setAdding(true)}>
                {t(`${P}.sheet.addPath`)}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!ready} onClick={save}>
                {t(`${P}.sheet.save`)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />

        {m.targets && m.targets.length > 0 && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">
            <Label className="whitespace-nowrap">{t(`${P}.sheet.target`)}</Label>
            <Select value={m.targetId || undefined} onValueChange={m.setTargetId}>
              <SelectTrigger aria-label={t(`${P}.sheet.target`)} className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {m.targets.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {m.groups.length > 1 && (
              <>
                <Label className="whitespace-nowrap">{t(`${P}.sheet.shape`)}</Label>
                <Select value={m.shapeHash} onValueChange={m.setShapeHash}>
                  <SelectTrigger aria-label={t(`${P}.sheet.shape`)} className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {m.groups.map((g) => (
                      <SelectItem key={g.hash} value={g.hash}>
                        {t(`${P}.sheet.shapeOption`, { fields: t(`${P}.sheet.fieldCount`, { count: g.fieldNames.length }), rows: t(`${P}.sheet.rowCount`, { count: g.rows.length }) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
        )}

        {otherTargetCount > 0 && m.targetId && m.targetId !== m.savedTargetId && (
          <p className="px-6 pb-2 text-xs text-amber-500">{t(`${P}.sheet.targetChange`, { count: otherTargetCount })}</p>
        )}
        {m.targets && m.targets.length > 0 && (
          <div className="flex min-h-6 items-center gap-2 px-6 pb-2 text-xs text-muted-foreground" data-testid="map-status">
            {listening ? (
              <>
                <Spinner className="shrink-0" />
                <span>{t(`${P}.sheet.listeningStatus`)}</span>
              </>
            ) : (
              <>
                {group && <span>{t(`${P}.sheet.sampleRows`, { count: group.rows.length })}</span>}
                {test.kind === 'done' && (
                  <span>{t(`${P}.sheet.testSummary`, { count: test.results.filter((r) => r.ok).length, total: test.results.length })}</span>
                )}
              </>
            )}
          </div>
        )}
        {replacesNarrower > 0 && ready && (
          <p className="px-6 pb-2 text-xs text-amber-500" data-testid="map-replaces-narrower">
            {t(`${P}.sheet.replacesNarrower`, { count: replacesNarrower })}
          </p>
        )}
        {ambiguous && ready && (
          <p className="px-6 pb-2 text-xs text-amber-500" data-testid="map-ambiguous">
            {t(`${P}.sheet.ambiguous`)}
          </p>
        )}
        {showWebhookHint && <p className="px-6 pb-2 text-xs text-amber-500">{t(`${P}.webhookHint`)}</p>}
        {notice && (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`px-6 pb-2 text-xs ${notice.tone === 'error' ? 'text-destructive' : 'text-emerald-500'}`}
          >
            {notice.text}
          </p>
        )}

        <div className="flex min-h-[16rem] min-w-0 flex-1 flex-col">{body}</div>
        {test.kind !== 'idle' && (
          <div className="sticky bottom-0 z-10 max-h-[40dvh] shrink-0 overflow-y-auto border-t border-border bg-background" data-testid="map-test-footer">
            <TestResults state={test} drafts={drafts} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
