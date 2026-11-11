import { useEffect, useState } from 'preact/hooks';
import { getOpenldr } from './sdk';
import { api, canResume, isActive, type AllowedConnector, type ImportRun } from './api';
import { browserOffset, fromOptions, problems, toOptions, type OptionsForm } from './options';
import { t } from './i18n';
import { ChecksStep, OptionsStep, SourceStep } from './steps';
import { DryRunStep, ImportStep } from './runSteps';

const STEPS = ['source', 'options', 'checks', 'dryRun', 'import'] as const;
const LAST = STEPS.length - 1;

/** The import page: five steps, in order. `pollMs` is how often a running import is re-read. */
export function App({ pollMs = 2000 }: { pollMs?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<AllowedConnector[]>([]);
  const [step, setStep] = useState(0);
  // The furthest step opened so far. The step buttons go back to any of these.
  const [reached, setReached] = useState(0);
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [form, setForm] = useState<OptionsForm>({ tz: browserOffset(), database: '', from: '', to: '', panels: '' });
  const [checksOk, setChecksOk] = useState(false);
  const [dryRun, setDryRun] = useState<ImportRun | null>(null);
  const [run, setRun] = useState<ImportRun | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getOpenldr().ready;
        const [allowed, runs] = await Promise.all([api.allowed(), api.list()]);
        if (cancelled) return;
        setConnectors(allowed);
        // Runs come newest first. Open on work that is still going, or that can carry on.
        const lastReal = runs.find((r) => !r.dryRun);
        const openOn = (r: ImportRun, at: number) => {
          setConnectorId(r.connectorId);
          setForm(fromOptions(r.options));
          setStep(at);
          setReached(at);
        };
        if (lastReal && (isActive(lastReal.status) || canResume(lastReal.status))) {
          setRun(lastReal);
          openOn(lastReal, LAST);
        } else if (runs[0]?.dryRun && isActive(runs[0].status)) {
          setDryRun(runs[0]);
          setChecksOk(true);
          openOn(runs[0], LAST - 1);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setLoaded(true);
          document.body.setAttribute('data-openldr-ready', '1');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // A changed source or option makes the checks and the dry run stale.
  function invalidate(at: number) {
    setChecksOk(false);
    setDryRun(null);
    setReached(at);
  }

  const options = toOptions(form);
  const canNext = [
    connectorId !== null,
    problems(form).length === 0,
    checksOk,
    dryRun?.status === 'completed',
    false,
  ][step];
  const connectorName = connectors.find((c) => c.id === connectorId)?.name ?? connectorId ?? '';

  function go(to: number) {
    setStep(to);
    setReached((r) => Math.max(r, to));
  }

  if (!loaded) return <div class="v1i-shell"><p class="v1i-status" data-testid="loading">{t('loading')}</p></div>;

  return (
    <div class="v1i-shell">
      <ol class="v1i-steps" data-testid="steps">
        {STEPS.map((name, i) => (
          <li key={name}>
            <button
              type="button"
              class={`v1i-step${i === step ? ' v1i-step-on' : ''}`}
              data-testid={`step-${i}`}
              aria-current={i === step ? 'step' : undefined}
              aria-label={`${i + 1}. ${t(`step.${name}`)}`}
              disabled={i > reached}
              onClick={() => setStep(i)}
            >
              <span class="v1i-step-n">{i + 1}</span>
              <span class="v1i-step-label">{t(`step.${name}`)}</span>
            </button>
          </li>
        ))}
      </ol>

      <div class="v1i-body">
        {loadError ? <p class="v1i-error" data-testid="load-error">{t('loadError', { error: loadError })}</p> : null}
        {step === 0 ? (
          <SourceStep
            connectors={connectors}
            connectorId={connectorId}
            onPick={(id) => { if (id !== connectorId) { setConnectorId(id); invalidate(0); } }}
          />
        ) : null}
        {step === 1 ? <OptionsStep form={form} onChange={(next) => { setForm(next); invalidate(1); }} /> : null}
        {step === 2 && connectorId ? <ChecksStep connectorId={connectorId} options={options} onResult={setChecksOk} /> : null}
        {step === 3 && connectorId ? (
          <DryRunStep connectorId={connectorId} options={options} run={dryRun} onRun={setDryRun} pollMs={pollMs} />
        ) : null}
        {step === LAST && connectorId ? (
          <ImportStep connectorId={connectorId} connectorName={connectorName} options={options} run={run} onRun={setRun} pollMs={pollMs} />
        ) : null}
      </div>

      <div class="v1i-foot">
        {step > 0 ? (
          <button type="button" class="v1i-btn v1i-btn-plain" data-testid="back" onClick={() => setStep(step - 1)}>{t('nav.back')}</button>
        ) : <span />}
        {step < LAST ? (
          <button type="button" class="v1i-btn" data-testid="next" disabled={!canNext} onClick={() => go(step + 1)}>{t('nav.next')}</button>
        ) : null}
      </div>
    </div>
  );
}
