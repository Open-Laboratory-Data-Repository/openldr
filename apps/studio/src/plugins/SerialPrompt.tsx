// The studio's own question before the browser's list of serial ports. It names the plugin from
// the studio's data, never from anything the plugin's page sent. The plugin label is shown as
// plain text.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { SerialLike, SerialPortLike } from './serial-gate';
import { refusalOf } from './serial-native';

export type SerialPickResult =
  | { port: SerialPortLike }
  | { refused: 'serial-cancelled' | 'serial-unavailable' | 'serial-busy' | 'serial-failed' };

/** One question at a time on a studio page, whichever frame asks. It stays taken while the
 *  browser's own list is up. */
let taken = false;

export interface SerialPrompt {
  /** Shows the question, then the browser's list. Resolves with the port, or with why there is none. */
  pick(): Promise<SerialPickResult>;
  /** Closes the question as if the person pressed Cancel. */
  cancel(): void;
  /** The dialog. The frame draws it. */
  element: JSX.Element;
}

/** A confirm dialog, not a sheet: it is one yes or no question (AGENTS.md §5). */
export function useSerialPrompt(pluginLabel: string, serial: SerialLike | undefined): SerialPrompt {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /** The answer the open question is waiting to give. */
  const waiting = useRef<((result: SerialPickResult) => void) | null>(null);
  /** True once Choose port was pressed: the dialog then closes without that being a Cancel. */
  const chosen = useRef(false);
  const serialRef = useRef(serial);
  serialRef.current = serial;
  /** What had the focus when the question opened: the plugin's frame, as a rule. */
  const focusBefore = useRef<HTMLElement | null>(null);

  const finish = useCallback((result: SerialPickResult): void => {
    const give = waiting.current;
    if (give === null) return;
    waiting.current = null;
    taken = false;
    setOpen(false);
    // The dialog has no trigger to give the focus back to, so it is put back by hand, once the
    // dialog has gone.
    const before = focusBefore.current;
    focusBefore.current = null;
    if (before !== null) setTimeout(() => { if (before.isConnected) before.focus(); }, 0);
    give(result);
  }, []);

  const pick = useCallback((): Promise<SerialPickResult> => {
    if (serialRef.current === undefined) return Promise.resolve({ refused: 'serial-unavailable' });
    if (taken) return Promise.resolve({ refused: 'serial-busy' });
    taken = true;
    chosen.current = false;
    focusBefore.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    setOpen(true);
    return new Promise<SerialPickResult>((resolve) => { waiting.current = resolve; });
  }, []);

  const cancel = useCallback((): void => {
    // Once the browser's list is up it cannot be closed from here. Its answer is then dropped.
    finish({ refused: 'serial-cancelled' });
  }, [finish]);

  // The frame going away is a Cancel.
  useEffect(() => () => { finish({ refused: 'serial-cancelled' }); }, [finish]);

  const element = useMemo(() => (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (next || chosen.current) return;
        finish({ refused: 'serial-cancelled' });
      }}
      title={t('plugins.serial.title', { plugin: pluginLabel })}
      description={t('plugins.serial.body', { plugin: pluginLabel })}
      confirmLabel={t('plugins.serial.choose')}
      cancelLabel={t('plugins.serial.cancel')}
      onConfirm={() => {
        const api = serialRef.current;
        if (api === undefined) return finish({ refused: 'serial-unavailable' });
        // Asked for inside the press itself, with nothing awaited before it: the browser shows
        // its list only for a call made during a press.
        let asked: Promise<SerialPortLike>;
        try {
          asked = api.requestPort();
        } catch (err) {
          return finish({ refused: refusalOf(err) });
        }
        chosen.current = true;
        setOpen(false);
        asked.then((port) => finish({ port }), (err: unknown) => finish({ refused: refusalOf(err) }));
      }}
    />
  ), [open, pluginLabel, t, finish]);

  return useMemo(() => ({ pick, cancel, element }), [pick, cancel, element]);
}
