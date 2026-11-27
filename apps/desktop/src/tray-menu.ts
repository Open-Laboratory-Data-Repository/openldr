// The tray menu, as a list of items. main.ts gives it to Electron and rebuilds it whenever the
// state changes. Kept apart from Electron so it can be tested: it only builds the list.

import type { ShareInfo } from './launcher';
import type { AppStrings } from './strings';

export interface TrayState {
  startAtSignIn: boolean;
  /** The setting: whether the person asked for sharing. */
  shareOnNetwork: boolean;
  /** What the running launcher says: set only once sharing is really on. */
  share: ShareInfo | undefined;
  /** True while OpenLDR restarts to turn sharing on or off. */
  busy: boolean;
}

export interface TrayActions {
  open(): void;
  setStartAtSignIn(on: boolean): void;
  setShare(on: boolean): void;
  copy(text: string): void;
  saveCertificate(certFile: string): void;
  openLogs(): void;
  quit(): void;
}

type Item = Electron.MenuItemConstructorOptions;

/**
 * The share items appear only while the launcher says it is shared. The first address is shown
 * as a line that cannot be pressed, with an item to copy it. A PC with no network address has no
 * address to show or copy, so it gets one line that says so.
 */
function shareItems(share: ShareInfo, s: AppStrings, act: TrayActions): Item[] {
  const first = share.addresses[0];
  return [
    ...(first !== undefined
      ? [
          { label: first, enabled: false } as Item,
          { label: s.trayCopyAddress, click: () => act.copy(first) } as Item,
        ]
      : [{ label: s.trayNoAddress, enabled: false } as Item]),
    { label: s.trayCopyFingerprint, click: () => act.copy(share.fingerprint) },
    { label: s.traySaveCertificate, click: () => act.saveCertificate(share.certFile) },
  ];
}

export function trayTemplate(state: TrayState, s: AppStrings, act: TrayActions): Item[] {
  return [
    { label: s.trayOpen, click: () => act.open() },
    { label: s.trayStartAtSignIn, type: 'checkbox', checked: state.startAtSignIn, click: (item) => act.setStartAtSignIn(item.checked) },
    {
      label: s.trayShare,
      type: 'checkbox',
      checked: state.shareOnNetwork,
      ...(state.busy ? { enabled: false } : {}),
      click: (item) => act.setShare(item.checked),
    },
    ...(state.share ? shareItems(state.share, s, act) : []),
    { label: s.trayOpenLogs, click: () => act.openLogs() },
    { type: 'separator' },
    { label: s.trayQuit, click: () => act.quit() },
  ];
}
