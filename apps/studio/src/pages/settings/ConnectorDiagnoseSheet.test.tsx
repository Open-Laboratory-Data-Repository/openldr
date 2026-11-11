import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, diagnoseConnector: vi.fn() };
});
import * as api from '@/api';
import { ConnectorDiagnoseSheet } from './ConnectorDiagnoseSheet';

const ms = {
  id: 'ms', name: 'DISA', pluginId: null, type: 'microsoft-sql',
  kind: 'database', allowedHost: null, enabled: true,
  createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConnectorDiagnoseSheet', () => {
  it('runs the diagnosis when it opens and shows every step', async () => {
    (api.diagnoseConnector as any).mockResolvedValue({ ok: true, steps: [
      { id: 'config', status: 'pass', detail: 'LABSRV:1433' },
      { id: 'dns', status: 'pass', detail: 'LABSRV resolved to 10.0.0.5' },
      { id: 'tcp', status: 'pass', detail: 'port 1433 is open' },
      { id: 'login', status: 'pass' },
      { id: 'version', status: 'pass', detail: 'Microsoft SQL Server 2012' },
    ] });
    render(<ConnectorDiagnoseSheet connector={ms as any} onOpenChange={() => {}} />);
    expect(await screen.findByTestId('diagnose-step-version')).toBeTruthy();
    expect(api.diagnoseConnector).toHaveBeenCalledWith('ms');
    expect(screen.getByText('Microsoft SQL Server 2012')).toBeTruthy();
    expect(screen.getByTestId('diagnose-summary').textContent).toMatch(/all checks passed/i);
  });

  it('shows the translated hint under a failed step', async () => {
    (api.diagnoseConnector as any).mockResolvedValue({ ok: false, steps: [
      { id: 'config', status: 'pass', detail: 'LABSRV:1433' },
      { id: 'dns', status: 'pass' },
      { id: 'tcp', status: 'fail', hint: 'tcpTimeout', detail: 'no answer on port 1433 within 5000 ms' },
      { id: 'login', status: 'skip' },
      { id: 'version', status: 'skip' },
    ] });
    render(<ConnectorDiagnoseSheet connector={ms as any} onOpenChange={() => {}} />);
    const hint = await screen.findByTestId('diagnose-hint-tcp');
    expect(hint.textContent).toMatch(/firewall/i);
    expect(screen.getByTestId('diagnose-step-tcp').getAttribute('data-status')).toBe('fail');
    expect(screen.getByTestId('diagnose-summary').textContent).toMatch(/failed/i);
  });

  it('runs again from the header menu', async () => {
    (api.diagnoseConnector as any).mockResolvedValue({ ok: true, steps: [{ id: 'login', status: 'pass' }] });
    render(<ConnectorDiagnoseSheet connector={ms as any} onOpenChange={() => {}} />);
    await screen.findByTestId('diagnose-step-login');
    const trigger = screen.getByTestId('diagnose-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
    await act(async () => { fireEvent.click(await screen.findByTestId('diagnose-run-again')); });
    expect(api.diagnoseConnector).toHaveBeenCalledTimes(2);
  });

  it('shows the request error when the diagnosis cannot run', async () => {
    (api.diagnoseConnector as any).mockRejectedValue(new Error('diagnose connector failed: 400'));
    render(<ConnectorDiagnoseSheet connector={ms as any} onOpenChange={() => {}} />);
    expect((await screen.findByTestId('diagnose-error')).textContent).toContain('400');
  });

  it('renders nothing when no connector is chosen', () => {
    render(<ConnectorDiagnoseSheet connector={null} onOpenChange={() => {}} />);
    expect(api.diagnoseConnector).not.toHaveBeenCalled();
  });
});
