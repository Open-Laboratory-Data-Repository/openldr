import { describe, expect, it, vi } from 'vitest';
import { STRINGS } from './strings';
import { trayTemplate, type TrayActions, type TrayState } from './tray-menu';

const s = STRINGS.en;
const share = { addresses: ['https://labpc:3443/studio/', 'https://192.168.1.20:3443/studio/'], fingerprint: 'AB:CD', certFile: '/d/share/cert.pem' };

function actions(): TrayActions {
  return {
    open: vi.fn(),
    setStartAtSignIn: vi.fn(),
    setShare: vi.fn(),
    copy: vi.fn(),
    saveCertificate: vi.fn(),
    openLogs: vi.fn(),
    quit: vi.fn(),
    changeServer: vi.fn(),
    switchMode: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
  };
}

const state = (over: Partial<TrayState> = {}): TrayState => ({ startAtSignIn: false, shareOnNetwork: false, share: undefined, busy: false, ...over });
const labels = (st: TrayState) => trayTemplate(st, s, actions()).map((i) => (i.type === 'separator' ? '---' : i.label));
const item = (st: TrayState, act: TrayActions, label: string) => {
  const found = trayTemplate(st, s, act).find((i) => i.label === label);
  if (!found) throw new Error(`no item ${label}`);
  return found;
};
/** Runs an item's click the way Electron does, with the item itself as the first argument. */
const click = (i: Electron.MenuItemConstructorOptions, checked = false): void => {
  (i.click as (item: { checked: boolean }) => void)({ checked });
};

describe('trayTemplate', () => {
  it('when locked, shows only Open, Unlock and Quit', () => {
    const three = [s.trayOpen, s.trayUnlock, '---', s.trayQuit];
    expect(labels(state({ locked: true, shareOnNetwork: true, share, startAtSignIn: true }))).toEqual(three);
    expect(labels(state({ locked: true, mode: 'connect', server: 'https://labpc:3443/studio/' }))).toEqual(three);
    const act = actions();
    click(item(state({ locked: true }), act, s.trayUnlock));
    expect(act.unlock).toHaveBeenCalledTimes(1);
    click(item(state({ locked: true }), act, s.trayQuit));
    expect(act.quit).toHaveBeenCalledTimes(1);
  });

  it('when not locked, offers Lock this PC to OpenLDR...', () => {
    expect(labels(state())).toContain(s.trayLock);
    expect(labels(state({ mode: 'connect' }))).toContain(s.trayLock);
    expect(labels(state())).not.toContain(s.trayUnlock);
    const act = actions();
    click(item(state(), act, s.trayLock));
    expect(act.lock).toHaveBeenCalledTimes(1);
  });

  it('shows the usual items and the share box when not sharing', () => {
    expect(labels(state())).toEqual([s.trayOpen, s.trayStartAtSignIn, s.trayShare, s.trayUseConnect, s.trayLock, s.trayOpenLogs, '---', s.trayQuit]);
  });

  it('shows the address and the three share items only when sharing is running', () => {
    expect(labels(state({ shareOnNetwork: true, share }))).toEqual([
      s.trayOpen,
      s.trayStartAtSignIn,
      s.trayShare,
      'https://labpc:3443/studio/',
      s.trayCopyAddress,
      s.trayCopyFingerprint,
      s.traySaveCertificate,
      s.trayUseConnect,
      s.trayLock,
      s.trayOpenLogs,
      '---',
      s.trayQuit,
    ]);
  });

  it('shows the setting ticked and nothing else while sharing has not started yet', () => {
    const st = state({ shareOnNetwork: true });
    expect(labels(st)).toEqual([s.trayOpen, s.trayStartAtSignIn, s.trayShare, s.trayUseConnect, s.trayLock, s.trayOpenLogs, '---', s.trayQuit]);
    expect(item(st, actions(), s.trayShare)).toMatchObject({ type: 'checkbox', checked: true });
  });

  it('with no network address, shows the no-address line and no copy address item', () => {
    expect(labels(state({ shareOnNetwork: true, share: { ...share, addresses: [] } }))).toEqual([
      s.trayOpen,
      s.trayStartAtSignIn,
      s.trayShare,
      s.trayNoAddress,
      s.trayCopyFingerprint,
      s.traySaveCertificate,
      s.trayUseConnect,
      s.trayLock,
      s.trayOpenLogs,
      '---',
      s.trayQuit,
    ]);
  });

  it('shows the address and the no-address line as labels that cannot be pressed', () => {
    expect(item(state({ shareOnNetwork: true, share }), actions(), share.addresses[0]!)).toMatchObject({ enabled: false });
    expect(item(state({ shareOnNetwork: true, share: { ...share, addresses: [] } }), actions(), s.trayNoAddress)).toMatchObject({ enabled: false });
  });

  it('ticks the two boxes from the state', () => {
    const st = state({ startAtSignIn: true, shareOnNetwork: false });
    expect(item(st, actions(), s.trayStartAtSignIn)).toMatchObject({ type: 'checkbox', checked: true });
    expect(item(st, actions(), s.trayShare)).toMatchObject({ type: 'checkbox', checked: false });
  });

  it('turns the share box off while a restart runs', () => {
    expect(item(state({ busy: true }), actions(), s.trayShare)).toMatchObject({ enabled: false });
    expect(item(state(), actions(), s.trayShare).enabled).not.toBe(false);
  });

  it('passes what the person ticked to the actions', () => {
    const act = actions();
    click(item(state(), act, s.trayShare), true);
    expect(act.setShare).toHaveBeenCalledWith(true);
    click(item(state({ shareOnNetwork: true }), act, s.trayShare), false);
    expect(act.setShare).toHaveBeenLastCalledWith(false);
    click(item(state(), act, s.trayStartAtSignIn), true);
    expect(act.setStartAtSignIn).toHaveBeenCalledWith(true);
  });

  it('copies the first address and the fingerprint, and saves the certificate', () => {
    const act = actions();
    const st = state({ shareOnNetwork: true, share });
    click(item(st, act, s.trayCopyAddress));
    expect(act.copy).toHaveBeenLastCalledWith('https://labpc:3443/studio/');
    click(item(st, act, s.trayCopyFingerprint));
    expect(act.copy).toHaveBeenLastCalledWith('AB:CD');
    click(item(st, act, s.traySaveCertificate));
    expect(act.saveCertificate).toHaveBeenCalledWith('/d/share/cert.pem');
  });

  it('opens, opens the logs and quits', () => {
    const act = actions();
    click(item(state(), act, s.trayOpen));
    click(item(state(), act, s.trayOpenLogs));
    click(item(state(), act, s.trayQuit));
    expect(act.open).toHaveBeenCalledTimes(1);
    expect(act.openLogs).toHaveBeenCalledTimes(1);
    expect(act.quit).toHaveBeenCalledTimes(1);
  });
});

describe('trayTemplate in connect mode', () => {
  const SERVER = 'https://labpc:3443/studio/';

  it('in connect mode shows the server and no share items', () => {
    expect(labels(state({ mode: 'connect', server: SERVER, shareOnNetwork: true, share }))).toEqual([
      s.trayOpen, s.trayStartAtSignIn, SERVER, s.trayChangeServer, s.trayUseLocal, s.trayLock, s.trayOpenLogs, '---', s.trayQuit,
    ]);
  });

  it('shows the server as a line that cannot be pressed, and leaves it out when there is none yet', () => {
    expect(item(state({ mode: 'connect', server: SERVER }), actions(), SERVER).enabled).toBe(false);
    expect(labels(state({ mode: 'connect' }))).toEqual([s.trayOpen, s.trayStartAtSignIn, s.trayChangeServer, s.trayUseLocal, s.trayLock, s.trayOpenLogs, '---', s.trayQuit]);
  });

  it('Change server and Use this PC call their actions', () => {
    const act = actions();
    click(item(state({ mode: 'connect', server: SERVER }), act, s.trayChangeServer));
    expect(act.changeServer).toHaveBeenCalledTimes(1);
    click(item(state({ mode: 'connect', server: SERVER }), act, s.trayUseLocal));
    expect(act.switchMode).toHaveBeenCalledWith('local');
  });

  it('in local mode offers to connect to a lab server', () => {
    const act = actions();
    click(item(state(), act, s.trayUseConnect));
    expect(act.switchMode).toHaveBeenCalledWith('connect');
    expect(labels(state())).not.toContain(s.trayChangeServer);
    expect(labels(state())).not.toContain(s.trayUseLocal);
  });

  it('the mode items end in three dots, because each asks before it acts', () => {
    for (const lang of ['en', 'fr', 'pt'] as const) {
      for (const key of ['trayChangeServer', 'trayUseLocal', 'trayUseConnect'] as const) expect(STRINGS[lang][key]).toMatch(/\.\.\.$/);
    }
  });
});
