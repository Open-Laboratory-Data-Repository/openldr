// The preload script. It runs sandboxed, with context isolation on. tsup bundles the local imports
// in, so the built file needs only `electron`.
//
// On the app's own file: pages it gives the page `window.openldrDesktopPage`. On an http or https
// page on this computer it gives `window.openldrDesktop`, the two calls Studio may make. The main
// process checks every call's sender again; this check only keeps the object off other pages.
// Pages at any other address get nothing from here.

import { contextBridge, ipcRenderer } from 'electron';
import { INFO_CHANNEL, SETUP_CODE_CHANNEL } from './bridge';
import { RETRY_CHANNEL, SCREEN_CHANNEL } from './channels';
import type { PageState } from './controller';

/** Host names that reach only this computer, as `location.hostname` writes them. */
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/** Electron wraps an error from the main process as "Error invoking remote method '<channel>': Error: <message>". */
function mainError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''));
}

const { protocol, hostname } = window.location;

if (protocol === 'file:') {
  contextBridge.exposeInMainWorld('openldrDesktopPage', {
    onScreen(cb: (s: PageState) => void): void {
      ipcRenderer.on(SCREEN_CHANNEL, (_event, s: PageState) => cb(s));
    },
    retry(): void {
      ipcRenderer.send(RETRY_CHANNEL);
    },
  });
} else if ((protocol === 'http:' || protocol === 'https:') && LOCAL_HOSTS.includes(hostname)) {
  contextBridge.exposeInMainWorld('openldrDesktop', {
    setupCode(): Promise<string> {
      return ipcRenderer.invoke(SETUP_CODE_CHANNEL).catch((err: unknown) => Promise.reject(mainError(err)));
    },
    info(): Promise<{ version: string; platform: string }> {
      return ipcRenderer.invoke(INFO_CHANNEL).catch((err: unknown) => Promise.reject(mainError(err)));
    },
  });
}
