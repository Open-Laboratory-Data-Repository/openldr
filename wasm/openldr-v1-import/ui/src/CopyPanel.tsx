import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api, canStopCopy, copyApi, isCopyLive, type AllowedConnector, type CopyRun, type CopyStatus } from './api';
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

/** Every copy status, so a status added to the SDK fails to compile here until it has a label. */
const STATUSES: Record<CopyStatus, true> = {
  queued: true, running: true, waiting: true, stopping: true, stopped: true, completed: true, failed: true, deleting: true,
};
/** Every status key the page can build. The i18n test checks each has a label in every language. */
export const COPY_STATUS_KEYS: readonly string[] = [
  ...Object.keys(STATUSES).map((s) => `copy.status.${s}`), 'copy.status.completedSkipped',
];
/** Every state a set can show. `setState` returns one of these, so the list stays whole. */
export const SET_STATES = ['deleting', 'reread', 'done', 'copying', 'waiting', 'partial', 'notStarted'] as const;
type SetState = (typeof SET_STATES)[number];

/** What one set is doing. The copy reads sets in order, so the first set not done is the one being read. */
function setState(run: CopyRun, name: string, current: string | undefined): SetState {
  const p = run.sets[name]!;
  if (run.status === 'deleting') return 'deleting';
  if (p.empty) return 'reread';
  if (p.done) return 'done';
  if (name === current && (run.status === 'running' || run.status === 'stopping')) return 'copying';
  if (name === current && run.status === 'waiting') return 'waiting';
  return p.keys > 0 ? 'partial' : 'notStarted';
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A confirm step. The brief and spec 9.5 call for a dialog here: it asks one question. It is
 * modal (R36): focus moves in on open, Tab and Shift+Tab stay inside, Escape closes it, and on
 * close focus goes back to `returnTo`. The caller makes everything behind it `inert`.
 */
function Confirm({ id, title, onCancel, returnTo, children }: {
  id: string;
  title: string;
  onCancel: () => void;
  returnTo: () => HTMLElement | null;
  children: ComponentChildren;
}) {
  const box = useRef<HTMLDivElement>(null);
  const back = useRef(returnTo);
  back.current = returnTo;

  useEffect(() => {
    const el = box.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    // After the step has gone and the page behind it is no longer inert.
    return () => { setTimeout(() => back.current()?.focus(), 0); };
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !box.current.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !box.current.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div class="v1i-backdrop">
      <div ref={box} class="v1i-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} data-testid={id} onKeyDown={onKeyDown}>
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** The request a start call sent, kept with the sets it named, so a yes resends exactly that (R35). */
interface Asked { connectorId: string; options: Record<string, string>; changedSets: string[] }

/** The tab's two dots menus: Start at the top, Stop and Delete on the copy card. One is open at most. */
type MenuName = 'start' | 'card';
type SetMenu = (next: (open: MenuName | null) => MenuName | null) => void;

/**
 * A dots menu: focus moves to its first usable item, the arrow keys move between items, and a
 * click outside or Escape closes it. Escape gives focus back to the menu's button. Tab closes it
 * and lets focus move on. Arrows and Escape count only while focus is in the menu or on its
 * button, so a field below keeps its own keys. Escape also counts while focus is on the page body.
 */
function useMenu(name: MenuName, open: boolean, setOpen: SetMenu, box: { current: HTMLElement | null }, button: { current: HTMLElement | null }) {
  useEffect(() => {
    if (!open) return;
    // Closes this menu only, so a press that opened the other menu is kept.
    const close = () => setOpen((o) => (o === name ? null : o));
    const items = () => [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    (items().find((i) => i.getAttribute('aria-disabled') !== 'true') ?? items()[0])?.focus();
    const onClick = (e: Event) => { if (!box.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        close();
        return;
      }
      // Focus on the page body counts as in the menu for Escape only, so a menu whose focus was
      // lost still closes from the keyboard.
      const onBody = document.activeElement === null || document.activeElement === document.body;
      if (!box.current?.contains(document.activeElement) && !(e.key === 'Escape' && onBody)) return;
      if (e.key === 'Escape') {
        close();
        button.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = items();
      if (list.length === 0) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]!.focus();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);
}

/**
 * The Copy tab: pick a connector and options, start a copy, and watch, stop or delete it.
 * `shown` is false while the Import tab is in front: the panel then stops reading the copy.
 */
export function CopyPanel({ pollMs, shown = true }: { pollMs: number; shown?: boolean }) {
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
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const menuOpen = openMenu === 'card';
  const startMenuOpen = openMenu === 'start';
  const [asked, setAsked] = useState<Asked | null>(null);
  // The copy the delete step is for, fixed when the step opens.
  const [deleting, setDeleting] = useState<CopyRun | null>(null);
  const [deleteText, setDeleteText] = useState('');

  const run = copies.find((c) => c.connectorId === connectorId) ?? null;
  const live = run !== null && isCopyLive(run.status);
  const stepOpen = asked !== null || deleting !== null;
  // The picker takes no input while a start call is out or a step is open (R35). A live copy does
  // not lock it: with two connectors, the other one's copy can be seen or started (spec 9.2).
  const pickerLocked = starting || stepOpen;
  // The form also takes no input while the copy shown is live.
  const locked = live || pickerLocked;
  // The dots menu holds Stop and Delete. When neither can be used any more, it closes.
  const menuUsable = run !== null && !busy
    && (canStopCopy(run.status) || run.status === 'stopped' || run.status === 'completed' || run.status === 'failed');
  // The Start menu's one item. Its button is off when this is false (R3).
  const canStart = connectorId !== null && !busy && !locked && problems(form).length === 0;

  const put = useCallback((next: CopyRun) => setCopies((list) => [next, ...list.filter((c) => c.id !== next.id)]), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Each list loads on its own, so one failed call does not blank the other.
        const [allowed, list] = await Promise.allSettled([api.allowed(), copyApi.list()]);
        if (cancelled) return;
        if (allowed.status === 'fulfilled') setConnectors(allowed.value);
        const failed = [allowed, list].find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed) setLoadError(errorText(failed.reason));
        if (list.status === 'fulfilled') {
          setCopies(list.value);
          // Copies come newest first. Open on one that is still going, else on the newest.
          const open = list.value.find((c) => isCopyLive(c.status)) ?? list.value[0];
          if (open) {
            setConnectorId(open.connectorId);
            setForm(fromOptions(open.options));
          }
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Counts presses. A progress read asked for before a press can answer after it, with the older
  // status; such an answer is dropped. Same rule as the Import tab's RunPanel.
  const actions = useRef(0);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // The interval can fire once between the render that ends the copy and the effect's cleanup.
  const liveRef = useRef(live);
  liveRef.current = live;
  const runId = run?.id ?? null;

  useEffect(() => {
    if (runId === null || !live) return;
    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(() => {
      // Nobody is looking: the tab is behind the Import tab, or the browser tab is hidden.
      if (inFlight || !liveRef.current || !shownRef.current || document.visibilityState === 'hidden') return;
      inFlight = true;
      const at = actions.current;
      copyApi.status(runId)
        .then((next) => {
          if (cancelled || at !== actions.current) return;
          setPollFailed(false);
          if (next) {
            put(next);
          } else {
            // The record is gone: the server finished a delete.
            setCopies((list) => list.filter((c) => c.id !== runId));
            setDeleted(true);
          }
        })
        .catch(() => { if (!cancelled && at === actions.current) setPollFailed(true); })
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

  // The copy card's dots menu, and the Start menu at the top of the tab.
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const startMenuRef = useRef<HTMLDivElement>(null);
  const startMenuButton = useRef<HTMLButtonElement>(null);
  const statusLine = useRef<HTMLSpanElement>(null);
  useMenu('card', menuOpen, setOpenMenu, menuRef, menuButton);
  useMenu('start', startMenuOpen, setOpenMenu, startMenuRef, startMenuButton);
  // The dots button is disabled once nothing in the menu can be used, so focus goes to the status line.
  useEffect(() => {
    if (!menuOpen || menuUsable) return;
    setOpenMenu((o) => (o === 'card' ? null : o));
    statusLine.current?.focus();
  }, [menuOpen, menuUsable]);
  // R3, the same for the Start menu. Focus moves only if it was in the menu, which is going.
  useEffect(() => {
    if (!startMenuOpen || canStart) return;
    const hadFocus = startMenuRef.current?.contains(document.activeElement) ?? false;
    setOpenMenu((o) => (o === 'start' ? null : o));
    if (hadFocus) statusLine.current?.focus();
  }, [startMenuOpen, canStart]);

  // R33: the Start menu button is off while a start call is out, so a browser drops its focus to
  // the page body. When the call ends, focus that is on the body or on that button goes to the
  // button if it is on, else to the copy card's status line. Focus a step took is left alone.
  const wasStarting = useRef(starting);
  useEffect(() => {
    const ended = wasStarting.current && !starting;
    wasStarting.current = starting;
    if (!ended) return;
    const at = document.activeElement;
    const button = startMenuButton.current;
    if (at !== null && at !== document.body && at !== button) return;
    if (button && !button.disabled) button.focus();
    else statusLine.current?.focus();
  }, [starting]);

  /** Where focus goes when a step closes: its opener, or the status line when the opener is disabled. */
  const focusBack = (opener: HTMLElement | null) => () => (opener && !(opener as HTMLButtonElement).disabled ? opener : statusLine.current);

  function pick(id: string) {
    if (id === connectorId || pickerLocked) return;
    setConnectorId(id);
    setStartError(null);
    setActionError(null);
    setDeleted(false);
    setAsked(null);
    setDeleting(null);
    const existing = copies.find((c) => c.connectorId === id);
    if (existing) setForm(fromOptions(existing.options));
  }

  async function start(request: { connectorId: string; options: Record<string, string> }, reread: boolean) {
    setBusy(true);
    setStarting(true);
    setStartError(null);
    setActionError(null);
    setDeleted(false);
    actions.current += 1;
    try {
      const out = await copyApi.start({ ...request, ...(reread ? { reread: true } : {}) });
      actions.current += 1;
      if (!reread && out.changedSets && out.changedSets.length > 0) setAsked({ ...request, changedSets: out.changedSets });
      else if (out.run) put(out.run);
    } catch (e) {
      setStartError(errorText(e));
    } finally {
      setBusy(false);
      setStarting(false);
    }
  }

  async function act(copyId: string, call: (id: string) => Promise<CopyRun>) {
    setOpenMenu(null);
    setBusy(true);
    setActionError(null);
    actions.current += 1;
    try {
      const next = await call(copyId);
      // Count again, so a read asked for while the press was in flight is dropped too.
      actions.current += 1;
      put(next);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p class="v1i-status" data-testid="copy-loading">{t('loading')}</p>;

  const formShown = live && run ? fromOptions(run.options) : form;
  const sum = run ? totals(run) : null;
  const names = run ? setNames(run) : [];
  const current = run ? names.find((n) => !run.sets[n]!.done) : undefined;
  const canStop = run !== null && !busy && canStopCopy(run.status);
  const canDelete = run !== null && !busy && (run.status === 'stopped' || run.status === 'completed' || run.status === 'failed');
  const statusText = run
    ? t(run.status === 'completed' && sum!.skipped > 0 ? 'copy.status.completedSkipped' : `copy.status.${run.status}`)
    : '';
  const dot = !run ? 'skip'
    : run.status === 'failed' ? 'fail'
      : run.status === 'completed' && sum!.skipped === 0 ? 'pass' : 'warn';
  // While waiting, the error is why it waits, not a fault: it shows quietly. A failed copy shows it as an error.
  const waitingError = run?.status === 'waiting' ? run.waiting?.error ?? null : null;
  const lockedNote = !live || !run ? null
    : run.status === 'stopping' ? 'copy.lockedStopping'
      : run.status === 'deleting' ? 'copy.lockedDeleting' : 'copy.locked';
  const nameOf = (id: string) => connectors.find((c) => c.id === id)?.name ?? id;

  return (
    <div class="v1i-copy" data-testid="copy-panel">
      <div data-testid="copy-main" inert={stepOpen || undefined}>
        <p class="v1i-help">{t('copy.help')}</p>
        {loadError ? <p class="v1i-error v1i-wrap" data-testid="copy-load-error">{t('loadError', { error: loadError })}</p> : null}

        {/* The first row: the connector picker, and at its right end the dots menu that holds Start (spec 4.6). */}
        <div class="v1i-source-row" data-testid="copy-source-row">
          <div class="v1i-source-main">
            <SourceStep connectors={connectors} connectorId={connectorId} onPick={pick} disabled={pickerLocked} />
          </div>
          <div class="v1i-menu" ref={startMenuRef}>
            <button
              ref={startMenuButton}
              type="button"
              class="v1i-btn v1i-btn-plain v1i-btn-icon"
              data-testid="copy-actions"
              aria-label={t('copy.actions')}
              aria-haspopup="menu"
              aria-expanded={startMenuOpen}
              // R3: no menu that opens with nothing usable in it, as the copy card's menu.
              disabled={!canStart}
              // Checked here too: a test DOM delivers clicks to a disabled button.
              onClick={() => { if (canStart) setOpenMenu((o) => (o === 'start' ? null : 'start')); }}
            >
              <span aria-hidden="true">⋯</span>
            </button>
            {startMenuOpen ? (
              <div class="v1i-menu-list" role="menu" aria-label={t('copy.actions')}>
                <button
                  type="button"
                  role="menuitem"
                  class="v1i-menu-item"
                  data-testid="copy-start"
                  aria-disabled={!canStart}
                  onClick={() => {
                    if (!canStart || !connectorId) return;
                    setOpenMenu(null);
                    startMenuButton.current?.focus();
                    void start({ connectorId, options: toOptions(form) }, false);
                  }}
                >
                  {run && !live ? t('copy.continue') : t('copy.start')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {/* The menu cannot open while a start call is out, so this line says it is under way. It is
            always in the page, so a screen reader hears the text arrive. Empty, it takes no room. */}
        <div class="v1i-muted v1i-start-status" role="status" data-testid="copy-starting">{starting ? t('copy.starting') : null}</div>

        {connectorId ? (
          <div class="v1i-block">
            <OptionsStep
              form={formShown}
              heading={t('copy.optionsHeading')}
              readOnly={locked}
              idPrefix="copy-opt"
              help={{ tz: 'copy.tzHelp', to: 'copy.datesHelp' }}
              onChange={setForm}
            />
            {lockedNote ? <p class="v1i-muted" data-testid="copy-locked">{t(lockedNote)}</p> : null}
          </div>
        ) : null}

        {startError ? <p class="v1i-error v1i-wrap" data-testid="copy-start-error">{t('copy.startError', { error: startError })}</p> : null}
        {deleted ? <p class="v1i-ok" data-testid="copy-deleted">{t('copy.deleted')}</p> : null}

        {run && sum ? (
          <div class="v1i-run" data-testid="copy-run" data-copy-status={run.status}>
            <div class="v1i-run-head">
              <span class={`v1i-dot v1i-dot-${dot}`} aria-hidden="true" />
              <span class="v1i-row-main">
                <span class="v1i-status-line" data-testid="copy-status" ref={statusLine} tabIndex={-1}>{statusText}</span>
                <span class="v1i-muted" data-testid="copy-summary">
                  {t(run.status === 'completed' ? 'copy.summaryDone' : 'copy.summary', { n: formatNumber(sum.keys) })}
                </span>
              </span>
              <div class="v1i-menu" ref={menuRef}>
                <button
                  ref={menuButton}
                  type="button"
                  class="v1i-btn v1i-btn-plain v1i-btn-icon"
                  data-testid="copy-menu"
                  aria-label={t('copy.menu')}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  // R37: no menu that opens with nothing usable in it.
                  disabled={!canStop && !canDelete}
                  onClick={() => setOpenMenu((o) => (o === 'card' ? null : 'card'))}
                >
                  <span aria-hidden="true">⋯</span>
                </button>
                {menuOpen ? (
                  <div class="v1i-menu-list" role="menu" aria-label={t('copy.menu')}>
                    <button
                      type="button"
                      role="menuitem"
                      class="v1i-menu-item"
                      data-testid="copy-stop"
                      // aria-disabled, not disabled, so the item can still be found with the keyboard.
                      aria-disabled={!canStop}
                      onClick={() => { if (canStop) void act(run.id, copyApi.stop); }}
                    >
                      {t('copy.stop')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class="v1i-menu-item v1i-menu-danger"
                      data-testid="copy-delete"
                      aria-disabled={!canDelete}
                      onClick={() => {
                        if (!canDelete) return;
                        setOpenMenu(null);
                        setDeleteText('');
                        setDeleting(run);
                      }}
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
                    {/* State second, so it is on screen at phone width. */}
                    <th scope="col">{t('copy.col.state')}</th>
                    <th scope="col" class="v1i-num">{t('copy.col.keys')}</th>
                    <th scope="col" class="v1i-num">{t('copy.col.rows')}</th>
                    <th scope="col" class="v1i-num">{t('copy.col.bytes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {names.map((name) => {
                    const p = run.sets[name]!;
                    return (
                      <tr key={name} data-set={name} data-testid={`copy-set-${name}`}>
                        <td class="v1i-set-name">{name}</td>
                        <td>{t(`copy.set.${setState(run, name, current)}`)}</td>
                        <td class="v1i-num">{formatNumber(p.keys)}</td>
                        <td class="v1i-num">{formatNumber(p.rows)}</td>
                        <td class="v1i-num">{formatBytes(p.bytes)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sum.skipped > 0 ? (
              // role="status", not "alert": the count can rise on every read during a run.
              <p class="v1i-warning" role="status" data-testid="copy-skipped">{t('copy.skipped', { n: formatNumber(sum.skipped) })}</p>
            ) : null}
            <p class="v1i-muted" data-testid="copy-updated">{t('copy.updated', { time: formatTime(run.updatedAt) })}</p>
          </div>
        ) : null}
      </div>

      {asked ? (
        <Confirm id="copy-reread-dialog" title={t('copy.rereadTitle')} onCancel={() => setAsked(null)} returnTo={focusBack(startMenuButton.current)}>
          <p>{t('copy.rereadBody', { sets: asked.changedSets.join(', ') })}</p>
          <p class="v1i-muted">{t('copy.rereadHelp')}</p>
          <div class="v1i-dialog-foot">
            <button type="button" class="v1i-btn v1i-btn-plain" data-testid="copy-reread-no" onClick={() => setAsked(null)}>{t('copy.cancel')}</button>
            <button
              type="button"
              class="v1i-btn v1i-btn-danger"
              data-testid="copy-reread-yes"
              onClick={() => {
                // Exactly what the server answered about, never the form as it stands now (R35).
                const { changedSets: _named, ...request } = asked;
                setAsked(null);
                void start(request, true);
              }}
            >
              {t('copy.rereadYes')}
            </button>
          </div>
        </Confirm>
      ) : null}

      {deleting ? (() => {
        const target = deleting;
        const size = totals(target);
        const close = () => { setDeleting(null); setDeleteText(''); };
        const matches = deleteText.trim() === target.pluginId;
        return (
          <Confirm id="copy-delete-dialog" title={t('copy.deleteTitle')} onCancel={close} returnTo={focusBack(menuButton.current)}>
            <p>{t('copy.deleteBody', { connector: nameOf(target.connectorId), rows: formatNumber(size.rows), size: formatBytes(size.bytes) })}</p>
            <label for="copy-delete-input">{t('copy.deleteType', { id: target.pluginId })}</label>
            <input
              id="copy-delete-input"
              class="v1i-input"
              type="text"
              autocomplete="off"
              spellcheck={false}
              value={deleteText}
              data-testid="copy-delete-input"
              data-autofocus
              onInput={(e) => setDeleteText((e.currentTarget as HTMLInputElement).value)}
            />
            <div class="v1i-dialog-foot">
              <button type="button" class="v1i-btn v1i-btn-plain" data-testid="copy-delete-cancel" onClick={close}>{t('copy.cancel')}</button>
              <button
                type="button"
                class="v1i-btn v1i-btn-danger"
                data-testid="copy-delete-confirm"
                disabled={!matches}
                onClick={() => {
                  if (!matches) return;
                  close();
                  void act(target.id, copyApi.remove);
                }}
              >
                {t('copy.deleteConfirm')}
              </button>
            </div>
          </Confirm>
        );
      })() : null}
    </div>
  );
}
