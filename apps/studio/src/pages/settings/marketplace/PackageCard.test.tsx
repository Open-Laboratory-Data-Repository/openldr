import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { PackageCard } from './PackageCard';
import type { CardEntry } from './util';

const base: CardEntry = {
  ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin',
  publisher: { id: 'p', name: 'OpenLDR Reference' }, capabilities: [], valid: true,
};

describe('PackageCard', () => {
  it('renders id, version and a type badge, and fires onClick', () => {
    const onClick = vi.fn();
    render(<PackageCard entry={base} onClick={onClick} />);
    expect(screen.getByText('whonet-sqlite')).toBeTruthy();
    expect(screen.getByText(/1\.1\.0/)).toBeTruthy();
    expect(screen.getByText('plugin')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows an Active badge for an installed+active artifact', () => {
    render(<PackageCard entry={{ ...base, ref: undefined, installed: true, active: true }} onClick={() => {}} />);
    expect(screen.getByText(/Active/i)).toBeTruthy();
  });

  it('shows an Install affordance for a non-installed registry item', () => {
    render(<PackageCard entry={base} onClick={() => {}} />);
    expect(screen.getByText(/Install/i)).toBeTruthy();
  });

  it('shows a failed pack step and error, or Installed for a healthy pack', () => {
    const pack: CardEntry = { ...base, ref: undefined, type: 'content-pack', installed: true, active: true };
    const { rerender } = render(<PackageCard entry={{ ...pack, status: 'failed', failedStep: 2, error: 'boom' }} onClick={() => {}} />);
    expect(screen.getByTestId('card-pack-status').textContent).toBe('Failed at step 2: boom');
    rerender(<PackageCard entry={{ ...pack, status: 'failed', failedStep: null, error: 'boom' }} onClick={() => {}} />);
    expect(screen.getByTestId('card-pack-status').textContent).toBe('Failed: boom');
    rerender(<PackageCard entry={{ ...pack, status: 'installed' }} onClick={() => {}} />);
    expect(screen.getByTestId('card-pack-status').textContent).toBe('Installed');
  });
});
