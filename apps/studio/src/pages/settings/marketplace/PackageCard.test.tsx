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

  it('says Update to the newer version for an installed plugin that has one', () => {
    render(<PackageCard entry={{ ...base, ref: undefined, installed: true, active: true, update: { version: '1.2.0', ref: 'r', rolledBack: false } }} onClick={() => {}} />);
    expect(screen.getByText('Update to 1.2.0')).toBeTruthy();
    expect(screen.queryByText(/^Active$/)).toBeNull();
  });

  it('after a rollback, says the newer version is available, quietly', () => {
    render(<PackageCard entry={{ ...base, ref: undefined, installed: true, active: true, update: { version: '1.2.0', ref: 'r', rolledBack: true } }} onClick={() => {}} />);
    expect(screen.getByText('1.2.0 available')).toBeTruthy();
    expect(screen.queryByText(/Update to/)).toBeNull();
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

  it('shows no Active badge on a failed pack, and keeps it on a healthy one', () => {
    const pack: CardEntry = { ...base, ref: undefined, type: 'content-pack', installed: true, active: true };
    const { rerender } = render(<PackageCard entry={{ ...pack, status: 'failed', failedStep: 2, error: 'boom' }} onClick={() => {}} />);
    expect(screen.queryByText('Active')).toBeNull();
    rerender(<PackageCard entry={{ ...pack, status: 'installed' }} onClick={() => {}} />);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('says which CE a bundle needs, not Install, when this CE cannot run it', () => {
    render(<PackageCard entry={{ ...base, needsCe: '>=0.1.13' }} onClick={() => {}} />);
    expect(screen.getByText('Needs CE >=0.1.13')).toBeTruthy();
    expect(screen.queryByText('Install')).toBeNull();
  });

  it('says a public bundle is not checked yet, not that it is unverified', () => {
    render(<PackageCard entry={{ ...base, valid: undefined }} onClick={() => {}} />);
    expect(screen.getByText('Signature not checked yet')).toBeTruthy();
  });
});
