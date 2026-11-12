import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { keepSessionFresh, localChangePassword, localLogin, localLogout, localRefresh, localSetup } from './local';
import { getAccessToken, setAccessToken } from './token';

const fetchMock = vi.fn();

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

const session = (accessToken: string) => ({ accessToken, expiresIn: 600, mustChangePassword: false });

describe('local sign-in calls', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('posts the login with same-origin credentials and returns the session', async () => {
    fetchMock.mockResolvedValue(reply(200, session('a')));
    expect(await localLogin('ada', 'correct horse')).toEqual(session('a'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'ada', password: 'correct horse' });
  });

  it('maps 401 to invalid and 429 to too_many', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { error: 'invalid_credentials' }));
    expect(await localLogin('ada', 'wrong')).toBe('invalid');
    fetchMock.mockResolvedValueOnce(reply(429, { error: 'too_many_attempts' }));
    expect(await localLogin('ada', 'wrong')).toBe('too_many');
  });

  it('throws on a server error so the page can say the server is unreachable', async () => {
    fetchMock.mockResolvedValue(reply(500, { error: 'boom' }));
    await expect(localLogin('ada', 'x')).rejects.toThrow();
  });

  it('refresh returns the session on 200 and null on 401', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, session('b')));
    expect(await localRefresh()).toEqual(session('b'));
    fetchMock.mockResolvedValueOnce(reply(401, { error: 'session_ended' }));
    expect(await localRefresh()).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/refresh');
    expect(init.credentials).toBe('same-origin');
  });

  it('refresh throws when the network is down, so a caller can tell it from a 401', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(localRefresh()).rejects.toThrow();
  });

  it('logout posts and never throws', async () => {
    fetchMock.mockResolvedValueOnce(reply(204));
    await localLogout();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/logout');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(localLogout()).resolves.toBeUndefined();
  });

  it('change password sends the bearer token and maps the answers', async () => {
    setAccessToken('tok');
    fetchMock.mockResolvedValueOnce(reply(204));
    expect(await localChangePassword('old-password', 'new-password')).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/change-password');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ currentPassword: 'old-password', newPassword: 'new-password' });
    for (const error of ['wrong_current', 'too_short', 'too_long', 'same_as_username'] as const) {
      fetchMock.mockResolvedValueOnce(reply(400, { error }));
      expect(await localChangePassword('a', 'b')).toBe(error);
    }
  });

  it('setup returns the session on 201 and maps every refusal', async () => {
    fetchMock.mockResolvedValueOnce(reply(201, session('c')));
    const input = { setupCode: 'CODE', username: 'admin', password: 'a long password' };
    expect(await localSetup(input)).toEqual(session('c'));
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/setup');
    fetchMock.mockResolvedValueOnce(reply(409, { error: 'already_set_up' }));
    expect(await localSetup(input)).toBe('already_set_up');
    fetchMock.mockResolvedValueOnce(reply(401, { error: 'bad_code' }));
    expect(await localSetup(input)).toBe('bad_code');
    fetchMock.mockResolvedValueOnce(reply(429, { error: 'too_many_attempts' }));
    expect(await localSetup(input)).toBe('too_many');
    for (const error of ['bad_username', 'username_taken', 'too_short', 'too_long', 'same_as_username'] as const) {
      fetchMock.mockResolvedValueOnce(reply(400, { error }));
      expect(await localSetup(input)).toBe(error);
    }
  });

  it('refreshes 60 seconds before expiry and stores the new token', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(reply(200, session('second')));
    const onEnded = vi.fn();
    const stop = keepSessionFresh(session('first'), onEnded);
    expect(getAccessToken()).toBe('first');
    await vi.advanceTimersByTimeAsync(539_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/refresh');
    expect(getAccessToken()).toBe('second');
    expect(onEnded).not.toHaveBeenCalled();
    stop();
  });

  it('calls onEnded when a refresh fails', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(reply(401, { error: 'session_ended' }));
    const onEnded = vi.fn();
    keepSessionFresh(session('first'), onEnded);
    await vi.advanceTimersByTimeAsync(540_000);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('retries once when the network is down before ending the session', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(reply(200, session('back')));
    const onEnded = vi.fn();
    const stop = keepSessionFresh(session('first'), onEnded);
    await vi.advanceTimersByTimeAsync(540_000);
    expect(onEnded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBe('back');
    expect(onEnded).not.toHaveBeenCalled();
    stop();
  });

  it('ends the session when the retry also fails', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const onEnded = vi.fn();
    keepSessionFresh(session('first'), onEnded);
    await vi.advanceTimersByTimeAsync(545_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('stop clears the timer so no refresh runs after sign-out', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(reply(200, session('second')));
    const onEnded = vi.fn();
    const stop = keepSessionFresh(session('first'), onEnded);
    stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('ignores a refresh that finishes after stop', async () => {
    vi.useFakeTimers();
    let answer: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { answer = resolve; }));
    const onEnded = vi.fn();
    const stop = keepSessionFresh(session('first'), onEnded);
    await vi.advanceTimersByTimeAsync(540_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
    setAccessToken(null);
    answer(reply(200, session('late')));
    await vi.advanceTimersByTimeAsync(0);
    expect(getAccessToken()).toBeNull();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('never writes the token or password to web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    fetchMock.mockImplementation(async () => reply(200, session('secret-token')));
    await localLogin('ada', 'secret-password');
    await localRefresh();
    keepSessionFresh(session('secret-token'), vi.fn())();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
