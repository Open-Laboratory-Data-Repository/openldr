import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api, canStopCopy, copyApi, isCopyLive, type AllowedConnector, type CopyRun } from './api';
import { browserOffset, fromOptions, problems, toOptions, type OptionsForm } from './options';
import { formatBytes, formatNumber, formatTime, t } from './i18n';
import { OptionsStep, SourceStep } from './steps';

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The sets in the order the plugin named them, then any the order does not name. */
function setNames(run: CopyRun): string[] {
  const named = run.setOrder.filter((n) => n in run.sets);
  return [...named, ...Object.keys(run.sets).filter((n) => !named.includes(n))];
}

function totals(run: CopyRun) {
  const out = { keys: 0, rows: 0, bytes: 0, skipped: 0 };
  for (const p of Object.values(run.sets)) {
    out.keys += p.keys;
    out.rows += p.rows;
    out.bytes += p.bytes;
    out.skipped += p.skipped;
  }
  return out;
}

/** What one set is doing. The copy reads sets in order, so the first set not done is the one being read. */
function setState(run: CopyRun, name: string, current: string | undefined): string {
  const p = run.sets[name]!;
  if (run.status === 'deleting') return 'deleting';
  if (p.empty) return 'reread';
  if (p.done) return 'done';
  if (name === current && (run.status === 'running' || run.status === 'stopping')) return 'copying';
  if (name === current && run.status === 'waiting') return 'waiting';
  return p.keys > 0 ? 'partial' : 'notStarted';
}

/** A confirm step. The brief and spec 9.5 call for a dialog here: it asks one question. */
function Confirm({ id, title, onCancel, children }: { id: string; title: string; onCancel: () => void; children: ComponentChildren }) {
  return (
    <div class="v1i-backdrop">
      <div
        class="v1i-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        data-testid={id}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** The Copy tab: pick a connector and options, start a copy, and watch, stop or delete it. */
export function CopyPanel({ pollMs }: { pollMs: number }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<AllowedConnector[]>([]);
  // One copy per plugin and connector, so the picked connector names the copy shown.
  const [copies, setCopies] = useState<CopyRun[]>([]);
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [form, setForm] = useState<OptionsForm>({ tz: browserOffset(), database: '', from: '', to: '', panels: '' });
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [changedSets, setChangedSets] = useState<string[] | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');

  const run = copies.find((c) => c.connectorId === connectorId) ?? null;
  const live = run !== null && isCopyLive(run.status);

  const put = useCallback((next: CopyRun) => setCopies((list) => [next, ...list.filter((c) => c.id !== next.id)]), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [allowed, list] = await Promise.all([api.allowed(), copyApi.list()]);
        if (cancelled) return;
        setConnectors(allowed);
        setCopies(list);
        // Copies come newest first. Open on one that is still going, else on the newest.
        const open = list.find((c) => isCopyLive(c.status)) ?? list[0];
        if (open) {
          setConnectorId(open.connectorId);
          setForm(fromOptions(open.options));
        }
      } catch (e) {
        if (!cancelled) setLoadError(errorText(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Counts presses. A progress read asked for before a press can answer after it, with the older
  // status; such an answer is dropped. Same rule as the Import tab's RunPanel.
  const actions = useRef(0);
  const runId = run?.id ?? null;

  useEffect(() => {
    if (runId === null || !live) return;
    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      const asked = actions.current;
      copyApi.status(runId)
        .then((next) => {
          if (cancelled || asked !== actions.current) return;
          setPollFailed(false);
          if (next) {
            put(next);
          } else {
            // The record is gone: the server finished a delete.
            setCopies((list) => list.filter((c) => c.id !== runId));
            setDeleted(true);
          }
        })
        .catch(() => { if (!cancelled && asked === actions.current) setPollFailed(true); })
        .finally(() => { inFlight = false; });
    }, pollMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [runId, live, pollMs, put]);

  // When a copy stops, fails or finishes, the form opens again with the options it had.
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live && run) setForm(fromOptions(run.options));
    wasLive.current = live;
  }, [live, run]);

  // Close the dots menu on a click outside it, or on Escape.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const deleteInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (deleteOpen) deleteInput.current?.focus(); }, [deleteOpen]);

  function pick(id: string) {
    if (id === connectorId) return;
    setConnectorId(id);
    setStartError(null);
    setActionError(null);
    setDeleted(false);
    const existing = copies.find((c) => c.connectorId === id);
    if (existing) setForm(fromOptions(existing.options));
  }

  async function start(reread: boolean) {
    if (!connectorId) return;
    setBusy(true);
    setStarting(true);
    setStartError(null);
    setActionError(null);
    setDeleted(false);
    actions.current += 1;
    try {
      const out = await copyApi.start({ connectorId, options: toOptions(form), ...(reread ? { reread: true } : {}) });
      actions.current += 1;
      if (out.changedSets && out.changedSets.length > 0) setChangedSets(out.changedSets);
      else if (out.run) put(out.run);
    } catch (e) {
      setStartError(errorText(e));
    } finally {
      setBusy(false);
      setStarting(false);
    }
  }

  async function act(call: (id: string) => Promise<CopyRun>) {
    if (!run) return;
    setMenuOpen(false);
    setBusy(true);
    setActionError(null);
    actions.current += 1;
    try {
      const next = await call(run.id);
      // Count again, so a read asked for while the press was in flight is dropped too.
      actions.current += 1;
      put(next);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function closeDelete() {
    setDeleteOpen(false);
    setDeleteText('');
  }

  if (!loaded) return <p class="v1i-status" data-testid="copy-loading">{t('loading')}</p>;

  const shown = live && run ? fromOptions(run.options) : form;
  const canStart = connectorId !== null && !busy && !live && problems(form).length === 0;
  const sum = run ? totals(run) : null;
  const names = run ? setNames(run) : [];
  const current = run ? names.find((n) => !run.sets[n]!.done) : undefined;
  const canDelete = run !== null && !busy && (run.status === 'stopped' || run.status === 'completed' || run.status === 'failed');
  const statusText = run
    ? t(run.status === 'completed' && sum!.skipped > 0 ? 'copy.status.completedSkipped' : `copy.status.${run.status}`)
    : '';
  const dot = !run ? 'skip'
    : run.status === 'failed' ? 'fail'
      : run.status === 'completed' && sum!.skipped === 0 ? 'pass' : 'warn';
  // While waiting, the error is why it waits, not a fault: it shows quietly. A failed copy shows it as an error.
  const waitingError = run?.status === 'waiting' ? run.waiting?.error ?? null : null;

  return (
    <div class="v1i-copy" data-testid="copy-panel">
      <p class="v1i-help">{t('copy.help')}</p>
      {loadError ? <p class="v1i-error" data-testid="copy-load-error">{t('loadError', { error: loadError })}</p> : null}

      <SourceStep connectors={connectors} connectorId={connectorId} onPick={pick} />

      {connectorId ? (
        <div class="v1i-block">
          <OptionsStep form={shown} heading={t('copy.optionsHeading')} readOnly={live} idPrefix="copy-opt" onChange={setForm} />
          {live ? <p class="v1i-muted" data-testid="copy-locked">{t('copy.locked')}</p> : null}
        </div>
      ) : null}

      <div class="v1i-block v1i-end">
        <button type="button" class="v1i-btn" data-testid="copy-start" disabled={!canStart} onClick={() => { void start(false); }}>
          {starting ? t('copy.starting') : t('copy.start')}
        </button>
      </div>
      {startError ? <p class="v1i-error v1i-wrap" data-testid="copy-start-error">{t('copy.startError', { error: startError })}</p> : null}
      {deleted ? <p class="v1i-ok" data-testid="copy-deleted">{t('copy.deleted')}</p> : null}

      {run && sum ? (
        <div class="v1i-run" data-testid="copy-run" data-copy-status={run.status}>
          <div class="v1i-run-head">
            <span class={`v1i-dot v1i-dot-${dot}`} aria-hidden="true" />
            <span class="v1i-row-main">
              <span data-testid="copy-status">{statusText}</span>
              <span class="v1i-muted" data-testid="copy-summary">
                {t(run.status === 'completed' ? 'copy.summaryDone' : 'copy.summary', { n: formatNumber(sum.keys) })}
              </span>
            </span>
            <div class="v1i-menu" ref={menuRef}>
              <button
                type="button"
                class="v1i-btn v1i-btn-plain v1i-btn-icon"
                data-testid="copy-menu"
                aria-label={t('copy.menu')}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <span aria-hidden="true">⋯</span>
              </button>
              {menuOpen ? (
                <div class="v1i-menu-list" role="menu">
                  <button type="button" role="menuitem" class="v1i-menu-item" data-testid="copy-stop" disabled={busy || !canStopCopy(run.status)} onClick={() => { void act(copyApi.stop); }}>
                    {t('copy.stop')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    class="v1i-menu-item v1i-menu-danger"
                    data-testid="copy-delete"
                    disabled={!canDelete}
                    onClick={() => { setMenuOpen(false); setDeleteText(''); setDeleteOpen(true); }}
                  >
                    {t('copy.delete')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {run.status === 'waiting' && run.waiting ? (
            <p class="v1i-muted" data-testid="copy-waiting">{t('copy.waiting', { n: formatNumber(run.waiting.attempt), since: formatTime(run.waiting.since) })}</p>
          ) : null}
          {waitingError ? <p class="v1i-muted v1i-wrap" data-testid="copy-last-error">{t('copy.lastError', { error: waitingError })}</p> : null}
          {!waitingError && run.lastError ? <p class="v1i-error v1i-wrap" data-testid="copy-last-error">{t('copy.lastError', { error: run.lastError })}</p> : null}
          {actionError ? <p class="v1i-error v1i-wrap" data-testid="copy-action-error">{t('run.actionError', { error: actionError })}</p> : null}
          {pollFailed ? <p class="v1i-muted" data-testid="copy-poll-error">{t('run.pollError')}</p> : null}

          <div class="v1i-table-wrap">
            <table class="v1i-table" data-testid="copy-sets">
              <thead>
                <tr>
                  <th scope="col">{t('copy.col.set')}</th>
                  <th scope="col" class="v1i-num">{t('copy.col.keys')}</th>
                  <th scope="col" class="v1i-num">{t('copy.col.rows')}</th>
                  <th scope="col" class="v1i-num">{t('copy.col.bytes')}</th>
                  <th scope="col">{t('copy.col.state')}</th>
                </tr>
              </thead>
              <tbody>
                {names.map((name) => {
                  const p = run.sets[name]!;
                  return (
                    <tr key={name} data-set={name} data-testid={`copy-set-${name}`}>
                      <td class="v1i-wrap">{name}</td>
                      <td class="v1i-num">{formatNumber(p.keys)}</td>
                      <td class="v1i-num">{formatNumber(p.rows)}</td>
                      <td class="v1i-num">{formatBytes(p.bytes)}</td>
                      <td>{t(`copy.set.${setState(run, name, current)}`)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sum.skipped > 0 ? (
            <p class="v1i-warning" role="alert" data-testid="copy-skipped">{t('copy.skipped', { n: formatNumber(sum.skipped) })}</p>
          ) : null}
        </div>
      ) : null}

      {changedSets ? (
        <Confirm id="copy-reread-dialog" title={t('copy.rereadTitle')} onCancel={() => setChangedSets(null)}>
          <p>{t('copy.rereadBody', { sets: changedSets.join(', ') })}</p>
          <p class="v1i-muted">{t('copy.rereadHelp')}</p>
          <div class="v1i-dialog-foot">
            <button type="button" class="v1i-btn v1i-btn-plain" data-testid="copy-reread-no" onClick={() => setChangedSets(null)}>{t('copy.cancel')}</button>
            <button type="button" class="v1i-btn v1i-btn-danger" data-testid="copy-reread-yes" onClick={() => { setChangedSets(null); void start(true); }}>{t('copy.rereadYes')}</button>
          </div>
        </Confirm>
      ) : null}

      {deleteOpen && run && sum ? (
        <Confirm id="copy-delete-dialog" title={t('copy.deleteTitle')} onCancel={closeDelete}>
          <p>{t('copy.deleteBody', { rows: formatNumber(sum.rows), size: formatBytes(sum.bytes) })}</p>
          <label for="copy-delete-input">{t('copy.deleteType', { id: run.pluginId })}</label>
          <input
            id="copy-delete-input"
            ref={deleteInput}
            class="v1i-input"
            type="text"
            autocomplete="off"
            spellcheck={false}
            value={deleteText}
            data-testid="copy-delete-input"
            onInput={(e) => setDeleteText((e.currentTarget as HTMLInputElement).value)}
          />
          <div class="v1i-dialog-foot">
            <button type="button" class="v1i-btn v1i-btn-plain" data-testid="copy-delete-cancel" onClick={closeDelete}>{t('copy.cancel')}</button>
            <button
              type="button"
              class="v1i-btn v1i-btn-danger"
              data-testid="copy-delete-confirm"
              disabled={deleteText.trim() !== run.pluginId}
              onClick={() => {
                if (deleteText.trim() !== run.pluginId) return;
                closeDelete();
                void act(copyApi.remove);
              }}
            >
              {t('copy.deleteConfirm')}
            </button>
          </div>
        </Confirm>
      ) : null}
    </div>
  );
}
