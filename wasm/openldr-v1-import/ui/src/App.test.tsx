import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { App } from './App';
import { resetLocale } from './i18n';

// Layer proven here: the page's own logic against the SDK mock. Not proven: the real broker,
// the iframe sandbox, or a database. The browser check on a live CE covers those.

type Imports = ReturnType<typeof createMockOpenldr>['imports'];

const ms = { id: 'ms', name: 'V1 SQL Server', type: 'microsoft-sql' };

function run(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', connectorId: 'ms', status: 'running', dryRun: false, options: { tz: '+02:00' }, limit: null,
    counts: { keys: 0, imported: 0, failed: 0, resources: 0 },
    startedAt: '2026-11-11T10:00:00.000Z', updatedAt: '2026-11-11T10:00:00.000Z', finishedAt: null, lastError: null,
    ...over,
  };
}

function setup(over: Partial<Imports> = {}) {
  const o = createMockOpenldr({ pluginId: 'openldr-v1-import' });
  Object.assign(o.imports, { allowed: async () => [ms] }, over);
  (window as unknown as { openldr: unknown }).openldr = o;
  return o;
}

const click = (id: string) => fireEvent.click(screen.getByTestId(id));
const type = (id: string, value: string) => fireEvent.input(screen.getByTestId(id), { target: { value } });
const disabled = (id: string) => (screen.getByTestId(id) as HTMLButtonElement).disabled;

/** Pick the connector, keep the default options with a known time zone, and reach the Checks step. */
async function toChecks() {
  render(<App pollMs={5} />);
  click(await screen.findByTestId('connector-ms').then(() => 'connector-ms'));
  click('next');
  type('opt-tz', '+02:00');
  click('next');
}

const goodChecks = async () => [
  { id: 'tables_found', value: 4 }, { id: 'request_rows', value: 1234567 },
  { id: 'result_rows', value: 9 }, { id: 'patient_rows', value: 8 }, { id: 'ast_rows', value: 7 },
];

beforeEach(() => {
  resetLocale();
  document.body.removeAttribute('data-openldr-ready');
});

describe('source step', () => {
  it('says how to allow a connector when none is allowed', async () => {
    setup({ allowed: async () => [] });
    render(<App />);
    expect((await screen.findByTestId('source-none')).textContent).toMatch(/Plugin access/);
    expect(disabled('next')).toBe(true);
    await waitFor(() => expect(document.body.getAttribute('data-openldr-ready')).toBe('1'));
  });

  it('lets the user pick a connector and only then go on', async () => {
    setup();
    render(<App />);
    const row = await screen.findByTestId('connector-ms');
    expect(row.textContent).toContain('V1 SQL Server');
    expect(disabled('next')).toBe(true);
    fireEvent.click(row);
    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(disabled('next')).toBe(false);
  });

  it('runs the connection check and names the step that failed', async () => {
    const diagnose = vi.fn(async () => ({ ok: false, steps: [
      { id: 'dns', status: 'pass', detail: 'LABSRV resolved' },
      { id: 'tcp', status: 'fail', detail: 'no answer on port 1433' },
      { id: 'login', status: 'skip' },
    ] }));
    setup({ diagnose });
    render(<App />);
    fireEvent.click(await screen.findByTestId('connector-ms'));
    click('diag-run');
    expect((await screen.findByTestId('diag-summary')).textContent).toMatch(/failed at: Port/);
    expect(diagnose).toHaveBeenCalledWith('ms');
    expect(screen.getByTestId('diag-step-tcp').getAttribute('data-status')).toBe('fail');
    expect(screen.getByText('no answer on port 1433')).toBeTruthy();
  });
});

describe('options step', () => {
  it('blocks Next and says why when the time zone is wrong', async () => {
    setup();
    render(<App />);
    fireEvent.click(await screen.findByTestId('connector-ms'));
    click('next');
    type('opt-tz', 'CAT');
    expect(screen.getByTestId('problem-tz').textContent).toMatch(/\+02:00/);
    expect(disabled('next')).toBe(true);
    type('opt-tz', 'Z');
    expect(screen.queryByTestId('problem-tz')).toBeNull();
    expect(disabled('next')).toBe(false);
  });
});

describe('checks step', () => {
  it('runs the checks with the filled-in options and lets the user go on when four tables exist', async () => {
    const checks = vi.fn(goodChecks);
    setup({ checks });
    await toChecks();
    expect((await screen.findByTestId('check-tables_found')).textContent).toContain('4 of 4');
    expect(checks).toHaveBeenCalledWith({ connectorId: 'ms', options: { tz: '+02:00' } });
    expect(screen.getByTestId('check-request_rows').textContent).toContain('1,234,567');
    expect(disabled('next')).toBe(false);
  });

  it('blocks Next when a table is missing', async () => {
    setup({ checks: async () => [{ id: 'tables_found', value: 3 }, { id: 'request_rows', value: 1 }] });
    await toChecks();
    expect((await screen.findByTestId('checks-missing')).textContent).toMatch(/ASTResults/);
    expect(disabled('next')).toBe(true);
  });

  it('shows the error when the checks cannot run, and runs again on request', async () => {
    const checks = vi.fn().mockRejectedValueOnce(new Error('option tz is required')).mockImplementation(goodChecks);
    setup({ checks });
    await toChecks();
    expect((await screen.findByTestId('checks-error')).textContent).toContain('option tz is required');
    expect(disabled('next')).toBe(true);
    click('checks-again');
    expect(await screen.findByTestId('check-tables_found')).toBeTruthy();
    expect(checks).toHaveBeenCalledTimes(2);
  });
});

describe('dry run step', () => {
  it('starts a dry run with a limit, follows it to the end and lists failures in plain words', async () => {
    const start = vi.fn(async () => run({ id: 'd1', dryRun: true, limit: 50 }));
    const status = vi.fn(async () => run({ id: 'd1', dryRun: true, limit: 50, status: 'completed', counts: { keys: 50, imported: 48, failed: 2, resources: 700 } }));
    const failures = vi.fn(async () => [{ key: 'REQ-7', error: 'NO_OBR_SET_ID' }, { key: 'REQ-9', error: 'SOME_NEW_CODE' }]);
    setup({ checks: goodChecks, start, status, failures });
    await toChecks();
    await screen.findByTestId('check-tables_found');
    click('next');
    expect(disabled('next')).toBe(true);
    type('dry-limit', '50');
    click('dry-start');
    await waitFor(() => expect(screen.getByTestId('run-status').textContent).toMatch(/Finished/));
    expect(start).toHaveBeenCalledWith({ connectorId: 'ms', options: { tz: '+02:00' }, limit: 50, dryRun: true });
    expect(status).toHaveBeenCalledWith('d1');
    expect(screen.getByTestId('run-imported').textContent).toMatch(/would be saved/i);
    expect(screen.getByTestId('run-imported').textContent).toContain('48');
    const list = await screen.findByTestId('failures');
    expect(failures).toHaveBeenCalledWith('d1');
    expect(list.textContent).toContain('REQ-7');
    expect(list.textContent).toContain('A request row has no OBRSetID.');
    // A code this page has no words for is shown as it is.
    expect(list.textContent).toContain('SOME_NEW_CODE');
    expect(disabled('next')).toBe(false);
  });

  it('refuses a limit that is not a whole number from 1 to 5000', async () => {
    const start = vi.fn();
    setup({ checks: goodChecks, start });
    await toChecks();
    await screen.findByTestId('check-tables_found');
    click('next');
    type('dry-limit', '0');
    expect(screen.getByTestId('dry-limit-problem')).toBeTruthy();
    expect(disabled('dry-start')).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it('shows why a run could not start', async () => {
    setup({ checks: goodChecks, start: async () => { throw new Error('an import is already running'); } });
    await toChecks();
    await screen.findByTestId('check-tables_found');
    click('next');
    click('dry-start');
    expect((await screen.findByTestId('start-error')).textContent).toContain('an import is already running');
  });
});

describe('import step', () => {
  it('opens on a run that is still going, shows progress, and stops it on request', async () => {
    const live = run({ counts: { keys: 500, imported: 499, failed: 1, resources: 7000 } });
    let current = live;
    const stop = vi.fn(async () => (current = { ...live, status: 'stopping' }));
    const status = vi.fn(async () => current);
    setup({ list: async () => [live], status, stop, failures: async () => [{ key: 'REQ-1', error: 'SAVE_FAILED' }] });
    render(<App pollMs={5} />);
    expect((await screen.findByTestId('run-status')).textContent).toMatch(/Running/);
    expect(screen.getByTestId('step-4').getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('run-keys').textContent).toContain('500');
    expect(screen.getByTestId('run-imported').textContent).toMatch(/Requests saved/);
    click('run-stop');
    await waitFor(() => expect(screen.getByTestId('run-status').textContent).toMatch(/Stopping/));
    expect(stop).toHaveBeenCalledWith('r1');
  });

  it('offers Resume for a stopped run and carries on from it', async () => {
    const stopped = run({ status: 'stopped', counts: { keys: 300, imported: 300, failed: 0, resources: 4000 } });
    const resume = vi.fn(async () => ({ ...stopped, status: 'running' }));
    setup({ list: async () => [stopped], resume, status: async () => ({ ...stopped, status: 'running' }) });
    render(<App pollMs={5} />);
    click(await screen.findByTestId('run-resume').then(() => 'run-resume'));
    await waitFor(() => expect(screen.getByTestId('run-status').textContent).toMatch(/Running/));
    expect(resume).toHaveBeenCalledWith('r1');
    expect(screen.queryByTestId('run-resume')).toBeNull();
  });

  it('starts the real import with no limit after a finished dry run', async () => {
    const start = vi.fn(async (input: { dryRun?: boolean }) => run(input.dryRun ? { id: 'd1', dryRun: true, status: 'completed' } : { id: 'r9' }));
    setup({ checks: goodChecks, start: start as never, status: async () => run({ id: 'r9', status: 'completed', counts: { keys: 10, imported: 10, failed: 0, resources: 150 } }) });
    await toChecks();
    await screen.findByTestId('check-tables_found');
    click('next');
    click('dry-start');
    await waitFor(() => expect(disabled('next')).toBe(false));
    click('next');
    expect(screen.getByTestId('import-connector').textContent).toContain('V1 SQL Server');
    click('import-start');
    await waitFor(() => expect(screen.getByTestId('run-status').textContent).toMatch(/Finished/));
    expect(start).toHaveBeenLastCalledWith({ connectorId: 'ms', options: { tz: '+02:00' } });
    expect(screen.getByTestId('run-imported').textContent).toContain('10');
  });

  it('starts on the first step when the last real run finished', async () => {
    setup({ list: async () => [run({ status: 'completed' })] });
    render(<App />);
    expect(await screen.findByTestId('connector-ms')).toBeTruthy();
    expect(screen.getByTestId('step-0').getAttribute('aria-current')).toBe('step');
  });
});
