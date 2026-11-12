import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';
import { LoginPage } from './LoginPage';

vi.mock('./local', () => ({ localLogin: vi.fn() }));

import { localLogin } from './local';

const login = vi.mocked(localLogin);

function fill(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('LoginPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signs in and calls onSignedIn with the session', async () => {
    const session = { accessToken: 't', expiresIn: 600, mustChangePassword: false };
    login.mockResolvedValue(session);
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);
    fill('ada', 'correct horse');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(session));
    expect(login).toHaveBeenCalledWith('ada', 'correct horse');
  });

  it('submits when Enter is pressed in the password field', async () => {
    login.mockResolvedValue({ accessToken: 't', expiresIn: 600, mustChangePassword: false });
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);
    fill('ada', 'correct horse');
    fireEvent.submit(screen.getByLabelText('Password'));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  });

  it('shows the invalid message and keeps the username', async () => {
    login.mockResolvedValue('invalid');
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);
    fill('ada', 'wrong password');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Those details are wrong, or the account is locked for a few minutes.')).toBeInTheDocument();
    expect(screen.getByLabelText('Username or email')).toHaveValue('ada');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('shows the too-many message on 429', async () => {
    login.mockResolvedValue('too_many');
    render(<LoginPage onSignedIn={vi.fn()} />);
    fill('ada', 'wrong password');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Too many attempts. Wait a minute and try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('says the server cannot be reached when the request throws', async () => {
    login.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<LoginPage onSignedIn={vi.fn()} />);
    fill('ada', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Cannot reach the server. Please reload.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('disables the button while the request runs', async () => {
    let finish: (v: 'invalid') => void = () => {};
    login.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<LoginPage onSignedIn={vi.fn()} />);
    fill('ada', 'pw');
    const button = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(login).toHaveBeenCalledTimes(1);
    finish('invalid');
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('sets the autocomplete hints for password managers', () => {
    render(<LoginPage onSignedIn={vi.fn()} />);
    expect(screen.getByLabelText('Username or email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('fills the dynamic viewport height, never h-screen', () => {
    const { container } = render(<LoginPage onSignedIn={vi.fn()} />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveClass('h-dvh');
    expect(outer).not.toHaveClass('h-screen');
  });
});
