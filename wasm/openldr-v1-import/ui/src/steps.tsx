import { Fragment } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, type AllowedConnector, type CheckResult, type DiagnoseResult } from './api';
import { problems, type OptionsForm } from './options';
import { formatNumber, has, t } from './i18n';

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Step 1. Pick one of the connectors an admin allowed, and optionally test it. */
export function SourceStep({ connectors, connectorId, onPick }: {
  connectors: AllowedConnector[];
  connectorId: string | null;
  onPick: (id: string) => void;
}) {
  const [diag, setDiag] = useState<DiagnoseResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDiag(null); setError(null); }, [connectorId]);

  async function check(id: string) {
    setRunning(true);
    setDiag(null);
    setError(null);
    try {
      setDiag(await api.diagnose(id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(false);
    }
  }

  if (connectors.length === 0) {
    return (
      <section class="v1i-section">
        <h1>{t('source.heading')}</h1>
        <p class="v1i-empty" data-testid="source-none">{t('source.none')}</p>
      </section>
    );
  }

  const failed = diag?.steps.find((s) => s.status === 'fail');
  const stepName = (id: string) => (has(`diag.${id}`) ? t(`diag.${id}`) : id);

  return (
    <section class="v1i-section">
      <h1>{t('source.heading')}</h1>
      <p class="v1i-help">{t('source.help')}</p>
      <div class="v1i-choices" role="radiogroup" aria-label={t('source.heading')}>
        {connectors.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={c.id === connectorId}
            class={`v1i-choice${c.id === connectorId ? ' v1i-choice-on' : ''}`}
            data-testid={`connector-${c.id}`}
            onClick={() => onPick(c.id)}
          >
            <span class="v1i-choice-name">{c.name}</span>
            {c.type ? <span class="v1i-muted">{c.type}</span> : null}
          </button>
        ))}
      </div>

      {connectorId ? (
        <div class="v1i-block">
          <button type="button" class="v1i-btn v1i-btn-plain" data-testid="diag-run" disabled={running} onClick={() => { void check(connectorId); }}>
            {running ? t('source.checking') : t('source.check')}
          </button>
          {error ? <p class="v1i-error" data-testid="diag-error">{t('source.checkError', { error })}</p> : null}
          {diag ? (
            <>
              <ul class="v1i-rows">
                {diag.steps.map((s) => (
                  <li key={s.id} data-testid={`diag-step-${s.id}`} data-status={s.status}>
                    <span class={`v1i-dot v1i-dot-${s.status}`} aria-hidden="true" />
                    <span class="v1i-row-main">
                      <span class="v1i-row-title">{stepName(s.id)}</span>
                      {s.detail ? <span class="v1i-muted v1i-wrap">{s.detail}</span> : null}
                    </span>
                    <span class="v1i-muted">{t(`status.${s.status}`)}</span>
                  </li>
                ))}
              </ul>
              <p class={failed ? 'v1i-error' : 'v1i-ok'} data-testid="diag-summary">
                {failed ? t('source.checkFailed', { step: stepName(failed.id) }) : t('source.checkPassed')}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const FIELDS: Array<{ key: keyof OptionsForm; type: 'text' | 'date'; help?: string; placeholder?: string }> = [
  { key: 'tz', type: 'text', help: 'options.tzHelp', placeholder: '+02:00' },
  { key: 'database', type: 'text', help: 'options.databaseHelp' },
  { key: 'from', type: 'date' },
  { key: 'to', type: 'date', help: 'options.datesHelp' },
  { key: 'panels', type: 'text', help: 'options.panelsHelp' },
];

/** Step 2. The options the plugin accepts. There is no free SQL. */
export function OptionsStep({ form, onChange }: { form: OptionsForm; onChange: (next: OptionsForm) => void }) {
  const wrong = problems(form);
  return (
    <section class="v1i-section">
      <h1>{t('options.heading')}</h1>
      <div class="v1i-form">
        {FIELDS.map((f) => {
          // A date range problem belongs under the to date.
          const fieldProblems = wrong.filter((p) => p === f.key || (p === 'range' && f.key === 'to'));
          return (
            <Fragment key={f.key}>
              <label for={`opt-${f.key}`}>{t(`options.${f.key}`)}</label>
              <div class="v1i-field">
                <input
                  id={`opt-${f.key}`}
                  class="v1i-input"
                  type={f.type}
                  value={form[f.key]}
                  placeholder={f.placeholder}
                  data-testid={`opt-${f.key}`}
                  aria-invalid={fieldProblems.length > 0}
                  onInput={(e) => onChange({ ...form, [f.key]: (e.currentTarget as HTMLInputElement).value })}
                />
                {fieldProblems.map((p) => <span key={p} class="v1i-problem" data-testid={`problem-${p}`}>{t(`problem.${p}`)}</span>)}
                {f.help ? <span class="v1i-muted">{t(f.help)}</span> : null}
              </div>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

/** Step 3. Table and row-count checks. Runs when the step opens. */
export function ChecksStep({ connectorId, options, onResult }: {
  connectorId: string;
  options: Record<string, string>;
  onResult: (ok: boolean) => void;
}) {
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const optionsKey = JSON.stringify(options);

  const run = useCallback(async () => {
    setRunning(true);
    setResults(null);
    setError(null);
    onResult(false);
    try {
      const out = await api.checks(connectorId, JSON.parse(optionsKey) as Record<string, string>);
      setResults(out);
      const tables = out.find((r) => r.id === 'tables_found');
      onResult(out.every((r) => !r.error) && Number(tables?.value) === 4);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(false);
    }
  }, [connectorId, optionsKey, onResult]);

  useEffect(() => { void run(); }, [run]);

  const tables = results?.find((r) => r.id === 'tables_found');
  const tablesMissing = tables !== undefined && !tables.error && Number(tables.value) !== 4;

  function value(r: CheckResult): string {
    if (r.error) return t('checks.failed');
    if (r.id === 'tables_found') return t('checks.tablesValue', { n: Number(r.value) });
    const n = Number(r.value);
    return r.value !== null && r.value !== '' && Number.isFinite(n) ? formatNumber(n) : String(r.value ?? '');
  }

  return (
    <section class="v1i-section">
      <h1>{t('checks.heading')}</h1>
      <p class="v1i-help">{t('checks.help')}</p>
      {running ? <p class="v1i-status" data-testid="checks-running">{t('checks.running')}</p> : null}
      {error ? <p class="v1i-error" data-testid="checks-error">{t('checks.error', { error })}</p> : null}
      {results ? (
        <ul class="v1i-rows">
          {results.map((r) => (
            <li key={r.id} data-testid={`check-${r.id}`}>
              <span class={`v1i-dot v1i-dot-${r.error || (r.id === 'tables_found' && tablesMissing) ? 'fail' : 'pass'}`} aria-hidden="true" />
              <span class="v1i-row-main">
                <span class="v1i-row-title">{has(`checks.${r.id}`) ? t(`checks.${r.id}`) : r.id}</span>
                {r.error ? <span class="v1i-muted v1i-wrap">{r.error}</span> : null}
              </span>
              <span class="v1i-num">{value(r)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {tablesMissing ? <p class="v1i-error" data-testid="checks-missing">{t('checks.tablesMissing')}</p> : null}
      {!running ? (
        <div class="v1i-block">
          <button type="button" class="v1i-btn v1i-btn-plain" data-testid="checks-again" onClick={() => { void run(); }}>{t('checks.runAgain')}</button>
        </div>
      ) : null}
    </section>
  );
}
