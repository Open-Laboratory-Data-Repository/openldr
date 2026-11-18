import { useEffect, useState } from 'react';
import { runSavedWidget, runWidgetQuery, type ReportResult, type WidgetConfig } from '../api';
import { renderWidget } from './widgets';

// Binding lives in @openldr/dashboards so the server binds a saved widget the same way (roles part 2).
export { bindQuery } from '@openldr/dashboards/pure';
import { bindQuery } from '@openldr/dashboards/pure';

/** `savedDashboardId`: the widget is saved on that dashboard, so it runs by id and the server builds
 *  the query. Absent while the dashboard has unsaved changes: the free-form route, editors only. */
export function DashboardWidget({ config, filterValues, savedDashboardId }: { config: WidgetConfig; filterValues: Record<string, unknown>; savedDashboardId?: string }) {
  const [result, setResult] = useState<ReportResult>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    const ms = config.refreshIntervalSec * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const next = savedDashboardId
          ? await runSavedWidget(savedDashboardId, config.id, filterValues, controller.signal)
          : await runWidgetQuery(bindQuery(config.query, filterValues), controller.signal);
        if (controller.signal.aborted) return;
        setResult(next);
        setError(undefined);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!controller.signal.aborted && ms > 0) timer = setTimeout(run, ms);
      }
    };
    void run();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config.query), JSON.stringify(filterValues), config.refreshIntervalSec, savedDashboardId]);
  if (error) return <div className="p-3 text-sm text-destructive">{error}</div>;
  if (!result || !result.rows) return <div className="p-3 text-sm text-muted-foreground">Loading…</div>;
  return <div className="h-full w-full">{renderWidget(config, result)}</div>;
}
