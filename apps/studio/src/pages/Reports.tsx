import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AppShell } from '../shell/AppShell';
import { isNarrowViewport } from '@/lib/viewport';
import { FileText } from 'lucide-react';
import {
  fetchReports, fetchReport, fetchReportOptions, logReportRun, fetchLabIdentity,
  type ReportSummary, type ReportResult, type ReportParamOption,
} from '../api';
import { ReportLibrary } from '../reports/ReportLibrary';
import { TruncatedText } from '@/components/ui/truncated-text';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { EmptyState } from '@/components/ui/empty-state';
import { listReportCategories, type ReportCategory } from '../reports/reportCategoriesApi';
import { ReportHistoryDrawer } from '../reports/ReportHistoryDrawer';
import { ReportSchedulesDrawer } from '../reports/ReportSchedulesDrawer';
import { useAuth } from '@/auth/AuthProvider';
import { ReportParametersBar } from '../reports/ReportParametersBar';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ReportSummaryStrip } from '../reports/ReportSummaryStrip';
import { ReportActionsMenu } from '../reports/ReportActionsMenu';
import { ReportDocumentTab } from '../reports/ReportDocumentTab';
import { ReportSpreadsheetTab } from '../reports/ReportSpreadsheetTab';
import { computeSummaryMetrics } from '../reports/lib/report-summary';
import {
  loadPinned, savePinned, togglePinned, loadLastParams, saveLastParams,
} from '../reports/lib/report-preferences';
import { deleteReportDef, setReportStatus } from '../reports/reportDefsApi';

type Tab = 'document' | 'spreadsheet';

/** Parameter key a report declares when its results depend on which civil day an arrival falls in.
 *  The stored `lab.timezone` setting is offered as its starting value — see `labTz` below. */
const TZ_PARAM = 'tz';

export function Reports() {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  const canManageSchedules = hasCapability('reports.edit_templates');
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Collapse the report-list rail by default on phone-width screens so the selected report /
  // empty state gets the full width; desktop opens expanded as before.
  const [collapsed, setCollapsed] = useState(
    isNarrowViewport,
  );
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [params, setParams] = useState<Record<string, string>>({});
  // Params snapshotted at the moment of the last Run, so both result tabs (document
  // PDF + spreadsheet/CSV) always reflect the run that produced `result`, even if the
  // user edits the parameter controls afterwards without re-running.
  const [ranParams, setRanParams] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Record<string, ReportParamOption[]>>({});
  const [result, setResult] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState('');
  /** Counts COMPLETED runs, so a re-run with identical parameters is still a new run to anything
   *  keyed on it. The document tab needs that: its parameters do not change on a refresh. */
  const [runSeq, setRunSeq] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('document');
  const [paramsOpen, setParamsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const selected = reports.find((r) => r.id === selectedId) ?? null;

  const refreshCategories = useCallback(() => {
    listReportCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  // The laboratory's configured time zone, offered as the starting value of a `tz` parameter.
  // Best-effort — a failure just means no prefill, never a blocked page.
  const [labTz, setLabTz] = useState('');

  useEffect(() => {
    fetchReports().then(setReports).catch((e) => toast.error(String(e)));
    setPinnedIds(loadPinned());
    refreshCategories();
    fetchLabIdentity()
      .then((r) => setLabTz(r.values['lab.timezone'] ?? ''))
      .catch(() => setLabTz(''));
  }, [refreshCategories]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setResult(null);
    setActiveTab('document');
    const seeded = loadLastParams()[id] ?? {};
    setParams(seeded);
    setOptions({});
    fetchReportOptions(id).then(setOptions).catch(() => setOptions({}));
  }, []);

  const declaresTz = selected?.parameters.some((p) => p.id === TZ_PARAM) ?? false;
  // Fill the `tz` box from the laboratory setting, but only where it is still empty.
  //
  // ⛔ The setting goes UNDER the remembered value, never over it. A zone the operator already ran
  // this report with is a deliberate choice and must survive; the setting only fills the box the
  // first time. Without the setting at all, an operator retypes the zone on every run and two
  // people running the same month can bucket it differently — the failure a stored setting was
  // chosen over a bare parameter to avoid.
  //
  // ⚠ An effect rather than a line in `handleSelect`, because the settings call and the reports
  // call are fired together and the page does not control which lands first: on a slow link the
  // operator can pick a report before the zone arrives, and seeding only at pick time drops the
  // prefill with no sign it was meant to happen.
  //
  // Keyed on `selectedId` and the BOOLEAN `declaresTz`, never on the `selected` object. `selected`
  // is a `find` over `reports`, so re-fetching the list hands back a different object for the same
  // report; keying on it would re-run this effect on a refresh and re-fill a box the operator had
  // deliberately cleared. Today both refresh paths also clear the selection, so that cannot yet
  // happen — the id key is what keeps it from starting to.
  useEffect(() => {
    if (!labTz || !declaresTz) return;
    setParams((prev) => (prev[TZ_PARAM] ? prev : { ...prev, [TZ_PARAM]: labTz }));
  }, [labTz, declaresTz, selectedId]);

  const handleTogglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = togglePinned(prev, id);
      savePinned(next);
      return next;
    });
  }, []);

  const canRun = useMemo(() => {
    if (!selected) return false;
    return selected.parameters
      .filter((p) => p.required)
      .every((p) => (p.type === 'daterange' ? Boolean(params.from && params.to) : Boolean(params[p.id])));
  }, [selected, params]);

  const runWith = useCallback(async (values: Record<string, string>) => {
    if (!selectedId) return;
    setRunning(true);
    try {
      const res = await fetchReport(selectedId, values);
      setResult(res);
      setRanParams(values);
      setRanAt(new Date().toLocaleString());
      setRunSeq((n) => n + 1);
      logReportRun(selectedId, { format: 'preview', rowCount: res.meta.rowCount, params: values });
      const next = { ...loadLastParams(), [selectedId]: values };
      saveLastParams(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [selectedId]);

  const handleRun = useCallback(() => runWith(params), [runWith, params]);

  /** ⛔ Re-runs with `ranParams`, the values that produced the report ON SCREEN, never with the
   *  sheet's current `params`. A half-edited parameter would otherwise turn a refresh into a
   *  different report while looking like the same one. Nothing is cached on either side, so this
   *  is a real second query against the warehouse. */
  const handleRefresh = useCallback(() => {
    if (!result) return;
    void runWith(ranParams);
  }, [runWith, ranParams, result]);

  const metrics = useMemo(
    () => (selected?.summaryMetrics && result ? computeSummaryMetrics(selected.summaryMetrics, result.rows) : []),
    [selected, result],
  );

  const refreshReports = useCallback(() => {
    fetchReports().then(setReports).catch((e) => toast.error(String(e)));
  }, []);

  const handleUnpublish = useCallback(() => {
    if (!selected) return;
    setReportStatus(selected.id, 'draft')
      .then(() => {
        toast.success(t('reports.unpublished'));
        setSelectedId(null);
        setResult(null);
        refreshReports();
      })
      .catch(() => toast.error(t('reports.actionFailed')));
  }, [selected, t, refreshReports]);

  const handleDeleteReport = useCallback(() => {
    if (!selected) return;
    deleteReportDef(selected.id)
      .then(() => {
        toast.success(t('reports.deleted'));
        setSelectedId(null);
        setResult(null);
        refreshReports();
      })
      .catch(() => toast.error(t('reports.actionFailed')));
  }, [selected, t, refreshReports]);

  return (
    <AppShell title={t('nav.reports')} fullBleed>
      <div className="flex h-full min-h-0">
        <div className="flex min-h-0 min-w-0 shrink-0 flex-col border-r border-border">
          <ReportLibrary
            reports={reports}
            categories={categories}
            selectedId={selectedId}
            onSelect={handleSelect}
            pinnedIds={pinnedIds}
            onTogglePin={handleTogglePin}
            search={search}
            onSearchChange={setSearch}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((c) => !c)}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            reports.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-6 w-6" />}
                title={t('reports.emptyLibrary')}
                body={t('reports.emptyLibraryBody')}
              />
            ) : (
              <StripedEmpty>{t('reports.selectReport')}</StripedEmpty>
            )
          ) : (
            <>
              <div className="flex items-start justify-between border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold">{selected.name}</h2>
                  <TruncatedText text={selected.description} className="text-xs text-muted-foreground" />
                </div>
                <ReportActionsMenu
                  onRefresh={handleRefresh}
                  canRefresh={Boolean(result) && !running}
                  onOpenParameters={() => setParamsOpen(true)}
                  onOpenHistory={() => setHistoryOpen(true)}
                  onOpenSchedules={() => setSchedulesOpen(true)}
                  canManageSchedules={canManageSchedules}
                  designId={selected.designId}
                  reportId={selected.id}
                  source={selected.source}
                  canManage={canManageSchedules}
                  onUnpublish={handleUnpublish}
                  onDelete={handleDeleteReport}
                />
              </div>

              {/* Parameters live in a sheet off the ⋯ menu rather than an always-on bar: on a
                  phone that bar pushed the report itself most of a screen down. */}
              <Sheet open={paramsOpen} onOpenChange={setParamsOpen}>
                <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
                  <SheetHeader className="border-b border-border px-6 py-4">
                    <SheetTitle>{t('reports.parameters')}</SheetTitle>
                    <SheetDescription>{selected.name}</SheetDescription>
                  </SheetHeader>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <ReportParametersBar
                      report={selected}
                      params={params}
                      options={options}
                      onChange={setParams}
                      onRun={() => { setParamsOpen(false); void handleRun(); }}
                      running={running}
                      canRun={canRun}
                    />
                  </div>
                </SheetContent>
              </Sheet>

              <ReportSummaryStrip metrics={metrics} />

              {!result ? (
                <StripedEmpty className="flex-1">{running ? t('reports.running') : t('reports.runReport')}</StripedEmpty>
              ) : (
                <>
                  <div className="flex items-center border-b border-border px-4">
                    {(['document', 'spreadsheet'] as Tab[]).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] transition-colors ${
                          activeTab === tab
                            ? 'border-[#5A9BD6] text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {tab === 'document' ? t('reports.tabDocument') : t('reports.tabSpreadsheet')}
                      </button>
                    ))}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {t('reports.runMeta', { count: result.meta.rowCount, time: ranAt })}
                    </span>
                  </div>

                  <div className="min-h-0 flex-1">
                    {activeTab === 'document' ? (
                      <ReportDocumentTab
                        reportId={selected.id}
                        params={ranParams}
                        runSeq={runSeq}
                        onDownload={() => logReportRun(selected.id, { format: 'pdf', rowCount: result.meta.rowCount, params: ranParams })}
                      />
                    ) : (
                      <ReportSpreadsheetTab
                        reportId={selected.id}
                        result={result}
                        params={ranParams}
                        onExport={(format, rowCount) => logReportRun(selected.id, { format, rowCount, params: ranParams })}
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {selected && (
        <ReportHistoryDrawer
          open={historyOpen}
          reportId={selected.id}
          onClose={() => setHistoryOpen(false)}
          onApplyParams={(p) => { setParams(p); setHistoryOpen(false); }}
        />
      )}

      {selected && (
        <ReportSchedulesDrawer
          open={schedulesOpen}
          reportId={selected.id}
          parameters={selected.parameters}
          options={options}
          currentParams={params}
          onClose={() => setSchedulesOpen(false)}
        />
      )}
    </AppShell>
  );
}
