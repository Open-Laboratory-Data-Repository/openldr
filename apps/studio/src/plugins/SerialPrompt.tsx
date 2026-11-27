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
 *  browser's own list is up, also when the frame that asked has gone: a second list must never
 *  open over the first. */
let taken = false;

/** One asking, from the studio's question to the end of the browser's list. Every callback is
 *  bound to its own request, so an answer that comes late never reaches a later question. */
interface Request {
  /** Gives the caller its answer. Null once it was given. */
  give: ((result: SerialPickResult) => void) | null;
  /** True once the browser was asked: the page stays taken until the browser answers. */
  asked: boolean;
  /** What had the focus when the question opened: the plugin's frame, as a rule. */
  focusBefore: HTMLElement | null;
}

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
  /** The request whose question is on screen, or whose list is up. */
  const current = useRef<Request | null>(null);
  const serialRef = useRef(serial);
  serialRef.current = serial;

  /** Answers the caller of `req`, once. With `free`, the page may ask again. */
  const settle = useCallback((req: Request, result: SerialPickResult, free: boolean): void => {
    if (free) taken = false;
    const give = req.give;
    if (give === null) return;
    req.give = null;
    if (current.current === req) {
      current.current = null;
      setOpen(false);
    }
    // The dialog has no trigger to give the focus back to, so it is put back by hand, once the
    // dialog has gone.
    const before = req.focusBefore;
    if (before !== null) setTimeout(() => { if (before.isConnected) before.focus(); }, 0);
    give(result);
  }, []);

  const pick = useCallback((): Promise<SerialPickResult> => {
    if (serialRef.current === undefined) return Promise.resolve({ refused: 'serial-unavailable' });
    if (taken) return Promise.resolve({ refused: 'serial-busy' });
    taken = true;
    const active = document.activeElement;
    const req: Request = { give: null, asked: false, focusBefore: active instanceof HTMLElement && active !== document.body ? active : null };
    current.current = req;
    setOpen(true);
    return new Promise<SerialPickResult>((resolve) => { req.give = resolve; });
  }, []);

  const cancel = useCallback((): void => {
    const req = current.current;
    if (req === null) return;
    // The caller is told at once. If the browser's list is up it cannot be closed from here, so
    // the page stays taken until the browser answers, and that answer is dropped.
    settle(req, { refused: 'serial-cancelled' }, !req.asked);
  }, [settle]);

  // The frame going away is a Cancel.
  useEffect(() => () => {
    const req = current.current;
    if (req !== null) settle(req, { refused: 'serial-cancelled' }, !req.asked);
  }, [settle]);

  const element = useMemo(() => (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        const req = current.current;
        if (next || req === null || req.asked) return;
        settle(req, { refused: 'serial-cancelled' }, true);
      }}
      title={t('plugins.serial.title', { plugin: pluginLabel })}
      description={t('plugins.serial.body', { plugin: pluginLabel })}
      confirmLabel={t('plugins.serial.choose')}
      cancelLabel={t('plugins.serial.cancel')}
      onConfirm={() => {
        const req = current.current;
        if (req === null || req.asked) return;
        const api = serialRef.current;
        if (api === undefined) return settle(req, { refused: 'serial-unavailable' }, true);
        // Asked for inside the press itself, with nothing awaited before it: the browser shows
        // its list only for a call made during a press.
        let asked: Promise<SerialPortLike>;
        try {
          asked = api.requestPort();
        } catch (err) {
          return settle(req, { refused: refusalOf(err) }, true);
        }
        req.asked = true;
        setOpen(false);
        // Bound to this request. If its caller was already answered, the port is dropped as it is.
        asked.then((port) => settle(req, { port }, true), (err: unknown) => settle(req, { refused: refusalOf(err) }, true));
      }}
    />
  ), [open, pluginLabel, t, settle]);

  return useMemo(() => ({ pick, cancel, element }), [pick, cancel, element]);
}
