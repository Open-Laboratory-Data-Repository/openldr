import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RejectSheet } from './RejectSheet';

const reasons = [
  { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' },
  { system: 'urn:openldr:cs:reject-test', code: 'QNS', display: 'Insufficient volume' },
];

describe('RejectSheet', () => {
  it('offers the reasons it was given, and names no value set of its own', async () => {
    render(<RejectSheet level="test" reasons={reasons} onReject={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('Haemolysed')).toBeInTheDocument();
    expect(screen.getByText('Insufficient volume')).toBeInTheDocument();
  });

  it('hands back the chosen reason as a coding', async () => {
    const onReject = vi.fn();
    const user = userEvent.setup();
    render(<RejectSheet level="test" reasons={reasons} onReject={onReject} onClose={() => {}} />);
    await user.click(await screen.findByText('Haemolysed'));
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(onReject).toHaveBeenCalledWith({ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' });
  });

  it('refuses to reject with no reason chosen', async () => {
    const onReject = vi.fn();
    const user = userEvent.setup();
    render(<RejectSheet level="test" reasons={reasons} onReject={onReject} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(onReject).not.toHaveBeenCalled();
    expect(screen.getByText(/choose a reason/i)).toBeInTheDocument();
  });

  it('clears the message as soon as a reason is chosen', async () => {
    const user = userEvent.setup();
    render(<RejectSheet level="test" reasons={reasons} onReject={() => {}} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    await user.click(screen.getByText('Haemolysed'));
    expect(screen.queryByText(/choose a reason/i)).toBeNull();
  });

  it('shows an empty state when the server offered no reasons', () => {
    render(<RejectSheet level="order" reasons={[]} onReject={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/no reasons/i)).toBeInTheDocument();
  });
});
