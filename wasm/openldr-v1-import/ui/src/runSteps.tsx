import { useState } from 'preact/hooks';
import { api, isActive, type ImportRun } from './api';
import { t } from './i18n';
import { RunPanel } from './RunPanel';

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const DRY_MAX = 5000;

/** Starts a run and reports why it could not start. Shared by the dry run and the real import. */
function useStart(onRun: (run: ImportRun) => void) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start(input: Parameters<typeof api.start>[0]) {
    setStarting(true);
    setError(null);
    try {
      onRun(await api.start(input));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  }
  return { starting, error, start };
}

/** Step 4. Read and map a few requests without saving anything. */
export function DryRunStep({ connectorId, options, run, onRun, pollMs }: {
  connectorId: string;
  options: Record<string, string>;
  run: ImportRun | null;
  onRun: (run: ImportRun) => void;
  pollMs: number;
}) {
  const [limitText, setLimitText] = useState('100');
  const { starting, error, start } = useStart(onRun);
  const limit = /^\d+$/.test(limitText.trim()) ? Number(limitText.trim()) : NaN;
  const limitOk = Number.isInteger(limit) && limit >= 1 && limit <= DRY_MAX;
  const blocked = starting || !limitOk || (run !== null && isActive(run.status));

  return (
    <section class="v1i-section">
      <h1>{t('dry.heading')}</h1>
      <p class="v1i-help">{t('dry.help')}</p>
      <div class="v1i-form">
        <label for="dry-limit">{t('dry.limit')}</label>
        <div class="v1i-field">
          <input
            id="dry-limit"
            class="v1i-input v1i-input-short"
            type="text"
            inputMode="numeric"
            value={limitText}
            data-testid="dry-limit"
            aria-invalid={!limitOk}
            onInput={(e) => setLimitText((e.currentTarget as HTMLInputElement).value)}
          />
          {!limitOk ? <span class="v1i-problem" data-testid="dry-limit-problem">{t('dry.limitProblem')}</span> : null}
        </div>
      </div>
      <div class="v1i-block">
        <button type="button" class="v1i-btn" data-testid="dry-start" disabled={blocked} onClick={() => { void start({ connectorId, options, limit, dryRun: true }); }}>
          {t('dry.start')}
        </button>
      </div>
      {error ? <p class="v1i-error v1i-wrap" data-testid="start-error">{t('run.startError', { error })}</p> : null}
      {run ? <RunPanel run={run} onChange={onRun} pollMs={pollMs} /> : null}
    </section>
  );
}

/** Step 5. The real import: start it, watch it, stop it, resume it. */
export function ImportStep({ connectorId, connectorName, options, run, onRun, pollMs }: {
  connectorId: string;
  connectorName: string;
  options: Record<string, string>;
  run: ImportRun | null;
  onRun: (run: ImportRun) => void;
  pollMs: number;
}) {
  const { starting, error, start } = useStart(onRun);
  const active = run !== null && isActive(run.status);

  return (
    <section class="v1i-section">
      <h1>{t('import.heading')}</h1>
      <p class="v1i-help">{t('import.help')}</p>
      <dl class="v1i-summary">
        <div data-testid="import-connector"><dt>{t('import.from')}</dt><dd>{connectorName}</dd></div>
        {Object.entries(options).map(([k, v]) => (
          <div key={k}><dt>{t(`options.${k}`)}</dt><dd class="v1i-wrap">{v}</dd></div>
        ))}
      </dl>
      {!active ? (
        <div class="v1i-block">
          <button
            type="button"
            class={`v1i-btn${run ? ' v1i-btn-plain' : ''}`}
            data-testid="import-start"
            disabled={starting}
            onClick={() => { void start({ connectorId, options }); }}
          >
            {run ? t('import.startNew') : t('import.start')}
          </button>
        </div>
      ) : null}
      {error ? <p class="v1i-error v1i-wrap" data-testid="start-error">{t('run.startError', { error })}</p> : null}
      {run ? <RunPanel run={run} onChange={onRun} pollMs={pollMs} /> : null}
    </section>
  );
}
