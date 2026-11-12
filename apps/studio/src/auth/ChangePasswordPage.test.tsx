import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';
import { ChangePasswordPage } from './ChangePasswordPage';

vi.mock('./local', () => ({ localChangePassword: vi.fn(), localRefresh: vi.fn() }));

import { localChangePassword, localRefresh } from './local';

const change = vi.mocked(localChangePassword);
const refresh = vi.mocked(localRefresh);

function fill(current: string, next: string, repeat: string) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: repeat } });
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

function renderPage() {
  const props = { onChanged: vi.fn(), onSessionEnded: vi.fn(), onSignOut: vi.fn() };
  render(<ChangePasswordPage {...props} />);
  return props;
}

function expectPasswordsCleared() {
  expect(screen.getByLabelText('Current password')).toHaveValue('');
  expect(screen.getByLabelText('New password')).toHaveValue('');
  expect(screen.getByLabelText('Repeat password')).toHaveValue('');
}

describe('ChangePasswordPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the app after a successful change, from a fresh refresh', async () => {
    const fresh = { accessToken: 'fresh', expiresIn: 600, mustChangePassword: false };
    change.mockResolvedValue('ok');
    refresh.mockResolvedValue(fresh);
    const props = renderPage();
    fill('temporary pass', 'a much better one', 'a much better one');
    submit();
    await waitFor(() => expect(props.onChanged).toHaveBeenCalledWith(fresh));
    expect(change).toHaveBeenCalledWith('temporary pass', 'a much better one');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(props.onSessionEnded).not.toHaveBeenCalled();
    expectPasswordsCleared();
  });

  it('shows the sign-in page when the refresh after the change finds no session', async () => {
    change.mockResolvedValue('ok');
    refresh.mockResolvedValue(null);
    const props = renderPage();
    fill('temporary pass', 'a much better one', 'a much better one');
    submit();
    await waitFor(() => expect(props.onSessionEnded).toHaveBeenCalledTimes(1));
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it('shows the sign-in page when the refresh after the change cannot reach the server', async () => {
    // The password has changed by now, so sending the form again would fail on the old current
    // password. Signing in with the new one is the way back.
    change.mockResolvedValue('ok');
    refresh.mockRejectedValue(new TypeError('Failed to fetch'));
    const props = renderPage();
    fill('temporary pass', 'a much better one', 'a much better one');
    submit();
    await waitFor(() => expect(props.onSessionEnded).toHaveBeenCalledTimes(1));
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it('shows the sign-in page when the server says the session ended', async () => {
    change.mockResolvedValue('session_ended');
    const props = renderPage();
    fill('temporary pass', 'a much better one', 'a much better one');
    submit();
    await waitFor(() => expect(props.onSessionEnded).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it('shows wrong_current and clears every password field', async () => {
    change.mockResolvedValue('wrong_current');
    const props = renderPage();
    fill('not it', 'a much better one', 'a much better one');
    submit();
    expect(await screen.findByText('The current password is wrong.')).toBeInTheDocument();
    expectPasswordsCleared();
    expect(refresh).not.toHaveBeenCalled();
    expect(props.onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled();
  });

  it.each([
    ['too_short', 'Use at least 10 characters.'],
    ['too_long', 'Use 128 characters or fewer.'],
    ['same_as_username', 'The password cannot be the username.'],
  ] as const)('shows %s in words', async (code, text) => {
    change.mockResolvedValue(code);
    renderPage();
    fill('temporary pass', 'short', 'short');
    submit();
    expect(await screen.findByText(text)).toBeInTheDocument();
    expectPasswordsCleared();
  });

  it('sends nothing when the two new passwords differ', async () => {
    renderPage();
    fill('temporary pass', 'a much better one', 'a much better two');
    submit();
    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    expectPasswordsCleared();
  });

  it('asks the person to try again when the request throws', async () => {
    change.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    fill('temporary pass', 'a much better one', 'a much better one');
    submit();
    expect(await screen.findByText('Could not reach the server. Try again.')).toBeInTheDocument();
    expectPasswordsCleared();
  });

  it('offers a sign-out link', () => {
    const props = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('sets the autocomplete hints for password managers', () => {
    renderPage();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Repeat password')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('fills the dynamic viewport height, never h-screen', () => {
    const { container } = render(<ChangePasswordPage onChanged={vi.fn()} onSessionEnded={vi.fn()} onSignOut={vi.fn()} />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveClass('h-dvh');
    expect(outer).not.toHaveClass('h-screen');
  });
});
