import { useEffect, useRef, useState } from 'preact/hooks';
import { api, canResume, isActive, type Failure, type ImportRun } from './api';
import { formatNumber, has, t } from './i18n';

const SHOWN_FAILURES = 100;
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** One run: status, counts, speed, failures, and Stop or Resume. Re-reads the run while it is going. */
export function RunPanel({ run, onChange, pollMs }: { run: ImportRun; onChange: (run: ImportRun) => void; pollMs: number }) {
  const [failures, setFailures] = useState<Failure[]>([]);
  const [pollFailed, setPollFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = isActive(run.status);

  // Counts Stop and Resume presses. A progress read that was asked for before a press can answer
  // after it, with the older status; such an answer is dropped.
  const actions = useRef(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      const asked = actions.current;
      api.status(run.id)
        .then((next) => {
          if (cancelled || asked !== actions.current) return;
          setPollFailed(false);
          if (next) onChange(next);
        })
        .catch(() => { if (!cancelled && asked === actions.current) setPollFailed(true); })
        .finally(() => { inFlight = false; });
    }, pollMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [run.id, active, pollMs, onChange]);

  useEffect(() => {
    if (run.counts.failed === 0) { setFailures([]); return; }
    let cancelled = false;
    api.failures(run.id).then((list) => { if (!cancelled) setFailures(list); }).catch(() => { /* the count still shows */ });
    return () => { cancelled = true; };
  }, [run.id, run.counts.failed, run.status]);

  // Speed since this page began watching the run, so time spent stopped does not count.
  const base = useRef<{ id: string; keys: number; at: number } | null>(null);
  if (run.status !== 'running') base.current = null;
  else if (!base.current || base.current.id !== run.id) base.current = { id: run.id, keys: run.counts.keys, at: Date.now() };
  const seconds = base.current ? (Date.now() - base.current.at) / 1000 : 0;
  const rate = base.current && seconds >= 2 ? (run.counts.keys - base.current.keys) / seconds : 0;

  async function act(call: (id: string) => Promise<ImportRun>) {
    setBusy(true);
    setActionError(null);
    actions.current += 1;
    try {
      const next = await call(run.id);
      // Count again, so a read asked for while the press was in flight is dropped too.
      actions.current += 1;
      onChange(next);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const count = (id: string, label: string, n: number) => (
    <div data-testid={`run-${id}`}><dt>{label}</dt><dd>{formatNumber(n)}</dd></div>
  );

  return (
    <div class="v1i-run" data-testid="run-panel" data-run-status={run.status}>
      <div class="v1i-run-head">
        <span class={`v1i-dot v1i-dot-${run.status === 'completed' ? 'pass' : run.status === 'failed' || run.status === 'interrupted' ? 'fail' : 'warn'}`} aria-hidden="true" />
        <span class="v1i-row-main" data-testid="run-status">{t(`run.status.${run.status}`)}</span>
        {run.status === 'running' ? (
          <button type="button" class="v1i-btn v1i-btn-danger" data-testid="run-stop" disabled={busy} onClick={() => { void act(api.stop); }}>{t('run.stop')}</button>
        ) : null}
        {canResume(run.status) ? (
          <button type="button" class="v1i-btn" data-testid="run-resume" disabled={busy} onClick={() => { void act(api.resume); }}>{t('run.resume')}</button>
        ) : null}
      </div>
      {run.lastError ? <p class="v1i-error v1i-wrap" data-testid="run-last-error">{t('run.lastError', { error: run.lastError })}</p> : null}
      {actionError ? <p class="v1i-error v1i-wrap" data-testid="run-action-error">{t('run.actionError', { error: actionError })}</p> : null}
      {pollFailed ? <p class="v1i-muted" data-testid="run-poll-error">{t('run.pollError')}</p> : null}
      <dl class="v1i-counts">
        {count('keys', t('run.keys'), run.counts.keys)}
        {count('imported', run.dryRun ? t('run.importedDry') : t('run.imported'), run.counts.imported)}
        {count('failed', t('run.failed'), run.counts.failed)}
        {count('resources', t('run.resources'), run.counts.resources)}
        {rate > 0 ? <div data-testid="run-rate"><dt>{t('run.rate')}</dt><dd>{t('run.rateValue', { n: rate.toFixed(1) })}</dd></div> : null}
      </dl>
      {failures.length > 0 ? (
        <div class="v1i-block" data-testid="failures">
          <h2>{t('failures.heading')}</h2>
          <ul class="v1i-rows">
            {failures.slice(0, SHOWN_FAILURES).map((f, i) => (
              <li key={`${f.key}-${i}`}>
                <span class="v1i-row-title v1i-wrap">{f.key}</span>
                <span class="v1i-row-main v1i-muted">{has(`failure.${f.error}`) ? t(`failure.${f.error}`) : f.error}</span>
              </li>
            ))}
          </ul>
          {run.counts.failed > SHOWN_FAILURES ? (
            <p class="v1i-muted" data-testid="failures-more">{t('failures.more', { shown: SHOWN_FAILURES, total: formatNumber(run.counts.failed) })}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
