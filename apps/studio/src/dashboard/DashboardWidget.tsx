import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataLimitError, runSavedWidget, runWidgetQuery, type ReportResult, type WidgetConfig } from '../api';
import { renderWidget } from './widgets';

// Binding lives in @openldr/dashboards so the server binds a saved widget the same way (roles part 2).
export { bindQuery } from '@openldr/dashboards/pure';
import { bindQuery } from '@openldr/dashboards/pure';

/** Pause before the one retry after a network error. */
const NETWORK_RETRY_MS = 1000;

/** `savedDashboardId`: the widget is saved on that dashboard, so it runs by id and the server builds
 *  the query. Absent while the dashboard has unsaved changes: the free-form route, editors only. */
export function DashboardWidget({ config, filterValues, savedDashboardId }: { config: WidgetConfig; filterValues: Record<string, unknown>; savedDashboardId?: string }) {
  const [result, setResult] = useState<ReportResult>();
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  // Refused for the caller's data limit (roles part 3): a plain note, not an error.
  const [limited, setLimited] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const ms = config.refreshIntervalSec * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fetchOnce = () => savedDashboardId
      ? runSavedWidget(savedDashboardId, config.id, filterValues, controller.signal)
      : runWidgetQuery(bindQuery(config.query, filterValues), controller.signal);
    const run = async () => {
      try {
        let next: ReportResult;
        try {
          next = await fetchOnce();
        } catch (e) {
          // fetch rejects with a TypeError ("Failed to fetch") only when no response came back at
          // all: a dropped connection, not an answer from the server. Try once more after a pause.
          // Seen on a phone on 2026-11-25: every widget red, fine after a refresh.
          if (!(e instanceof TypeError) || controller.signal.aborted) throw e;
          await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_MS));
          if (controller.signal.aborted) return;
          next = await fetchOnce();
        }
        if (controller.signal.aborted) return;
        setResult(next);
        setError(undefined);
        setLimited(false);
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof DataLimitError) { setLimited(true); setError(undefined); return; }
        // Any other error replaces an earlier data limit note (review U1).
        setLimited(false);
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
  if (limited) return <div className="p-3 text-sm text-muted-foreground">{t('dashboard.dataLimit.notAvailable')}</div>;
  if (error) return <div className="p-3 text-sm text-destructive">{error}</div>;
  if (!result || !result.rows) return <div className="p-3 text-sm text-muted-foreground">Loading…</div>;
  return <div className="h-full w-full">{renderWidget(config, result)}</div>;
}
