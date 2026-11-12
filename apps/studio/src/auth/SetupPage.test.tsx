import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';
import { SetupPage } from './SetupPage';

vi.mock('./local', () => ({ localSetup: vi.fn() }));

import { localSetup } from './local';

const setup = vi.mocked(localSetup);

function fill(code: string, username: string, password: string, repeat: string) {
  fireEvent.change(screen.getByLabelText('Setup code'), { target: { value: code } });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: repeat } });
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create the administrator' }));

describe('SetupPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends nothing when the two passwords differ', async () => {
    render(<SetupPage onSignedIn={vi.fn()} onSignInInstead={vi.fn()} />);
    fill('ABCD-1234', 'admin', 'correct horse battery', 'correct horse batterz');
    submit();
    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(setup).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Repeat password')).toHaveValue('');
    expect(screen.getByLabelText('Username')).toHaveValue('admin');
  });

  it.each([
    ['bad_code', 'That setup code is wrong or has expired.'],
    ['already_set_up', 'An administrator already exists. Sign in instead.'],
    ['too_short', 'Use at least 10 characters.'],
    ['too_long', 'Use 128 characters or fewer.'],
    ['same_as_username', 'The password cannot be the username.'],
    ['bad_username', 'Use 3 to 64 letters, digits, dots, dashes or underscores.'],
    ['username_taken', 'That username is already in use.'],
    ['too_many', 'Too many attempts. Wait a minute and try again.'],
  ] as const)('shows the server failure %s in words and clears the passwords', async (code, text) => {
    setup.mockResolvedValue(code);
    const onSignedIn = vi.fn();
    render(<SetupPage onSignedIn={onSignedIn} onSignInInstead={vi.fn()} />);
    fill('ABCD-1234', 'admin', 'correct horse battery', 'correct horse battery');
    submit();
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Repeat password')).toHaveValue('');
    expect(screen.getByLabelText('Setup code')).toHaveValue('ABCD-1234');
    expect(screen.getByRole('button', { name: 'Create the administrator' })).toBeEnabled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('offers the sign-in page once the server says an administrator exists', async () => {
    setup.mockResolvedValue('already_set_up');
    const onSignInInstead = vi.fn();
    render(<SetupPage onSignedIn={vi.fn()} onSignInInstead={onSignInInstead} />);
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    fill('ABCD-1234', 'admin', 'correct horse battery', 'correct horse battery');
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(onSignInInstead).toHaveBeenCalledTimes(1);
  });

  it('asks the person to try again when the request throws', async () => {
    setup.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SetupPage onSignedIn={vi.fn()} onSignInInstead={vi.fn()} />);
    fill('ABCD-1234', 'admin', 'correct horse battery', 'correct horse battery');
    submit();
    expect(await screen.findByText('Could not reach the server. Try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('signs the admin in on success', async () => {
    const session = { accessToken: 't', expiresIn: 600, mustChangePassword: false };
    setup.mockResolvedValue(session);
    const onSignedIn = vi.fn();
    render(<SetupPage onSignedIn={onSignedIn} onSignInInstead={vi.fn()} />);
    fill(' ABCD-1234 ', 'admin', 'correct horse battery', 'correct horse battery');
    submit();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(session));
    expect(setup).toHaveBeenCalledWith({ setupCode: 'ABCD-1234', username: 'admin', password: 'correct horse battery' });
    // The passwords leave state as soon as the request returns.
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('sends nothing when a field is empty', async () => {
    render(<SetupPage onSignedIn={vi.fn()} onSignInInstead={vi.fn()} />);
    fill('', 'admin', 'correct horse battery', 'correct horse battery');
    submit();
    await Promise.resolve();
    expect(setup).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks both password fields as new passwords', () => {
    render(<SetupPage onSignedIn={vi.fn()} onSignInInstead={vi.fn()} />);
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Repeat password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByText('Run "openldr auth setup-code" on the server to get one.')).toBeInTheDocument();
  });

  it('fills the dynamic viewport height, never h-screen', () => {
    const { container } = render(<SetupPage onSignedIn={vi.fn()} onSignInInstead={vi.fn()} />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveClass('h-dvh');
    expect(outer).not.toHaveClass('h-screen');
  });
});
