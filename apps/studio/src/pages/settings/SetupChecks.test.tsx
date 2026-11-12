import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, runSetupChecks: vi.fn() };
});
import * as api from '@/api';
import { SetupChecks } from './SetupChecks';

// Layer proven here: the page, with the API mocked. The route and the checks have their own tests.

const report = { ok: false, checks: [
  { id: 'adapters', status: 'pass' },
  { id: 'labName', status: 'warn', hint: 'labNameDefault', fix: '/settings/laboratory' },
  { id: 'connectors', status: 'fail', hint: 'connectorFailed', fix: '/settings/connectors', detail: 'V1 SQL Server' },
  { id: 'sync', status: 'skip' },
] };

const page = () => render(<MemoryRouter><SetupChecks /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SetupChecks', () => {
  it('runs the checks when it opens and shows each one with its status', async () => {
    (api.runSetupChecks as any).mockResolvedValue(report);
    page();
    expect((await screen.findByTestId('setup-check-connectors')).getAttribute('data-status')).toBe('fail');
    expect(api.runSetupChecks).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('setup-check-adapters').getAttribute('data-status')).toBe('pass');
    expect(screen.getByText('V1 SQL Server')).toBeTruthy();
    expect(screen.getByTestId('setup-summary').textContent).toMatch(/1 failed, 1 warning/);
  });

  it('names the Facilities page on the facilities check link, not Settings', async () => {
    (api.runSetupChecks as any).mockResolvedValue({ ok: true, checks: [{ id: 'facilities', status: 'warn', hint: 'facilitiesUnmatched', fix: '/facilities', detail: '2 of 2' }] });
    page();
    const link = await screen.findByTestId('setup-fix-facilities');
    expect(link.getAttribute('href')).toBe('/facilities');
    expect(link.textContent).toBe('Open Facilities');
  });

  it('shows the advice and a link to the page that fixes it', async () => {
    (api.runSetupChecks as any).mockResolvedValue(report);
    page();
    expect((await screen.findByTestId('setup-hint-labName')).textContent).toMatch(/issuing laboratory/i);
    const link = screen.getByTestId('setup-fix-labName');
    expect(link.getAttribute('href')).toBe('/settings/laboratory');
    expect(link.textContent).toMatch(/Laboratory/);
    expect(screen.getByTestId('setup-fix-connectors').getAttribute('href')).toBe('/settings/connectors');
    // A passed check has neither.
    expect(screen.queryByTestId('setup-hint-adapters')).toBeNull();
    expect(screen.queryByTestId('setup-fix-adapters')).toBeNull();
  });

  it('tells the reader to run the setup code command while no administrator exists, with no link', async () => {
    (api.runSetupChecks as any).mockResolvedValue({ ok: true, checks: [{ id: 'signIn', status: 'warn', hint: 'signInSetup' }] });
    page();
    expect((await screen.findByTestId('setup-hint-signIn')).textContent)
      .toBe('No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.');
    expect(screen.queryByTestId('setup-fix-signIn')).toBeNull();
  });

  it('says so when every check passed', async () => {
    (api.runSetupChecks as any).mockResolvedValue({ ok: true, checks: [{ id: 'adapters', status: 'pass' }] });
    page();
    expect((await screen.findByTestId('setup-summary')).textContent).toMatch(/all checks passed/i);
  });

  it('runs again from the page menu', async () => {
    (api.runSetupChecks as any).mockResolvedValue(report);
    page();
    await screen.findByTestId('setup-check-adapters');
    const trigger = screen.getByTestId('setup-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
    await act(async () => { fireEvent.click(await screen.findByTestId('setup-run-again')); });
    expect(api.runSetupChecks).toHaveBeenCalledTimes(2);
  });

  it('shows the request error when the checks cannot run', async () => {
    (api.runSetupChecks as any).mockRejectedValue(new Error('run setup checks failed: 500'));
    page();
    expect((await screen.findByTestId('setup-error')).textContent).toContain('500');
  });

  it('has a title for every check and text for every hint, in every language', () => {
    for (const lng of ['en', 'fr', 'pt']) {
      for (const id of api.SETUP_CHECK_IDS) expect(i18n.exists(`settings.setup.check.${id}`, { lng }), `${lng} ${id}`).toBe(true);
      for (const hint of api.SETUP_HINTS) expect(i18n.exists(`settings.setup.hint.${hint}`, { lng }), `${lng} ${hint}`).toBe(true);
    }
  });
});
