import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('SetupPage in the desktop app', () => {
  const FIRST = 'ABCD-EFGH-JK23';
  const SECOND = 'WXYZ-2345-MN67';
  const FROM_APP = 'Filled in by the OpenLDR app.';
  const TYPED_HINT = 'Run "openldr auth setup-code" on the server to get one.';
  const session = { accessToken: 't', expiresIn: 600, mustChangePassword: false };

  function stub(setupCode: () => Promise<string>) {
    const app = {
      setupCode: vi.fn(setupCode),
      info: vi.fn(() => Promise.resolve({ version: '0.1.11', platform: 'linux' })),
    };
    window.openldrDesktop = app;
    return app;
  }

  function fillPerson() {
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: 'correct horse battery' } });
  }

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    delete window.openldrDesktop;
    vi.useRealTimers();
  });

  it('fills the field from the app and locks it', async () => {
    stub(() => Promise.resolve(FIRST));
    render(<SetupPage onSignedIn={vi.fn()} onSignInInstead={vi.fn()} />);
    const field = screen.getByLabelText('Setup code');
    await waitFor(() => expect(field).toHaveAttribute('readonly'));
    expect(field).toHaveAttribute('type', 'password');
    expect((field as HTMLInputElement).value).toHaveLength(FIRST.length);
    expect(field).toBeEnabled();
    expect(screen.getByText(FROM_APP)).toBeInTheDocument();
    expect(screen.queryByText(TYPED_HINT)).toBeNull();
  });

  it('disables the field while it waits for the app', () => {
    stub(() => new Promise<string>(() => {}));
    render(<SetupPage onSignedIn={vi.fn()} onSignInInstead={vi.fn()} />);
    expect(screen.getByLabelText('Setup code')).toBeDisabled();
  });

  it("sends the app's code", async () => {
    stub(() => Promise.resolve(FIRST));
    setup.mockResolvedValue(session);
    const onSignedIn = vi.fn();
    render(<SetupPage onSignedIn={onSignedIn} onSignInInstead={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Setup code')).toHaveAttribute('readonly'));
    fillPerson();
    submit();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(session));
    expect(setup).toHaveBeenCalledWith({ setupCode: FIRST, username: 'admin', password: 'correct horse battery' });
  });

  it('leaves the field empty and editable when the app fails', async () => {
    const app = stub(() => Promise.reject(new Error('The setup code could not be made.')));
    render(<SetupPage onSignedIn={vi.fn()} onSignInInstead={vi.fn()} />);
    const field = screen.getByLabelText('Setup code');
    await waitFor(() => expect(field).toBeEnabled());
    expect(app.setupCode).toHaveBeenCalledTimes(1);
    expect(field).toHaveValue('');
    expect(field).not.toHaveAttribute('readonly');
    expect(field).not.toHaveAttribute('type', 'password');
    expect(screen.getByText(TYPED_HINT)).toBeInTheDocument();
  });

  it('gives up on the app after 30 seconds', async () => {
    vi.useFakeTimers();
    let answer: (code: string) => void = () => {};
    stub(() => new Promise<string>((resolve) => { answer = resolve; }));
    render(<SetupPage onSignedIn={vi.fn()} onSignInInstead={vi.fn()} />);
    const field = screen.getByLabelText('Setup code');
    await act(async () => { vi.advanceTimersByTime(29_999); });
    expect(field).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(field).toBeEnabled();
    expect(field).toHaveValue('');
    expect(field).not.toHaveAttribute('readonly');
    expect(screen.getByText(TYPED_HINT)).toBeInTheDocument();
    // An answer after the limit is ignored.
    await act(async () => { answer(FIRST); });
    expect(field).toHaveValue('');
    expect(field).not.toHaveAttribute('readonly');
  });

  it('asks for a fresh code after bad_code', async () => {
    let calls = 0;
    const app = stub(() => Promise.resolve(++calls === 1 ? FIRST : SECOND));
    setup.mockResolvedValueOnce('bad_code').mockResolvedValueOnce(session);
    const onSignedIn = vi.fn();
    render(<SetupPage onSignedIn={onSignedIn} onSignInInstead={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Setup code')).toHaveAttribute('readonly'));
    fillPerson();
    submit();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(session));
    expect(app.setupCode).toHaveBeenCalledTimes(2);
    expect(setup).toHaveBeenCalledTimes(2);
    expect(setup).toHaveBeenNthCalledWith(1, { setupCode: FIRST, username: 'admin', password: 'correct horse battery' });
    expect(setup).toHaveBeenNthCalledWith(2, { setupCode: SECOND, username: 'admin', password: 'correct horse battery' });
  });

  it('shows the usual error after two bad_code answers', async () => {
    let calls = 0;
    stub(() => Promise.resolve(++calls === 1 ? FIRST : SECOND));
    setup.mockResolvedValue('bad_code');
    const onSignedIn = vi.fn();
    render(<SetupPage onSignedIn={onSignedIn} onSignInInstead={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Setup code')).toHaveAttribute('readonly'));
    fillPerson();
    submit();
    expect(await screen.findByText('That setup code is wrong or has expired.')).toBeInTheDocument();
    expect(setup).toHaveBeenCalledTimes(2);
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});
