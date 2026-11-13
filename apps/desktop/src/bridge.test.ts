import { describe, expect, it, vi } from 'vitest';
import { bridgeHandlers, INFO_CHANNEL, SETUP_CODE_CHANNEL, type BridgeDeps } from './bridge';

const ADDRESS = 'http://127.0.0.1:3990/studio/';

/** No default for `address`: a test of an undefined address must not get ADDRESS back. */
function deps(address: string | undefined, code: () => Promise<string> = () => Promise.resolve('ABCD-EFGH-JK23')) {
  const d = {
    address: vi.fn(() => address),
    requestSetupCode: vi.fn(code),
    info: vi.fn(() => ({ version: '0.1.11', platform: 'linux' })),
  } satisfies BridgeDeps;
  return d;
}

const refused: Array<[string, string, string | undefined]> = [
  ['another port', 'http://127.0.0.1:3991/studio/', ADDRESS],
  ['localhost when the address says 127.0.0.1', 'http://localhost:3990/studio/', ADDRESS],
  ['a launcher address on localhost, even from its own origin', 'http://localhost:3990/studio/', 'http://localhost:3990/studio/'],
  ['another site', 'https://example.com/', ADDRESS],
  ['a file: page', 'file:///opt/openldr/pages/page.html', ADDRESS],
  ['an empty sender', '', ADDRESS],
  ['no launcher address', ADDRESS, undefined],
  ['a launcher open to the network', 'http://192.168.1.5:3990/studio/', 'http://192.168.1.5:3990/studio/'],
];

describe('bridgeHandlers: setup code', () => {
  it('answers a page on the launcher address', async () => {
    const d = deps(ADDRESS);
    await expect(bridgeHandlers(d)[SETUP_CODE_CHANNEL]!(ADDRESS)).resolves.toBe('ABCD-EFGH-JK23');
    expect(d.requestSetupCode).toHaveBeenCalledTimes(1);
  });

  it.each(refused)('refuses %s and runs nothing', async (_name, sender, address) => {
    const d = deps(address);
    await expect(bridgeHandlers(d)[SETUP_CODE_CHANNEL]!(sender)).rejects.toThrow(new Error('not allowed'));
    expect(d.requestSetupCode).not.toHaveBeenCalled();
  });

  it('gives one fixed message when the launcher gives no code', async () => {
    const d = deps(ADDRESS, () => Promise.reject(new Error('The launcher gave no setup code (exit code 1).')));
    const err = await bridgeHandlers(d)[SETUP_CODE_CHANNEL]!(ADDRESS).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('The setup code could not be made.');
  });
});

describe('bridgeHandlers: info', () => {
  it('answers a page on the launcher address', async () => {
    const d = deps(ADDRESS);
    await expect(bridgeHandlers(d)[INFO_CHANNEL]!(ADDRESS)).resolves.toEqual({ version: '0.1.11', platform: 'linux' });
  });

  it.each(refused)('refuses %s', async (_name, sender, address) => {
    const d = deps(address);
    await expect(bridgeHandlers(d)[INFO_CHANNEL]!(sender)).rejects.toThrow(new Error('not allowed'));
    expect(d.info).not.toHaveBeenCalled();
  });
});
